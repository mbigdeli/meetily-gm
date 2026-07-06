//! Meetily-GM: per-meeting processing status for the sidebar status chips.
//!
//! One batched query (no N+1) returns each meeting's summary status and whether
//! a diarized transcript exists, so the meeting list can show at-a-glance chips
//! (Summarizing… / Summarized / Failed / Diarized / No summary).

use serde::Serialize;
use tauri::{AppHandle, Manager, Runtime};

use crate::state::AppState;

#[derive(Serialize, sqlx::FromRow)]
pub struct MeetingStatus {
    pub meeting_id: String,
    /// summary_processes.status: null | PENDING | completed | failed | cancelled
    pub summary_status: Option<String>,
    /// >0 when a diarized (speaker-named) transcript exists for this meeting.
    pub diarized: i64,
}

/// Batched status for every meeting (drives the sidebar chips).
#[tauri::command]
pub async fn api_get_meetings_status<R: Runtime>(
    app: AppHandle<R>,
) -> Result<Vec<MeetingStatus>, String> {
    let pool = app
        .try_state::<AppState>()
        .map(|s| s.db_manager.pool().clone())
        .ok_or_else(|| "app state unavailable".to_string())?;

    sqlx::query_as::<_, MeetingStatus>(
        "SELECT m.id AS meeting_id,
                sp.status AS summary_status,
                (SELECT COUNT(*) FROM meeting_diarized_segments d WHERE d.meeting_id = m.id) AS diarized
         FROM meetings m
         LEFT JOIN summary_processes sp ON sp.meeting_id = m.id",
    )
    .fetch_all(&pool)
    .await
    .map_err(|e| format!("load meetings status: {e}"))
}
