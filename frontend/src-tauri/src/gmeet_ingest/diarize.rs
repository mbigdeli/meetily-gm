//! GMeet diarization merge (Meetily-GM).
//!
//! Fuses meetily's Whisper transcript (accurate words, timed, no speaker) with
//! Google Meet captions (real speaker names, timed) into a single diarized
//! transcript (text + speaker name) using the local Codex CLI. Runs after the
//! recording is stopped and saved, once the SQLite meeting_id exists.

use serde::Serialize;
use serde_json::{json, Value};
use sqlx::SqlitePool;
use tauri::{AppHandle, Manager, Runtime};

use crate::state::AppState;

/// Cap how many segments we hand the model (keeps the prompt bounded + fast).
const MAX_WHISPER_SEGMENTS: usize = 600;
const MAX_CAPTIONS: usize = 600;
const MAX_ATTEMPTS: usize = 3;

const DIARIZE_SYSTEM_PROMPT: &str = r#"You are a meeting transcript diarization engine. You merge two imperfect
sources of the SAME meeting into one clean, speaker-attributed transcript.
Output STRICT JSON ONLY — no markdown, no prose, no code fences.

INPUTS
- transcript_segments: from local Whisper on the meeting audio. This is the
  AUTHORITATIVE source for the SPOKEN WORDS. Each has start_sec, end_sec, text.
  It has NO reliable speaker labels.
- caption_events: from Google Meet's live captions. These are the
  AUTHORITATIVE source for WHO SPOKE (speaker names are real), plus timing.
  Their text may be truncated, lower-quality, or lag the audio — do NOT trust
  their wording over Whisper.
- participants: the meeting's attendee roster (real names), may be empty.

TASK
Produce final_segments: the Whisper words, split/kept by natural turn, each
assigned to the correct speaker by matching caption_events by time overlap
(and speaker continuity). Rules:
- Words/text come from transcript_segments (Whisper). Never invent or import
  wording from captions except when Whisper is empty for a span.
- Speaker names come from caption_events by maximal time overlap. If no caption
  overlaps a segment, set speaker_name to "Unknown" and lower confidence.
- Prefer a known participant name; never invent names not in captions/roster.
- Merge overlapping/duplicate Whisper spans (chunk overlap) into one.
- Preserve the original spoken language(s); do NOT translate.
- Keep chronological order by start_sec.
- confidence (0..1) reflects how sure the speaker attribution is.

OUTPUT JSON SHAPE (exact keys):
{
  "schema_version": 1,
  "final_segments": [
    {"start_sec": <number>, "end_sec": <number>, "speaker_name": "<name or 'Unknown'>",
     "text": "<Whisper words>", "language": "<language>", "confidence": <0..1>}
  ],
  "speakers": ["<distinct names, first-appearance order>"],
  "unresolved": ["<notes on spans not confidently attributed>"]
}"#;

#[derive(sqlx::FromRow)]
struct WhisperRow {
    transcript: String,
    audio_start_time: Option<f64>,
    audio_end_time: Option<f64>,
}

#[derive(sqlx::FromRow)]
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

    let package = build_package(&whisper, &captions);
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
        let raw = crate::codex::generate_with_codex(
            &app_data_dir,
            DIARIZE_SYSTEM_PROMPT,
            &user_prompt,
            None,
        )
        .await?;

        match parse_json_lenient(&raw) {
            Ok(v) => {
                let segs = v.get("final_segments").and_then(|s| s.as_array());
                match segs {
                    Some(arr) if !arr.is_empty() => {
                        return write_segments_from_json(pool, meeting_id, arr).await;
                    }
                    _ => last_err = "missing/empty final_segments".to_string(),
                }
            }
            Err(e) => last_err = format!("JSON parse: {e}"),
        }
        log::warn!("diarize attempt {attempt} failed: {last_err}");
    }

    // All attempts failed — fall back to whisper-with-Unknown so the meeting
    // still has a transcript.
    log::error!("diarize: all attempts failed ({last_err}); falling back to whisper");
    write_segments_from_whisper(pool, meeting_id, &whisper).await
}

async fn clear_existing(pool: &SqlitePool, meeting_id: &str) -> Result<(), String> {
    sqlx::query("DELETE FROM meeting_diarized_segments WHERE meeting_id = ?")
        .bind(meeting_id)
        .execute(pool)
        .await
        .map_err(|e| format!("clear diarized: {e}"))?;
    Ok(())
}

async fn insert_segment(
    pool: &SqlitePool,
    meeting_id: &str,
    seq: i64,
    start: Option<f64>,
    end: Option<f64>,
    speaker: &str,
    language: Option<&str>,
    confidence: Option<f64>,
    text: &str,
) -> Result<(), String> {
    sqlx::query(
        "INSERT INTO meeting_diarized_segments
         (meeting_id, seq, start_sec, end_sec, speaker_name, language, confidence, text)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(meeting_id)
    .bind(seq)
    .bind(start)
    .bind(end)
    .bind(speaker)
    .bind(language)
    .bind(confidence)
    .bind(text)
    .execute(pool)
    .await
    .map_err(|e| format!("insert diarized: {e}"))?;
    Ok(())
}

async fn write_segments_from_json(
    pool: &SqlitePool,
    meeting_id: &str,
    segs: &[Value],
) -> Result<usize, String> {
    clear_existing(pool, meeting_id).await?;
    let mut n = 0i64;
    for s in segs {
        let text = s.get("text").and_then(|v| v.as_str()).unwrap_or("").trim();
        if text.is_empty() {
            continue;
        }
        let speaker = s
            .get("speaker_name")
            .and_then(|v| v.as_str())
            .map(str::trim)
            .filter(|x| !x.is_empty())
            .unwrap_or("Unknown");
        insert_segment(
            pool,
            meeting_id,
            n,
            s.get("start_sec").and_then(|v| v.as_f64()),
            s.get("end_sec").and_then(|v| v.as_f64()),
            speaker,
            s.get("language").and_then(|v| v.as_str()),
            s.get("confidence").and_then(|v| v.as_f64()),
            text,
        )
        .await?;
        n += 1;
    }
    log::info!("diarize: wrote {n} diarized segments for {meeting_id}");
    Ok(n as usize)
}

async fn write_segments_from_whisper(
    pool: &SqlitePool,
    meeting_id: &str,
    whisper: &[WhisperRow],
) -> Result<usize, String> {
    clear_existing(pool, meeting_id).await?;
    let mut n = 0i64;
    for w in whisper {
        let text = w.transcript.trim();
        if text.is_empty() {
            continue;
        }
        insert_segment(
            pool,
            meeting_id,
            n,
            w.audio_start_time,
            w.audio_end_time,
            "Unknown",
            None,
            None,
            text,
        )
        .await?;
        n += 1;
    }
    Ok(n as usize)
}

async fn write_segments_from_captions(
    pool: &SqlitePool,
    meeting_id: &str,
    captions: &[CaptionRow],
) -> Result<usize, String> {
    clear_existing(pool, meeting_id).await?;
    let mut n = 0i64;
    for c in captions {
        let text = c.text.trim();
        if text.is_empty() {
            continue;
        }
        let speaker = c
            .speaker
            .as_deref()
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .unwrap_or("Unknown");
        insert_segment(
            pool,
            meeting_id,
            n,
            c.ts_ms.map(|ms| ms as f64 / 1000.0),
            None,
            speaker,
            None,
            None,
            text,
        )
        .await?;
        n += 1;
    }
    Ok(n as usize)
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
}
