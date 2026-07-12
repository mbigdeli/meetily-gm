//! "Connect with Slack" orchestration — PKCE public-client flow, no secret.

use super::slack_accounts::{self, SlackAccount};
use super::{loopback, pkce, protocol};
use crate::connectors::secrets;
use crate::state::AppState;
use std::time::Duration;
use tauri::State;

/// Run the full PKCE OAuth dance and store the resulting user token (xoxp).
///
/// `client_id` + `redirect_uri` come from the one-time app setup (the static
/// callback page's URL). Opens the browser, waits for approval on a loopback
/// port, exchanges the code with the verifier (no client secret), and stores
/// the token. Returns the connected team name.
#[tauri::command]
pub async fn api_slack_oauth_connect(
    state: State<'_, AppState>,
    client_id: String,
    redirect_uri: String,
) -> Result<String, String> {
    let client_id = client_id.trim().to_string();
    let redirect_uri = redirect_uri.trim().to_string();
    if client_id.is_empty() || redirect_uri.is_empty() {
        return Err("Enter your Slack Client ID and callback URL first.".into());
    }

    let verifier = pkce::code_verifier();
    let challenge = pkce::challenge_s256(&verifier);
    let (listener, port) = loopback::bind_loopback().await?;
    // The static callback page reads the port from the state prefix to bounce
    // the browser back to this loopback listener.
    let oauth_state = format!("{}.{}", port, pkce::random_urlsafe(16));
    let auth_url = protocol::authorize_url(&client_id, &redirect_uri, &challenge, &oauth_state);

    crate::platform::open_external_url(&auth_url)?;

    let code = loopback::wait_for_code(listener, &oauth_state, Duration::from_secs(300)).await?;

    let client = reqwest::Client::new();
    let form = protocol::token_form(&client_id, &code, &verifier, &redirect_uri);
    let body = client
        .post(protocol::TOKEN_URL)
        .form(&form)
        .send()
        .await
        .map_err(|e| e.to_string())?
        .text()
        .await
        .map_err(|e| e.to_string())?;
    let auth = protocol::parse_user_token(&body)?;

    // Add (or refresh) this workspace and make it the active one.
    let pool = state.db_manager.pool();
    let list = slack_accounts::upsert(
        slack_accounts::load(pool).await?,
        SlackAccount { team_id: auth.team_id.clone(), team_name: auth.team.clone(), token: auth.user_token.clone() },
    );
    slack_accounts::save(pool, &list).await?;
    slack_accounts::set_active(pool, &list, &auth.team_id).await?;
    secrets::set(pool, "slack.client_id", &client_id).await.map_err(|e| e.to_string())?;
    secrets::set(pool, "slack.redirect_uri", &redirect_uri).await.map_err(|e| e.to_string())?;
    Ok(auth.team)
}

/// Connected Slack workspaces (no tokens) with the active one flagged.
#[tauri::command]
pub async fn api_slack_accounts(
    state: State<'_, AppState>,
) -> Result<Vec<slack_accounts::AccountView>, String> {
    let pool = state.db_manager.pool();
    let list = slack_accounts::load(pool).await?;
    let active = slack_accounts::active_team(pool).await?;
    Ok(slack_accounts::views(&list, &active))
}

/// Switch which connected workspace send/read act as.
#[tauri::command]
pub async fn api_slack_set_active(state: State<'_, AppState>, team_id: String) -> Result<(), String> {
    let pool = state.db_manager.pool();
    let list = slack_accounts::load(pool).await?;
    slack_accounts::set_active(pool, &list, &team_id).await
}

/// Remove one workspace. If it was active, activate a remaining one; if none
/// remain, fully disconnect Slack.
#[tauri::command]
pub async fn api_slack_disconnect_account(
    state: State<'_, AppState>,
    team_id: String,
) -> Result<(), String> {
    let pool = state.db_manager.pool();
    let list = slack_accounts::remove(slack_accounts::load(pool).await?, &team_id);
    if list.is_empty() {
        return secrets::delete_connector(pool, "slack").await.map_err(|e| e.to_string());
    }
    slack_accounts::save(pool, &list).await?;
    let active = slack_accounts::active_team(pool).await?;
    if !list.iter().any(|a| a.team_id == active) {
        let first = list[0].team_id.clone();
        slack_accounts::set_active(pool, &list, &first).await?;
    }
    Ok(())
}

/// Previously stored OAuth config so the UI can prefill the Client ID + callback.
#[tauri::command]
pub async fn api_slack_oauth_config(state: State<'_, AppState>) -> Result<(String, String), String> {
    let pool = state.db_manager.pool();
    let cid = secrets::get(pool, "slack.client_id").await.map_err(|e| e.to_string())?.unwrap_or_default();
    let uri = secrets::get(pool, "slack.redirect_uri").await.map_err(|e| e.to_string())?.unwrap_or_default();
    Ok((cid, uri))
}
