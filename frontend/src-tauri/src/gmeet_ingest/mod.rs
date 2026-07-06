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
use tauri::{AppHandle, Manager, Runtime};

use crate::state::AppState;

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
}

#[derive(Serialize)]
struct SessionStartResp {
    meeting_id: String,
    resumed: bool,
}

#[derive(Deserialize)]
struct CaptionItem {
    speaker: Option<String>,
    text: String,
    /// Milliseconds from meeting start (optional; used for ordering).
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
    let pool = pool_from(&st)?;
    let now = now_iso();
    let title = req
        .title
        .filter(|t| !t.trim().is_empty())
        .unwrap_or_else(|| "Google Meet".to_string());

    // Resume an existing meeting for the same Meet code if one exists and has no
    // summary yet (same-meeting rejoin), else create a fresh meeting.
    let existing: Option<String> = if let Some(code) = req.meeting_code.as_deref() {
        sqlx::query_scalar::<_, String>(
            "SELECT id FROM meetings WHERE id LIKE ? ORDER BY created_at DESC LIMIT 1",
        )
        .bind(format!("gmeet-{code}-%"))
        .fetch_optional(&pool)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?
    } else {
        None
    };

    let (meeting_id, resumed) = if let Some(id) = existing {
        (id, true)
    } else {
        let code = req.meeting_code.as_deref().unwrap_or("adhoc");
        let id = format!("gmeet-{code}-{}", uuid::Uuid::new_v4());
        sqlx::query("INSERT INTO meetings (id, title, created_at, updated_at) VALUES (?, ?, ?, ?)")
            .bind(&id)
            .bind(&title)
            .bind(&now)
            .bind(&now)
            .execute(&pool)
            .await
            .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
        (id, false)
    };

    upsert_participants(&pool, &meeting_id, &req.participants, &now).await?;

    log::info!(
        "gmeet ingest: session_start meeting_id={} resumed={} participants={}",
        meeting_id,
        resumed,
        req.participants.len()
    );
    Ok(Json(SessionStartResp {
        meeting_id,
        resumed,
    }))
}

async fn upsert_participants(
    pool: &SqlitePool,
    meeting_id: &str,
    names: &[String],
    now: &str,
) -> Result<(), StatusCode> {
    for name in names {
        let name = name.trim();
        if name.is_empty() {
            continue;
        }
        sqlx::query(
            "INSERT INTO meeting_participants (meeting_id, name, updated_at) VALUES (?, ?, ?)
             ON CONFLICT(meeting_id, name) DO UPDATE SET updated_at = excluded.updated_at",
        )
        .bind(meeting_id)
        .bind(name)
        .bind(now)
        .execute(pool)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    }
    Ok(())
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
    for cap in &req.captions {
        let text = cap.text.trim();
        if text.is_empty() {
            continue;
        }
        let id = uuid::Uuid::new_v4().to_string();
        let speaker = cap
            .speaker
            .as_deref()
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .unwrap_or("Unknown");
        // ts_ms lets the UI order/segment; stored in timestamp as-is when present.
        let ts = cap
            .ts_ms
            .map(|ms| ms.to_string())
            .unwrap_or_else(|| now.clone());
        sqlx::query(
            "INSERT INTO transcripts (id, meeting_id, transcript, timestamp, speaker)
             VALUES (?, ?, ?, ?, ?)",
        )
        .bind(&id)
        .bind(&req.meeting_id)
        .bind(text)
        .bind(&ts)
        .bind(speaker)
        .execute(&pool)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    }
    Ok(StatusCode::NO_CONTENT)
}

async fn participants<R: Runtime>(
    State(st): State<IngestState<R>>,
    headers: HeaderMap,
    Json(req): Json<ParticipantsReq>,
) -> Result<StatusCode, StatusCode> {
    if !authed(&headers, &st) {
        return Err(StatusCode::UNAUTHORIZED);
    }
    let pool = pool_from(&st)?;
    upsert_participants(&pool, &req.meeting_id, &req.participants, &now_iso()).await?;
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
    let pool = pool_from(&st)?;

    // Build the transcript text (named lines) from stored captions.
    let rows = sqlx::query_as::<_, (Option<String>, String)>(
        "SELECT speaker, transcript FROM transcripts WHERE meeting_id = ? ORDER BY rowid ASC",
    )
    .bind(&req.meeting_id)
    .fetch_all(&pool)
    .await
    .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    if rows.is_empty() {
        log::warn!(
            "gmeet ingest: session_end for {} but no captions captured; skipping summary",
            req.meeting_id
        );
        return Ok(Json(json!({ "summarizing": false, "reason": "no_captions" })));
    }

    let transcript_text = rows
        .iter()
        .map(|(spk, txt)| format!("{}: {}", spk.as_deref().unwrap_or("Unknown"), txt))
        .collect::<Vec<_>>()
        .join("\n");

    // Use the user's configured summary provider (Codex, Ollama, ...); default to codex.
    let (provider, model) = read_summary_provider(&pool).await;

    log::info!(
        "gmeet ingest: session_end meeting_id={} provider={} lines={} -> starting summary",
        req.meeting_id,
        provider,
        rows.len()
    );

    // Create the summary_processes row first; process_transcript_background only
    // *updates* it, so without this the summary result is never persisted.
    if let Err(e) =
        crate::database::repositories::summary::SummaryProcessesRepository::create_or_reset_process(
            &pool,
            &req.meeting_id,
        )
        .await
    {
        log::error!("gmeet ingest: failed to init summary process: {e}");
        return Err(StatusCode::INTERNAL_SERVER_ERROR);
    }

    // Run the summary in the background so the HTTP response returns immediately
    // (a Codex run can take minutes; the extension must not block on it).
    let app = st.app.clone();
    let meeting_id = req.meeting_id.clone();
    let provider_bg = provider.clone();
    tauri::async_runtime::spawn(async move {
        crate::summary::service::SummaryService::process_transcript_background(
            app,
            pool,
            meeting_id,
            transcript_text,
            provider_bg,
            model,
            String::new(),
            "standard_meeting".to_string(),
            None,
        )
        .await;
    });

    Ok(Json(json!({ "summarizing": true, "provider": provider })))
}

/// Read the configured summary provider/model, defaulting to Codex.
async fn read_summary_provider(pool: &SqlitePool) -> (String, String) {
    let row = sqlx::query_as::<_, (Option<String>, Option<String>)>(
        "SELECT provider, model FROM settings WHERE id = '1'",
    )
    .fetch_optional(pool)
    .await
    .ok()
    .flatten();
    match row {
        Some((Some(p), m)) if !p.is_empty() => (p, m.unwrap_or_else(|| "default".to_string())),
        _ => ("codex".to_string(), "default".to_string()),
    }
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
