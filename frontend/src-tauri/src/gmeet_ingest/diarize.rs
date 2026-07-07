//! GMeet diarization merge (Meetily-GM).
//!
//! Fuses meetily's Whisper transcript (accurate words, timed, no speaker) with
//! Google Meet captions (real speaker names, timed) into a single diarized
//! transcript (text + speaker name) using the local Codex CLI. Runs after the
//! recording is stopped and saved, once the SQLite meeting_id exists.

use std::path::Path;

use serde::Serialize;
use serde_json::{json, Value};
use sqlx::SqlitePool;
use tauri::{AppHandle, Manager, Runtime};

use crate::state::AppState;

/// Cap how many segments we hand the model per call (keeps the prompt bounded).
const MAX_WHISPER_SEGMENTS: usize = 600;
const MAX_CAPTIONS: usize = 600;
const MAX_ATTEMPTS: usize = 3;

/// Long meetings are consolidated in windows so each Codex call stays bounded
/// (avoids truncation / quality loss on very long transcripts). One window per
/// ~10 minutes of audio; captions are pulled with a small pad on each side so a
/// turn straddling a boundary still finds its speaker despite the clock offset.
const CHUNK_SECONDS: f64 = 600.0;
const CAPTION_PAD_SEC: f64 = 20.0;
/// Below this total duration we send everything in a single call.
const SINGLE_CALL_MAX_SECONDS: f64 = 720.0;

const DIARIZE_SYSTEM_PROMPT: &str = r#"You are a meeting transcript consolidation engine. Two imperfect recordings of
the SAME meeting are given; produce ONE unified, speaker-attributed transcript —
the single most reliable version. Output STRICT JSON ONLY — no markdown, no
prose, no code fences.

INPUTS
- transcript_segments: from local Whisper on the meeting audio. Primary source
  for the SPOKEN WORDS (accurate phrasing, punctuation, timing: start_sec,
  end_sec, text). Has NO reliable speaker labels.
- caption_events: from Google Meet live captions. Authoritative source for WHO
  SPOKE (speaker_name is a real person). Wording is often truncated or lags the
  audio, BUT captions frequently get proper nouns, names, jargon and acronyms
  right where Whisper mishears them.
- participants: attendee roster (real names), may be empty.

TIMELINE NOTE
transcript_segments and caption_events may share a small, roughly CONSTANT time
offset (audio can start a few seconds after the Meet). Do NOT assume identical
clocks. Infer the offset from how the two sequences line up (ordering, spacing,
turn continuity, matching text), then align. A caption whose text matches a
Whisper span pins down both the speaker AND the offset.

TASK — build final_segments (one clean transcript, one line per speaker turn):
- WORDS: base each segment on Whisper's phrasing. Reconcile discrepancies to the
  most plausible single version — when a caption clearly has the correct name /
  proper noun / term that Whisper garbled, adopt that correction. Do NOT emit two
  variants and do NOT keep obvious mis-hearings when the caption disambiguates.
  Where Whisper is empty for a span that captions cover, use the caption text.
- SPEAKER: assign speaker_name from caption_events by best offset-adjusted time
  overlap + text similarity + turn continuity. Prefer a roster name. Never invent
  a name; if none plausibly matches, use "Unknown" and lower confidence.
- Merge overlapping/duplicate Whisper spans into one; split into a new segment at
  each speaker change.
- Preserve the original spoken language(s); do NOT translate or summarize.
- Keep chronological order by start_sec. confidence (0..1) = certainty of the
  speaker attribution.

OUTPUT JSON SHAPE (exact keys):
{
  "schema_version": 1,
  "final_segments": [
    {"start_sec": <number>, "end_sec": <number>, "speaker_name": "<name or 'Unknown'>",
     "text": "<consolidated words>", "language": "<language>", "confidence": <0..1>}
  ],
  "speakers": ["<distinct names, first-appearance order>"],
  "unresolved": ["<notes on spans not confidently attributed>"]
}"#;

#[derive(sqlx::FromRow, Clone)]
struct WhisperRow {
    transcript: String,
    audio_start_time: Option<f64>,
    audio_end_time: Option<f64>,
}

