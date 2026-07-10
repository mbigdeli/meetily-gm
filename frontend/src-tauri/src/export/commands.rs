//! Tauri command for participant export (doc 04). Reads the roster for a
//! meeting and returns the formatted text (CSV/JSON/Markdown); the frontend
//! writes the file. Richer fields (join/leave, is_self) arrive with the
//! participants_v2 migration — today the table has names only.

use super::participants::{self, ParticipantRow};
use crate::state::AppState;
use tauri::State;

#[tauri::command]
pub async fn api_export_participants(
    state: State<'_, AppState>,
    meeting_id: String,
    format: String,
) -> Result<String, String> {
    let pool = state.db_manager.pool();

    let names: Vec<String> = sqlx::query_scalar(
        "SELECT name FROM meeting_participants WHERE meeting_id = ? ORDER BY name",
    )
    .bind(&meeting_id)
    .fetch_all(pool)
    .await
    .map_err(|e| e.to_string())?;

    let title: Option<String> = sqlx::query_scalar::<_, Option<String>>(
        "SELECT title FROM meetings WHERE id = ?",
    )
    .bind(&meeting_id)
    .fetch_optional(pool)
    .await
    .map_err(|e| e.to_string())?
    .flatten();

    let rows: Vec<ParticipantRow> = names
        .into_iter()
        .map(|name| ParticipantRow { name, first_seen: None, last_seen: None, is_self: false })
        .collect();

    let title = title.unwrap_or_else(|| meeting_id.clone());
    Ok(match format.as_str() {
        "csv" => participants::to_csv(&rows),
        "json" => participants::to_json(&title, "", &rows),
        "md" | "markdown" => participants::to_markdown(&rows),
        other => return Err(format!("Unknown export format: {other}")),
    })
}
