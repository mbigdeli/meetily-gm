use crate::state::AppState;
use serde::Serialize;
use sqlx::{FromRow, SqlitePool};
use tauri::Runtime;

#[derive(Debug, FromRow)]
struct StoredSegment {
    id: String,
    text: String,
    timestamp: String,
    audio_start_time: Option<f64>,
    audio_end_time: Option<f64>,
    duration: Option<f64>,
}

#[derive(Debug, Serialize, PartialEq)]
pub struct PreferredTranscriptResponse {
    pub transcripts: Vec<PreferredTranscriptSegment>,
    pub source: &'static str,
}

#[derive(Debug, Serialize, PartialEq)]
pub struct PreferredTranscriptSegment {
    pub id: String,
    pub text: String,
    pub timestamp: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub audio_start_time: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub audio_end_time: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub duration: Option<f64>,
}

async fn load_preferred(
    pool: &SqlitePool,
    meeting_id: &str,
) -> Result<PreferredTranscriptResponse, sqlx::Error> {
    let diarized = sqlx::query_as::<_, StoredSegment>(
        "SELECT 'diarized-' || seq AS id,
                CASE WHEN TRIM(COALESCE(speaker_name, '')) = ''
                     THEN text ELSE TRIM(speaker_name) || ': ' || text END AS text,
                '' AS timestamp, start_sec AS audio_start_time,
                end_sec AS audio_end_time,
                CASE WHEN start_sec IS NOT NULL AND end_sec IS NOT NULL
                     THEN end_sec - start_sec ELSE NULL END AS duration
         FROM meeting_diarized_segments
         WHERE meeting_id = ? AND TRIM(text) <> '' ORDER BY seq ASC",
    )
    .bind(meeting_id)
    .fetch_all(pool)
    .await?;

    if !diarized.is_empty() {
        return Ok(response(diarized, "speaker_attributed"));
    }

    let raw = sqlx::query_as::<_, StoredSegment>(
        "SELECT id, transcript AS text, timestamp, audio_start_time,
                audio_end_time, duration FROM transcripts
         WHERE meeting_id = ? AND TRIM(transcript) <> ''
         ORDER BY audio_start_time ASC, rowid ASC",
    )
    .bind(meeting_id)
    .fetch_all(pool)
    .await?;
    Ok(response(raw, "raw"))
}

fn response(rows: Vec<StoredSegment>, source: &'static str) -> PreferredTranscriptResponse {
    PreferredTranscriptResponse {
        source,
        transcripts: rows
            .into_iter()
            .map(|row| PreferredTranscriptSegment {
                id: row.id,
                text: row.text,
                timestamp: row.timestamp,
                audio_start_time: row.audio_start_time,
                audio_end_time: row.audio_end_time,
                duration: row.duration,
            })
            .collect(),
    }
}

#[tauri::command]
pub async fn api_get_preferred_meeting_transcript<R: Runtime>(
    _app: tauri::AppHandle<R>,
    state: tauri::State<'_, AppState>,
    meeting_id: String,
) -> Result<PreferredTranscriptResponse, String> {
    load_preferred(state.db_manager.pool(), &meeting_id)
        .await
        .map_err(|error| format!("Failed to retrieve preferred transcript: {error}"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use sqlx::sqlite::SqlitePoolOptions;

    async fn pool() -> SqlitePool {
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .unwrap();
        sqlx::query(
            "CREATE TABLE transcripts (
                id TEXT, meeting_id TEXT, transcript TEXT, timestamp TEXT,
                audio_start_time REAL, audio_end_time REAL, duration REAL
            );
            CREATE TABLE meeting_diarized_segments (
                meeting_id TEXT, seq INTEGER, speaker_name TEXT, text TEXT,
                start_sec REAL, end_sec REAL
            );",
        )
        .execute(&pool)
        .await
        .unwrap();
        pool
    }

    #[tokio::test]
    async fn speaker_attributed_text_is_used_without_audio_transcript() {
        let pool = pool().await;
        sqlx::query(
            "INSERT INTO meeting_diarized_segments
             VALUES ('meeting-1', 0, 'Iman', 'سلام', NULL, NULL)",
        )
        .execute(&pool)
        .await
        .unwrap();

        let result = load_preferred(&pool, "meeting-1").await.unwrap();

        assert_eq!(result.source, "speaker_attributed");
        assert_eq!(result.transcripts[0].text, "Iman: سلام");
    }

    #[tokio::test]
    async fn raw_transcript_remains_the_fallback() {
        let pool = pool().await;
        sqlx::query(
            "INSERT INTO transcripts
             VALUES ('t-1', 'meeting-1', 'hello', '12:00', 1.0, 2.0, 1.0)",
        )
        .execute(&pool)
        .await
        .unwrap();

        let result = load_preferred(&pool, "meeting-1").await.unwrap();

        assert_eq!(result.source, "raw");
        assert_eq!(result.transcripts[0].text, "hello");
    }

    #[tokio::test]
    async fn speaker_attributed_text_wins_when_both_exist() {
        let pool = pool().await;
        sqlx::query(
            "INSERT INTO transcripts
             VALUES ('t-1', 'meeting-1', 'raw', '12:00', 1.0, 2.0, 1.0);
             INSERT INTO meeting_diarized_segments
             VALUES ('meeting-1', 0, 'Sara', 'better', 1.0, 2.0)",
        )
        .execute(&pool)
        .await
        .unwrap();

        let result = load_preferred(&pool, "meeting-1").await.unwrap();

        assert_eq!(result.source, "speaker_attributed");
        assert_eq!(result.transcripts[0].text, "Sara: better");
    }
}