#[derive(sqlx::FromRow, Clone)]
struct CaptionRow {
    speaker: Option<String>,
    text: String,
    ts_ms: Option<i64>,
}

/// Strip markdown fences and parse JSON.
fn parse_json_lenient(text: &str) -> Result<Value, serde_json::Error> {
    let t = text.trim();
    if t.starts_with("```") {
        let inner: Vec<&str> = t.lines().collect();
        if inner.len() >= 2 {
            let end = if inner.last().map(|l| l.trim()) == Some("```") {
                inner.len() - 1
            } else {
                inner.len()
            };
            return serde_json::from_str(inner[1..end].join("\n").trim());
        }
    }
    serde_json::from_str(t)
}

fn build_package(whisper: &[WhisperRow], captions: &[CaptionRow]) -> Value {
    let transcript_segments: Vec<Value> = whisper
        .iter()
        .take(MAX_WHISPER_SEGMENTS)
        .map(|w| {
            json!({
                "start_sec": w.audio_start_time,
                "end_sec": w.audio_end_time,
                "text": w.transcript,
            })
        })
        .collect();
    let caption_events: Vec<Value> = captions
        .iter()
        .take(MAX_CAPTIONS)
        .map(|c| {
            json!({
                "start_sec": c.ts_ms.map(|ms| ms as f64 / 1000.0),
                "speaker_name": c.speaker,
                "text": c.text,
            })
        })
        .collect();
    // Distinct caption speakers form the roster hint.
    let mut roster: Vec<String> = captions
        .iter()
        .filter_map(|c| c.speaker.clone())
        .filter(|s| !s.trim().is_empty())
        .collect();
    roster.sort();
    roster.dedup();
    json!({
        "transcript_segments": transcript_segments,
        "caption_events": caption_events,
        "participants": roster,
    })
}

/// Merge Whisper transcript + Meet captions into meeting_diarized_segments.
/// Returns the number of diarized segments written.
pub async fn run_diarization<R: Runtime>(
    pool: &SqlitePool,
    app: &AppHandle<R>,
    gmeet_session_id: &str,
    meeting_id: &str,
) -> Result<usize, String> {
    let whisper: Vec<WhisperRow> = sqlx::query_as::<_, WhisperRow>(
        "SELECT transcript, audio_start_time, audio_end_time FROM transcripts
         WHERE meeting_id = ? ORDER BY audio_start_time ASC, rowid ASC",
    )
    .bind(meeting_id)
    .fetch_all(pool)
    .await
    .map_err(|e| format!("load whisper transcript: {e}"))?;

    let captions: Vec<CaptionRow> = sqlx::query_as::<_, CaptionRow>(
        "SELECT speaker, text, ts_ms FROM gmeet_captions
         WHERE gmeet_session_id = ? ORDER BY ts_ms ASC, id ASC",
    )
    .bind(gmeet_session_id)
    .fetch_all(pool)
    .await
    .map_err(|e| format!("load captions: {e}"))?;

    log::info!(
        "diarize: meeting={} whisper_segments={} captions={}",
        meeting_id,
        whisper.len(),
        captions.len()
    );

    // Degenerate cases: keep whatever data we have rather than losing it.
    if whisper.is_empty() && captions.is_empty() {
        return Ok(0);
    }
    if captions.is_empty() {
        // No names available — store Whisper as-is (Unknown speaker).
        return write_segments_from_whisper(pool, meeting_id, &whisper).await;
    }
    if whisper.is_empty() {
        // No audio transcript — store captions as the diarized transcript.
        return write_segments_from_captions(pool, meeting_id, &captions).await;
    }

    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("app_data_dir: {e}"))?;

    // Short meetings: one call. Long meetings: consolidate in ~10-min windows so
    // each Codex call stays bounded (better quality, no truncation). Segments are
    // accumulated across windows, then written once (single transaction).
    let total_end = timeline_end(&whisper, &captions);
    let mut all: Vec<SegParams> = Vec::new();

    if total_end <= SINGLE_CALL_MAX_SECONDS {
        match diarize_chunk(&app_data_dir, &whisper, &captions).await {
            Ok(mut segs) => all.append(&mut segs),
            Err(e) => {
                log::error!("diarize: consolidation failed ({e}); falling back to whisper");
                all.extend(whisper_as_segments(&whisper));
            }
        }
    } else {
        let n_chunks = (total_end / CHUNK_SECONDS).ceil() as usize;
        log::info!("diarize: windowing {total_end:.0}s into {n_chunks} chunk(s)");
        for i in 0..n_chunks {
            let w0 = i as f64 * CHUNK_SECONDS;
            let w1 = w0 + CHUNK_SECONDS;
            let w_slice: Vec<WhisperRow> = whisper
                .iter()
                .filter(|w| {
                    let t = w.audio_start_time.unwrap_or(0.0);
                    t >= w0 && t < w1
                })
                .cloned()
                .collect();
            let c_slice: Vec<CaptionRow> = captions
                .iter()
                .filter(|c| {
                    let t = c.ts_ms.map(|ms| ms as f64 / 1000.0).unwrap_or(0.0);
                    t >= w0 - CAPTION_PAD_SEC && t < w1 + CAPTION_PAD_SEC
                })
                .cloned()
                .collect();
            if w_slice.is_empty() && c_slice.is_empty() {
                continue;
            }
            // No captions in this window → keep Whisper as-is (no LLM needed).
            if c_slice.is_empty() {
                all.extend(whisper_as_segments(&w_slice));
                continue;
            }
            match diarize_chunk(&app_data_dir, &w_slice, &c_slice).await {
                Ok(mut segs) => all.append(&mut segs),
                Err(e) => {
                    log::warn!("diarize: chunk {i} failed ({e}); using whisper for this window");
                    all.extend(whisper_as_segments(&w_slice));
                }
            }
        }
    }

    // Never lose the transcript: if consolidation yielded nothing usable, keep
    // whatever Whisper produced.
    if all.is_empty() {
        all.extend(whisper_as_segments(&whisper));
    }
    write_segments(pool, meeting_id, all).await
}

