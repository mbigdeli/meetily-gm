//! Google Meet ingest server (Meetily-GM addition).
//!
//! A small localhost HTTP server the companion Chrome extension talks to. The
//! extension scrapes Google Meet's live captions (which already carry accurate
//! speaker *names*), the participant roster, and meeting metadata, and POSTs
//! them here. Captions are written straight into meetily's `transcripts` table
//! with `speaker` = the real participant name — so a Google Meet ends up as a
//! fully name-attributed transcript with no audio/whisper/diarization guesswork.
//! On session end we kick off meetily's normal summary pipeline (Codex, etc.).
//!
//! Security: binds to 127.0.0.1 only and requires `Authorization: Bearer <token>`
//! on every data endpoint. The token is generated once, stored under the app
//! data dir, and shown in Settings for one-time pairing with the extension.

use std::net::SocketAddr;
use std::sync::Arc;

use axum::{
    extract::State,
    http::{HeaderMap, StatusCode},
    routing::{get, post},
    Json, Router,
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sqlx::SqlitePool;
use tauri::{AppHandle, Emitter, Manager, Runtime};

use crate::state::AppState;

pub mod diarize;

/// Fixed localhost port (already whitelisted in the app's CSP connect-src).
pub const GMEET_INGEST_PORT: u16 = 5167;

struct IngestState<R: Runtime> {
    app: AppHandle<R>,
    token: Arc<String>,
}

// Manual Clone: deriving would wrongly require `R: Clone` (Runtime marker types
// aren't Clone), but AppHandle<R> is always Clone. axum's State needs this.
impl<R: Runtime> Clone for IngestState<R> {
    fn clone(&self) -> Self {
        Self {
            app: self.app.clone(),
            token: self.token.clone(),
        }
    }
}

// ---- pairing token -------------------------------------------------------

fn token_path<R: Runtime>(app: &AppHandle<R>) -> Option<std::path::PathBuf> {
    app.path()
        .app_data_dir()
        .ok()
        .map(|d| d.join("gmeet_pairing_token.txt"))
}

/// Load the pairing token, generating and persisting one on first run.
pub fn load_or_create_token<R: Runtime>(app: &AppHandle<R>) -> String {
    if let Some(path) = token_path(app) {
        if let Ok(existing) = std::fs::read_to_string(&path) {
            let trimmed = existing.trim().to_string();
            if !trimmed.is_empty() {
                return trimmed;
            }
        }
        let token = generate_token();
        if let Some(parent) = path.parent() {
            let _ = std::fs::create_dir_all(parent);
        }
        let _ = std::fs::write(&path, &token);
        return token;
    }
    generate_token()
}

fn generate_token() -> String {
    // 32 hex chars from a v4 UUID (no extra deps; uuid is already a dependency).
    let a = uuid::Uuid::new_v4().simple().to_string();
    let b = uuid::Uuid::new_v4().simple().to_string();
    format!("{a}{b}")
}

fn authed<R: Runtime>(headers: &HeaderMap, st: &IngestState<R>) -> bool {
    headers
        .get(axum::http::header::AUTHORIZATION)
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.strip_prefix("Bearer "))
        .map(|t| t == st.token.as_str())
        .unwrap_or(false)
}

// ---- request/response payloads ------------------------------------------

#[derive(Deserialize)]
struct SessionStartReq {
    /// Google Meet code (e.g. "abc-defg-hij"); used to resume same-meeting joins.
    meeting_code: Option<String>,
    title: Option<String>,
    #[serde(default)]
    participants: Vec<String>,
    /// Extension-owned gmeet session id (kept stable across pause/resume so
    /// captions + diarization stay unified). Backend mints one only if absent.
    session_id: Option<String>,
    /// True when the extension is resuming a recently-paused session (same Meet
    /// rejoined within the grace window).
    #[serde(default)]
    resume: bool,
}

#[derive(Serialize)]
struct SessionStartResp {
    /// The gmeet session id (returned in the `meeting_id` field for extension
    /// compatibility — it is the key the extension echoes on later calls).
    meeting_id: String,
    resumed: bool,
}

