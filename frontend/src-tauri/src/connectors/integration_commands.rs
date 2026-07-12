//! Tauri commands tying connector secrets + payload builders + HTTP send
//! together (docs 07/08/10). Connect = store secrets; send = read secrets +
//! post. Frontend passes the recap/issue content it already shows.

use super::jira_client::{self, JiraCreate};
use super::{secrets, slack_client, slack_read};
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

/// Token that acts on the user's behalf: a user token (xoxp, acts as you) wins;
/// a bot token is the fallback.
async fn acting_slack_token(pool: &sqlx::SqlitePool) -> Result<Option<String>, String> {
    if let Some(u) = secrets::get(pool, "slack.user_token").await.map_err(|e| e.to_string())? {
        if !u.is_empty() {
            return Ok(Some(u));
        }
    }
    secrets::get(pool, "slack.bot_token").await.map_err(|e| e.to_string())
}

/// Post a meeting recap to Slack — as you if a user token is set, else the bot,
/// else an incoming webhook.
#[tauri::command]
pub async fn api_slack_send_recap(
    state: State<'_, AppState>,
    channel: String,
    title: String,
    context: String,
    summary_md: String,
) -> Result<String, String> {
    let pool = state.db_manager.pool();
    if let Some(tok) = acting_slack_token(pool).await? {
        return slack_client::post_message(&http(), &tok, &channel, &title, &context, &summary_md).await;
    }
    if let Some(url) = secrets::get(pool, "slack.webhook_url").await.map_err(|e| e.to_string())? {
        slack_client::post_webhook(&http(), &url, &title, &context, &summary_md).await?;
        return Ok(String::new());
    }
    Err("Slack is not connected — add a token or webhook URL in Integrations.".into())
}

/// List Slack channels the connected account can see (populates channel pickers).
#[tauri::command]
pub async fn api_slack_list_channels(
    state: State<'_, AppState>,
) -> Result<Vec<slack_read::SlackChannel>, String> {
    let tok = acting_slack_token(state.db_manager.pool())
        .await?
        .ok_or_else(|| "Slack is not connected.".to_string())?;
    slack_read::list_channels(&http(), &tok).await
}

/// Search Slack messages as the connected user (requires a user token, xoxp-…).
#[tauri::command]
pub async fn api_slack_search(
    state: State<'_, AppState>,
    query: String,
) -> Result<Vec<slack_read::SlackMessage>, String> {
    let tok = secrets::get(state.db_manager.pool(), "slack.user_token")
        .await
        .map_err(|e| e.to_string())?
        .filter(|t| !t.is_empty())
        .ok_or_else(|| "Slack search needs a User token (xoxp-…). Add one in Integrations.".to_string())?;
    slack_read::search_messages(&http(), &tok, &query).await
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