/// Latest timestamp (seconds) seen across either source — the meeting's length.
fn timeline_end(whisper: &[WhisperRow], captions: &[CaptionRow]) -> f64 {
    let w = whisper
        .iter()
        .filter_map(|w| w.audio_end_time.or(w.audio_start_time))
        .fold(0.0_f64, f64::max);
    let c = captions
        .iter()
        .filter_map(|c| c.ts_ms)
        .map(|ms| ms as f64 / 1000.0)
        .fold(0.0_f64, f64::max);
    w.max(c)
}

/// Consolidate one window (Whisper + captions) via Codex into diarized segments.
/// Retries JSON-shape failures up to MAX_ATTEMPTS; Err after that (caller falls
/// back to raw Whisper for the window so no data is lost).
async fn diarize_chunk(
    app_data_dir: &Path,
    whisper: &[WhisperRow],
    captions: &[CaptionRow],
) -> Result<Vec<SegParams>, String> {
    let package = build_package(whisper, captions);
    let base_user = format!(
        "Merge the following into the required JSON object. Output ONLY the JSON.\n\n{}",
        serde_json::to_string(&package).unwrap_or_default()
    );

    let mut last_err = String::new();
    for attempt in 0..MAX_ATTEMPTS {
        let user_prompt = if attempt == 0 {
            base_user.clone()
        } else {
            format!(
                "{base_user}\n\nYour previous reply was not valid JSON matching the shape. Error: {last_err}. Return STRICT JSON ONLY."
            )
        };
        let raw =
            crate::codex::generate_with_codex(app_data_dir, DIARIZE_SYSTEM_PROMPT, &user_prompt, None)
                .await?;

        match parse_json_lenient(&raw) {
            Ok(v) => match v.get("final_segments").and_then(|s| s.as_array()) {
                Some(arr) if !arr.is_empty() => {
                    let segs = segment_params_from_json(arr);
                    if !segs.is_empty() {
                        return Ok(segs);
                    }
                    last_err = "final_segments had no usable text".to_string();
                }
                _ => last_err = "missing/empty final_segments".to_string(),
            },
            Err(e) => last_err = format!("JSON parse: {e}"),
        }
        log::warn!("diarize attempt {attempt} failed: {last_err}");
    }
    Err(last_err)
}