#[derive(Deserialize)]
struct CaptionItem {
    speaker: Option<String>,
    text: String,
    /// Milliseconds from meeting start (optional; used for ordering + overlap).
    ts_ms: Option<i64>,
}

#[derive(Deserialize)]
struct CaptionsReq {
    meeting_id: String,
    #[serde(default)]
    captions: Vec<CaptionItem>,
}

#[derive(Deserialize)]
struct ParticipantsReq {
    meeting_id: String,
    #[serde(default)]
    participants: Vec<String>,
}

#[derive(Deserialize)]
struct SessionEndReq {
    meeting_id: String,
}

#[derive(Deserialize)]
struct SessionPauseReq {
    meeting_id: String,
}

// ---- handlers ------------------------------------------------------------

async fn health() -> Json<Value> {
    Json(json!({
        "ok": true,
        "service": "meetily-gm gmeet ingest",
        "version": env!("CARGO_PKG_VERSION"),
    }))
}

fn now_iso() -> String {
    chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true)
}

fn pool_from<R: Runtime>(st: &IngestState<R>) -> Result<SqlitePool, StatusCode> {
    st.app
        .try_state::<AppState>()
        .map(|s| s.db_manager.pool().clone())
        .ok_or(StatusCode::SERVICE_UNAVAILABLE)
}

async fn session_start<R: Runtime>(
    State(st): State<IngestState<R>>,
    headers: HeaderMap,
    Json(req): Json<SessionStartReq>,
) -> Result<Json<SessionStartResp>, StatusCode> {
    if !authed(&headers, &st) {
        return Err(StatusCode::UNAUTHORIZED);
    }
    let title = req
        .title
        .filter(|t| !t.trim().is_empty())
        .unwrap_or_else(|| "Google Meet".to_string());

    // The extension owns the gmeet_session_id and keeps it stable across
    // pause/resume (same Meet rejoined within the grace window), so captions +
    // diarization stay unified. Mint one only if the extension didn't provide it.
    let code = req.meeting_code.as_deref().unwrap_or("adhoc");
    let gmeet_session_id = req
        .session_id
        .filter(|s| !s.trim().is_empty())
        .unwrap_or_else(|| format!("gmeet-{code}-{}", uuid::Uuid::new_v4()));

    // Tell the meetily frontend to start (or resume) its live recording.
    let _ = st.app.emit(
        "gmeet-start-recording",
        json!({
            "gmeet_session_id": gmeet_session_id,
            "title": title,
            "meeting_code": req.meeting_code,
            "resume": req.resume,
        }),
    );

    log::info!(
        "gmeet ingest: session_start -> {} (resume={}, participants={})",
        gmeet_session_id,
        req.resume,
        req.participants.len()
    );
    Ok(Json(SessionStartResp {
        meeting_id: gmeet_session_id,
        resumed: req.resume,
    }))
}

async fn session_pause<R: Runtime>(
    State(st): State<IngestState<R>>,
    headers: HeaderMap,
    Json(req): Json<SessionPauseReq>,
) -> Result<Json<Value>, StatusCode> {
    if !authed(&headers, &st) {
        return Err(StatusCode::UNAUTHORIZED);
    }
    // Meet closed/paused: pause meetily's recording and start the grace window.
    let _ = st.app.emit(
        "gmeet-pause-recording",
        json!({ "gmeet_session_id": req.meeting_id }),
    );
    log::info!("gmeet ingest: session_pause {} (emitted gmeet-pause-recording)", req.meeting_id);
    Ok(Json(json!({ "paused": true })))
}

