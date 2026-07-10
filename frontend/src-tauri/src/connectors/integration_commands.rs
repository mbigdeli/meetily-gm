//! Tauri commands tying connector secrets + payload builders + HTTP send
//! together (docs 07/08/10). Connect = store secrets; send = read secrets +
//! post. Frontend passes the recap/issue content it already shows.

use super::jira_client::{self, JiraCreate};
use super::{secrets, slack_client};
use crate::state::AppState;
use serde::Deserialize;
use tauri::State;

fn http() -> reqwest::Client {
    reqwest::Client::new()
}

#[tauri::command]
pub async fn api_set_integration_secret(
    state: State<'_, AppState>,
    key: String,
    value: String,
) -> Result<(), String> {
    secrets::set(state.db_manager.pool(), &key, &value).await.map_err(|e| e.to_string())
}

/// Connectors that have credentials stored (e.g. ["jira","slack"]).
#[tauri::command]
pub async fn api_integration_status(state: State<'_, AppState>) -> Result<Vec<String>, String> {
    secrets::connected(state.db_manager.pool()).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn api_disconnect_integration(
    state: State<'_, AppState>,
    connector: String,
) -> Result<(), String> {
    secrets::delete_connector(state.db_manager.pool(), &connector).await.map_err(|e| e.to_string())
}

/// Post a meeting recap to Slack: bot token if present, else webhook.
#[tauri::command]
pub async fn api_slack_send_recap(
    state: State<'_, AppState>,
    channel: String,
    title: String,
    context: String,
    summary_md: String,
) -> Result<String, String> {
    let pool = state.db_manager.pool();
    if let Some(tok) = secrets::get(pool, "slack.bot_token").await.map_err(|e| e.to_string())? {
        return slack_client::post_message(&http(), &tok, &channel, &title, &context, &summary_md).await;
    }
    if let Some(url) = secrets::get(pool, "slack.webhook_url").await.map_err(|e| e.to_string())? {
        slack_client::post_webhook(&http(), &url, &title, &context, &summary_md).await?;
        return Ok(String::new());
    }
    Err("Slack is not connected — add a bot token or webhook URL in Integrations.".into())
}

#[derive(Deserialize)]
pub struct JiraIssueInput {
    pub project_id: String,
    pub issuetype_id: String,
    pub summary: String,
    pub description_md: String,
    #[serde(default)]
    pub labels: Vec<String>,
    pub assignee_account_id: Option<String>,
    pub due: Option<String>,
}

#[tauri::command]
pub async fn api_jira_create_issue(
    state: State<'_, AppState>,
    input: JiraIssueInput,
) -> Result<(String, String), String> {
    let pool = state.db_manager.pool();
    let site = secrets::get(pool, "jira.site").await.map_err(|e| e.to_string())?
        .ok_or_else(|| "Jira not connected (missing site) — connect it in Integrations.".to_string())?;
    let email = secrets::get(pool, "jira.email").await.map_err(|e| e.to_string())?
        .ok_or_else(|| "Jira not connected (missing email).".to_string())?;
    let token = secrets::get(pool, "jira.api_token").await.map_err(|e| e.to_string())?
        .ok_or_else(|| "Jira not connected (missing API token).".to_string())?;
    jira_client::create_issue(
        &http(),
        JiraCreate {
            site_base: &site,
            email: &email,
            api_token: &token,
            project_id: &input.project_id,
            issuetype_id: &input.issuetype_id,
            summary: &input.summary,
            description_md: &input.description_md,
            labels: &input.labels,
            assignee_account_id: input.assignee_account_id.as_deref(),
            due: input.due.as_deref(),
        },
    )
    .await
}
