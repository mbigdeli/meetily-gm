//! Tauri commands for Prompt Studio (doc 06 §5). Thin wrappers over
//! templates_store + the {{transcript}} validation contract. The frontend
//! editor (list / save / delete / preview) calls these.

use super::template_vars::{self, TemplateContext, ValidationIssue};
use super::templates_store::{self, MeetingTemplate};
use crate::state::AppState;
use tauri::State;

#[tauri::command]
pub async fn api_studio_list_templates(
    state: State<'_, AppState>,
) -> Result<Vec<MeetingTemplate>, String> {
    templates_store::list(state.db_manager.pool())
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn api_studio_save_template(
    state: State<'_, AppState>,
    template: MeetingTemplate,
) -> Result<(), String> {
    // Enforce the required {{transcript}} variable before persisting.
    if template_vars::validate(&template.prompt_body)
        .iter()
        .any(|i| matches!(i, ValidationIssue::MissingTranscript))
    {
        return Err("Template must include the {{transcript}} variable.".into());
    }
    templates_store::upsert(state.db_manager.pool(), &template)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn api_studio_delete_template(
    state: State<'_, AppState>,
    id: String,
) -> Result<(), String> {
    templates_store::delete(state.db_manager.pool(), &id)
        .await
        .map_err(|e| e.to_string())
}

/// Preview the exact prompt a template produces for a given transcript
/// (what-you-see-is-what-the-LLM-gets). The frontend passes the meeting's
/// transcript; other variables can be added here as the editor grows.
#[tauri::command]
pub async fn api_studio_preview_template(
    state: State<'_, AppState>,
    template_id: String,
    transcript: String,
) -> Result<String, String> {
    let template = templates_store::get(state.db_manager.pool(), &template_id)
        .await
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "Template not found".to_string())?;
    let ctx = TemplateContext { transcript, ..Default::default() };
    Ok(template_vars::expand(&template.prompt_body, &ctx))
}