async fn captions<R: Runtime>(
    State(st): State<IngestState<R>>,
    headers: HeaderMap,
    Json(req): Json<CaptionsReq>,
) -> Result<StatusCode, StatusCode> {
    if !authed(&headers, &st) {
        return Err(StatusCode::UNAUTHORIZED);
    }
    let pool = pool_from(&st)?;
    let now = now_iso();
    // req.meeting_id carries the gmeet_session_id (the value returned by start).
    for cap in &req.captions {
        let text = cap.text.trim();
        if text.is_empty() {
            continue;
        }
        let speaker = cap
            .speaker
            .as_deref()
            .map(str::trim)
            .filter(|s| !s.is_empty());
        sqlx::query(
            "INSERT INTO gmeet_captions (gmeet_session_id, speaker, text, ts_ms, created_at)
             VALUES (?, ?, ?, ?, ?)",
        )
        .bind(&req.meeting_id)
        .bind(speaker)
        .bind(text)
        .bind(cap.ts_ms)
        .bind(&now)
        .execute(&pool)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    }
    Ok(StatusCode::NO_CONTENT)
}

async fn participants<R: Runtime>(
    State(st): State<IngestState<R>>,
    headers: HeaderMap,
    Json(_req): Json<ParticipantsReq>,
) -> Result<StatusCode, StatusCode> {
    if !authed(&headers, &st) {
        return Err(StatusCode::UNAUTHORIZED);
    }
    // Speaker names come from the captions themselves; the roster is accepted
    // but not separately stored in this flow (kept for a future summary hint).
    Ok(StatusCode::NO_CONTENT)
}

async fn session_end<R: Runtime>(
    State(st): State<IngestState<R>>,
    headers: HeaderMap,
    Json(req): Json<SessionEndReq>,
) -> Result<Json<Value>, StatusCode> {
    if !authed(&headers, &st) {
        return Err(StatusCode::UNAUTHORIZED);
    }
    // Tell the frontend to stop recording + save; it then invokes
    // gmeet_finalize_diarization once the real meeting_id exists.
    let _ = st.app.emit(
        "gmeet-stop-recording",
        json!({ "gmeet_session_id": req.meeting_id }),
    );
    log::info!(
        "gmeet ingest: session_end {} (emitted gmeet-stop-recording)",
        req.meeting_id
    );
    Ok(Json(json!({ "stopping": true })))
}

// ---- server bootstrap ----------------------------------------------------

/// Pairing info for the Settings UI (the extension needs the token + URL).
#[derive(Serialize)]
pub struct GmeetPairingInfo {
    pub base_url: String,
    pub token: String,
}

/// Tauri command: return the ingest server URL + pairing token for the extension.
#[tauri::command]
pub fn gmeet_pairing_info<R: Runtime>(app: AppHandle<R>) -> GmeetPairingInfo {
    GmeetPairingInfo {
        base_url: format!("http://127.0.0.1:{GMEET_INGEST_PORT}"),
        token: load_or_create_token(&app),
    }
}

/// Build the router (exposed for tests).
fn router<R: Runtime>(state: IngestState<R>) -> Router {
    Router::new()
        .route("/gmeet/health", get(health))
        .route("/gmeet/session/start", post(session_start::<R>))
        .route("/gmeet/session/pause", post(session_pause::<R>))
        .route("/gmeet/session/end", post(session_end::<R>))
        .route("/gmeet/captions", post(captions::<R>))
        .route("/gmeet/participants", post(participants::<R>))
        .with_state(state)
}

/// Start the ingest server on 127.0.0.1:GMEET_INGEST_PORT. Call from the Tauri
/// setup hook inside `tauri::async_runtime::spawn`.
pub async fn serve<R: Runtime>(app: AppHandle<R>) {
    let token = Arc::new(load_or_create_token(&app));
    let state = IngestState {
        app,
        token: token.clone(),
    };
    let addr = SocketAddr::from(([127, 0, 0, 1], GMEET_INGEST_PORT));

    let listener = match tokio::net::TcpListener::bind(addr).await {
        Ok(l) => l,
        Err(e) => {
            log::error!("gmeet ingest: failed to bind {addr}: {e}");
            return;
        }
    };
    log::info!("gmeet ingest server listening on http://{addr}");
    if let Err(e) = axum::serve(listener, router(state)).await {
        log::error!("gmeet ingest server error: {e}");
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn generate_token_is_64_hex() {
        let t = generate_token();
        assert_eq!(t.len(), 64);
        assert!(t.chars().all(|c| c.is_ascii_hexdigit()));
    }
}