/// One diarized row to persist.
struct SegParams {
    start: Option<f64>,
    end: Option<f64>,
    speaker: String,
    language: Option<String>,
    confidence: Option<f64>,
    text: String,
}

/// Atomically replace a meeting's diarized segments: DELETE + all INSERTs run in
/// ONE transaction, so a mid-loop failure rolls back (no partial/lost data).
async fn write_segments(
    pool: &SqlitePool,
    meeting_id: &str,
    segs: Vec<SegParams>,
) -> Result<usize, String> {
    let mut tx = pool
        .begin()
        .await
        .map_err(|e| format!("begin diarize tx: {e}"))?;

    sqlx::query("DELETE FROM meeting_diarized_segments WHERE meeting_id = ?")
        .bind(meeting_id)
        .execute(&mut *tx)
        .await
        .map_err(|e| format!("clear diarized: {e}"))?;

    let mut n = 0i64;
    for s in &segs {
        sqlx::query(
            "INSERT INTO meeting_diarized_segments
             (meeting_id, seq, start_sec, end_sec, speaker_name, language, confidence, text)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .bind(meeting_id)
        .bind(n)
        .bind(s.start)
        .bind(s.end)
        .bind(&s.speaker)
        .bind(s.language.as_deref())
        .bind(s.confidence)
        .bind(&s.text)
        .execute(&mut *tx)
        .await
        .map_err(|e| format!("insert diarized: {e}"))?;
        n += 1;
    }

    tx.commit()
        .await
        .map_err(|e| format!("commit diarize tx: {e}"))?;
    log::info!("diarize: wrote {n} diarized segments for {meeting_id}");
    Ok(n as usize)
}

/// Parse the model's `final_segments` array into persistable rows (drops empties).
fn segment_params_from_json(segs: &[Value]) -> Vec<SegParams> {
    segs.iter()
        .filter_map(|s| {
            let text = s.get("text").and_then(|v| v.as_str()).unwrap_or("").trim();
            if text.is_empty() {
                return None;
            }
            let speaker = s
                .get("speaker_name")
                .and_then(|v| v.as_str())
                .map(str::trim)
                .filter(|x| !x.is_empty())
                .unwrap_or("Unknown")
                .to_string();
            Some(SegParams {
                start: s.get("start_sec").and_then(|v| v.as_f64()),
                end: s.get("end_sec").and_then(|v| v.as_f64()),
                speaker,
                language: s.get("language").and_then(|v| v.as_str()).map(String::from),
                confidence: s.get("confidence").and_then(|v| v.as_f64()),
                text: text.to_string(),
            })
        })
        .collect()
}

/// Whisper rows as diarized segments with speaker "Unknown" (no captions).
fn whisper_as_segments(whisper: &[WhisperRow]) -> Vec<SegParams> {
    whisper
        .iter()
        .filter_map(|w| {
            let text = w.transcript.trim();
            if text.is_empty() {
                return None;
            }
            Some(SegParams {
                start: w.audio_start_time,
                end: w.audio_end_time,
                speaker: "Unknown".to_string(),
                language: None,
                confidence: None,
                text: text.to_string(),
            })
        })
        .collect()
}

async fn write_segments_from_whisper(
    pool: &SqlitePool,
    meeting_id: &str,
    whisper: &[WhisperRow],
) -> Result<usize, String> {
    write_segments(pool, meeting_id, whisper_as_segments(whisper)).await
}

async fn write_segments_from_captions(
    pool: &SqlitePool,
    meeting_id: &str,
    captions: &[CaptionRow],
) -> Result<usize, String> {
    let rows: Vec<SegParams> = captions
        .iter()
        .filter_map(|c| {
            let text = c.text.trim();
            if text.is_empty() {
                return None;
            }
            let speaker = c
                .speaker
                .as_deref()
                .map(str::trim)
                .filter(|s| !s.is_empty())
                .unwrap_or("Unknown")
                .to_string();
            Some(SegParams {
                start: c.ts_ms.map(|ms| ms as f64 / 1000.0),
                end: None,
                speaker,
                language: None,
                confidence: None,
                text: text.to_string(),
            })
        })
        .collect();
    write_segments(pool, meeting_id, rows).await
}

// ---- Tauri commands ------------------------------------------------------

/// A diarized segment as returned to the UI.
#[derive(Serialize, sqlx::FromRow)]
pub struct DiarizedSegment {
    pub seq: i64,
    pub start_sec: Option<f64>,
    pub end_sec: Option<f64>,
    pub speaker_name: Option<String>,
    pub language: Option<String>,
    pub confidence: Option<f64>,
    pub text: String,
}

fn pool_of<R: Runtime>(app: &AppHandle<R>) -> Result<SqlitePool, String> {
    app.try_state::<AppState>()
        .map(|s| s.db_manager.pool().clone())
        .ok_or_else(|| "app state unavailable".to_string())
}

/// Run diarization after a gmeet recording has been saved (frontend calls this
/// once the real meeting_id exists).
#[tauri::command]
pub async fn gmeet_finalize_diarization<R: Runtime>(
    app: AppHandle<R>,
    gmeet_session_id: String,
    meeting_id: String,
) -> Result<usize, String> {
    let pool = pool_of(&app)?;
    run_diarization(&pool, &app, &gmeet_session_id, &meeting_id).await
}

/// Read the diarized segments for a meeting (for the Diarized transcript tab).
#[tauri::command]
pub async fn api_get_diarized_segments<R: Runtime>(
    app: AppHandle<R>,
    meeting_id: String,
) -> Result<Vec<DiarizedSegment>, String> {
    let pool = pool_of(&app)?;
    sqlx::query_as::<_, DiarizedSegment>(
        "SELECT seq, start_sec, end_sec, speaker_name, language, confidence, text
         FROM meeting_diarized_segments WHERE meeting_id = ? ORDER BY seq ASC",
    )
    .bind(&meeting_id)
    .fetch_all(&pool)
    .await
    .map_err(|e| format!("load diarized segments: {e}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_json_lenient_strips_fences() {
        let v = parse_json_lenient("```json\n{\"final_segments\":[]}\n```").unwrap();
        assert!(v.get("final_segments").is_some());
    }

    #[test]
    fn build_package_maps_fields() {
        let w = vec![WhisperRow {
            transcript: "hello world".into(),
            audio_start_time: Some(1.0),
            audio_end_time: Some(2.0),
        }];
        let c = vec![CaptionRow {
            speaker: Some("Sara".into()),
            text: "hello".into(),
            ts_ms: Some(1200),
        }];
        let pkg = build_package(&w, &c);
        assert_eq!(pkg["transcript_segments"][0]["text"], "hello world");
        assert_eq!(pkg["caption_events"][0]["speaker_name"], "Sara");
        assert_eq!(pkg["participants"][0], "Sara");
    }

    #[test]
    fn segment_params_from_json_extracts_and_drops_empty() {
        let segs = serde_json::json!([
            {"start_sec": 0.5, "end_sec": 2.0, "speaker_name": "Sara", "text": "hi there", "confidence": 0.9},
            {"start_sec": 2.0, "end_sec": 3.0, "speaker_name": "", "text": "   "},
            {"start_sec": 3.0, "text": "no speaker key"}
        ]);
        let rows = segment_params_from_json(segs.as_array().unwrap());
        assert_eq!(rows.len(), 2); // whitespace-only text dropped
        assert_eq!(rows[0].speaker, "Sara");
        assert_eq!(rows[0].text, "hi there");
        assert_eq!(rows[1].speaker, "Unknown"); // missing speaker → Unknown
    }

    #[test]
    fn timeline_end_takes_max_across_sources() {
        let w = vec![
            WhisperRow { transcript: "a".into(), audio_start_time: Some(0.0), audio_end_time: Some(30.0) },
            WhisperRow { transcript: "b".into(), audio_start_time: Some(30.0), audio_end_time: None },
        ];
        let c = vec![CaptionRow { speaker: Some("X".into()), text: "y".into(), ts_ms: Some(45_000) }];
        // captions reach 45s, whisper 30s → 45s wins
        assert_eq!(timeline_end(&w, &c), 45.0);
    }
}
