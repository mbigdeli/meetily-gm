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

use std::collections::HashMap;
use std::net::SocketAddr;
use std::sync::{Arc, Mutex};

use axum::{
    extract::{Query, State},
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
pub mod native_host;

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

// ---- resumability (single source of truth) -------------------------------
//
// Meetily — not the extension — owns whether a just-left Google Meet can still
// be resumed into the same session. A session becomes resumable when it pauses
// (Meet closed within the grace window) and stops being resumable the moment it
// is started/resumed again or finalized ("Stop & summarize now" or grace
// expiry). The extension asks via GET /gmeet/session/resume-check before it
// starts, so there is no independent extension timer to drift out of sync with
// the frontend grace countdown (the desync-bug family this replaces).
//
// Shared between the ingest server handlers and the `gmeet_clear_resumable`
// Tauri command through Tauri managed state.

/// Resumability state, keyed by Google Meet code.
#[derive(Default)]
pub struct GmeetResumeState {
    inner: Mutex<ResumeInner>,
}

#[derive(Default)]
struct ResumeInner {
    /// meeting_code -> resumable session_id (present only while paused).
    resumable: HashMap<String, String>,
    /// meeting_code -> actively-recording session_id (until pause/finalize).
    /// Lets a restarted extension re-adopt the live session instead of forking
    /// a second one (which orphaned its captions — the captions=0 bug).
    active: HashMap<String, String>,
    /// session_id -> meeting_code (so a finalize-by-session-id can find the code).
    session_code: HashMap<String, String>,
}

impl GmeetResumeState {
    /// A session started (fresh) or resumed: remember its code, and it is no
    /// longer a pending-resume candidate while it is actively recording.
    fn on_start(&self, session_id: &str, meeting_code: &str) {
        let mut g = self.inner.lock().expect("gmeet resume state poisoned");
        g.session_code
            .insert(session_id.to_string(), meeting_code.to_string());
        g.resumable.remove(meeting_code);
        g.active
            .insert(meeting_code.to_string(), session_id.to_string());
    }

    /// A session paused: it can be resumed by the same meeting code until it is
    /// resumed or finalized.
    fn on_pause(&self, session_id: &str) {
        let mut g = self.inner.lock().expect("gmeet resume state poisoned");
        if let Some(code) = g.session_code.get(session_id).cloned() {
            if g.active.get(&code).map(String::as_str) == Some(session_id) {
                g.active.remove(&code);
            }
            g.resumable.insert(code, session_id.to_string());
        }
    }

    /// The resumable session id for a meeting code, if any (paused sessions
    /// only — this is the GET /resume-check contract the extension polls).
    fn resume_check(&self, meeting_code: &str) -> Option<String> {
        self.inner
            .lock()
            .expect("gmeet resume state poisoned")
            .resumable
            .get(meeting_code)
            .cloned()
    }

    /// The reusable session id for a meeting code: a paused session in its
    /// grace window, or the actively-recording one. Used by session_start to
    /// re-adopt a live session when a restarted extension lost its id.
    fn reusable(&self, meeting_code: &str) -> Option<String> {
        let g = self.inner.lock().expect("gmeet resume state poisoned");
        g.resumable
            .get(meeting_code)
            .or_else(|| g.active.get(meeting_code))
            .cloned()
    }

    /// A session was finalized: forget its code mapping and drop its resumable
    /// entry — but only if that entry still points at *this* session (a newer
    /// session for the same code may have replaced it).
    fn clear(&self, session_id: &str) {
        let mut g = self.inner.lock().expect("gmeet resume state poisoned");
        if let Some(code) = g.session_code.remove(session_id) {
            if g.resumable.get(&code).map(String::as_str) == Some(session_id) {
                g.resumable.remove(&code);
            }
            if g.active.get(&code).map(String::as_str) == Some(session_id) {
                g.active.remove(&code);
            }
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

#[derive(Deserialize)]
struct ResumeCheckQuery {
    meeting_code: Option<String>,
}

#[derive(Serialize)]
struct ResumeCheckResp {
    resumable: bool,
    session_id: Option<String>,
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

    let code = req.meeting_code.as_deref().unwrap_or("adhoc");
    let requested_id = req
        .session_id
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty());

    // Meetily is authoritative for resumability. Honor `resume` ONLY if the id
    // the extension wants to resume is still the one we hold as resumable for
    // this code — it may have been finalized (grace expiry / "Stop & summarize
    // now") between the extension's resume-check and this start POST. Otherwise
    // start fresh under a brand-new id, never reusing a possibly-finalized id
    // (which would append a new meeting's captions to an already-summarized
    // session — the contamination bug this guards against).
    let resume_state = st.app.try_state::<GmeetResumeState>();
    let reusable_id = resume_state.as_ref().and_then(|rs| rs.reusable(code));
    let (gmeet_session_id, resume) = match (req.resume, requested_id) {
        // Resume honored: the id the extension wants is still the reusable one
        // (paused in its grace window, or still actively recording).
        (true, Some(req_id)) if reusable_id.as_deref() == Some(req_id) => {
            (req_id.to_string(), true)
        }
        // Resume requested but stale (finalized since the extension checked) →
        // mint a fresh id; never reuse a possibly-finalized id.
        (true, _) => (format!("gmeet-{code}-{}", uuid::Uuid::new_v4()), false),
        // Fresh start, but this meeting code already has a live/paused session:
        // the extension (content script or SW) restarted and lost its id. Adopt
        // the existing session instead of forking a second one — forking
        // orphaned all captions sent under the old id (the captions=0 bug).
        (false, _) if reusable_id.is_some() => {
            let id = reusable_id.clone().unwrap_or_default();
            log::info!("gmeet ingest: adopting existing session {id} for code {code}");
            (id, true)
        }
        // Fresh start with the extension's own id.
        (false, Some(req_id)) => (req_id.to_string(), false),
        // Fresh start, minting an id (extension omitted one).
        (false, None) => (format!("gmeet-{code}-{}", uuid::Uuid::new_v4()), false),
    };

    // Record the (session_id -> code) mapping and drop any resumable entry for
    // this code: while actively recording it is not a pending-resume candidate.
    if let Some(rs) = resume_state.as_ref() {
        rs.on_start(&gmeet_session_id, code);
    }

    // Tell the meetily frontend to start (or resume) its live recording.
    let _ = st.app.emit(
        "gmeet-start-recording",
        json!({
            "gmeet_session_id": gmeet_session_id,
            "title": title,
            "meeting_code": req.meeting_code,
            "resume": resume,
        }),
    );

    log::info!(
        "gmeet ingest: session_start -> {} (resume={}, requested_resume={}, participants={})",
        gmeet_session_id,
        resume,
        req.resume,
        req.participants.len()
    );
    Ok(Json(SessionStartResp {
        meeting_id: gmeet_session_id,
        resumed: resume,
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
    // Meet closed/paused: the session becomes resumable (by its meeting code)
    // until it is resumed or finalized.
    if let Some(rs) = st.app.try_state::<GmeetResumeState>() {
        rs.on_pause(&req.meeting_id);
    }
    // Pause meetily's recording and start the grace window.
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
    // Finalized → no longer resumable. (The frontend clears via
    // gmeet_clear_resumable on its own finalize path; this covers a session_end
    // that arrives over the wire.)
    if let Some(rs) = st.app.try_state::<GmeetResumeState>() {
        rs.clear(&req.meeting_id);
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

/// GET /gmeet/session/resume-check?meeting_code=X — the extension asks this
/// before starting so it can reuse a paused session's id (resume) instead of
/// running its own timer. Meetily is the single source of truth.
async fn resume_check<R: Runtime>(
    State(st): State<IngestState<R>>,
    headers: HeaderMap,
    Query(q): Query<ResumeCheckQuery>,
) -> Result<Json<ResumeCheckResp>, StatusCode> {
    if !authed(&headers, &st) {
        return Err(StatusCode::UNAUTHORIZED);
    }
    let code = q.meeting_code.as_deref().unwrap_or("adhoc");
    let session_id = st
        .app
        .try_state::<GmeetResumeState>()
        .and_then(|rs| rs.resume_check(code));
    Ok(Json(ResumeCheckResp {
        resumable: session_id.is_some(),
        session_id,
    }))
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

/// Tauri command: the frontend calls this when it finalizes a gmeet recording
/// (grace expiry or "Stop & summarize now") so the session stops being a
/// resume candidate. Idempotent; a no-op if the session was never tracked.
#[tauri::command]
pub fn gmeet_clear_resumable<R: Runtime>(app: AppHandle<R>, session_id: String) {
    if let Some(rs) = app.try_state::<GmeetResumeState>() {
        rs.clear(&session_id);
    }
}

/// Build the router (exposed for tests).
fn router<R: Runtime>(state: IngestState<R>) -> Router {
    Router::new()
        .route("/gmeet/health", get(health))
        .route("/gmeet/session/start", post(session_start::<R>))
        .route("/gmeet/session/pause", post(session_pause::<R>))
        .route("/gmeet/session/end", post(session_end::<R>))
        .route("/gmeet/session/resume-check", get(resume_check::<R>))
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

    // ---- GmeetResumeState: the resume/desync bug family --------------------

    const CODE: &str = "abc-defg-hij";

    #[test]
    fn fresh_meeting_is_not_resumable() {
        let s = GmeetResumeState::default();
        s.on_start("sess-1", CODE);
        // Started but never paused → nothing to resume.
        assert_eq!(s.resume_check(CODE), None);
    }

    #[test]
    fn active_session_is_adoptable_by_session_start() {
        // Extension restarted mid-meeting and lost its id: session_start must
        // re-adopt the live session instead of forking a second one (the fork
        // orphaned every caption sent under the first id → captions=0).
        let s = GmeetResumeState::default();
        s.on_start("sess-1", CODE);
        assert_eq!(s.reusable(CODE), Some("sess-1".to_string()));
        // But the public resume-check contract stays paused-only.
        assert_eq!(s.resume_check(CODE), None);
    }

    #[test]
    fn pause_moves_session_from_active_to_resumable() {
        let s = GmeetResumeState::default();
        s.on_start("sess-1", CODE);
        s.on_pause("sess-1");
        assert_eq!(s.resume_check(CODE), Some("sess-1".to_string()));
        assert_eq!(s.reusable(CODE), Some("sess-1".to_string()));
    }

    #[test]
    fn finalize_clears_active_adoption_too() {
        let s = GmeetResumeState::default();
        s.on_start("sess-1", CODE);
        s.clear("sess-1");
        assert_eq!(s.reusable(CODE), None, "finalized id must never be re-adopted");
    }

    #[test]
    fn pause_makes_session_resumable() {
        let s = GmeetResumeState::default();
        s.on_start("sess-1", CODE);
        s.on_pause("sess-1");
        assert_eq!(s.resume_check(CODE), Some("sess-1".to_string()));
    }

    #[test]
    fn resume_clears_resumability_until_next_pause() {
        let s = GmeetResumeState::default();
        s.on_start("sess-1", CODE);
        s.on_pause("sess-1");
        // Rejoin resumes the same id → actively recording, not resumable.
        s.on_start("sess-1", CODE);
        assert_eq!(s.resume_check(CODE), None);
    }

    #[test]
    fn finalize_clears_resumability() {
        // "Stop & summarize now" (or grace expiry) → next join of this Meet is
        // fresh, so the finalized session's id is never reused (no caption
        // contamination).
        let s = GmeetResumeState::default();
        s.on_start("sess-1", CODE);
        s.on_pause("sess-1");
        s.clear("sess-1");
        assert_eq!(s.resume_check(CODE), None);
    }

    #[test]
    fn resumed_session_can_be_resumed_again() {
        // Regression guard: clearing on resume (or dropping the session->code
        // mapping too eagerly) would break a *second* resume of the same Meet.
        let s = GmeetResumeState::default();
        s.on_start("sess-1", CODE);
        s.on_pause("sess-1");
        s.on_start("sess-1", CODE); // resume #1
        s.on_pause("sess-1"); // paused again
        assert_eq!(s.resume_check(CODE), Some("sess-1".to_string()));
    }

    #[test]
    fn clear_only_drops_entry_still_pointing_at_that_session() {
        // A newer session replaced the resumable slot for this code; a late
        // finalize of the OLD session must not wipe the new one's resumability.
        let s = GmeetResumeState::default();
        s.on_start("old", CODE);
        s.on_pause("old"); // resumable[CODE] = old
        s.on_start("new", CODE); // resumable[CODE] cleared, session_code[new]=CODE
        s.on_pause("new"); // resumable[CODE] = new
        s.clear("old"); // stale finalize of old
        assert_eq!(s.resume_check(CODE), Some("new".to_string()));
    }

    #[test]
    fn pause_of_untracked_session_is_noop() {
        // A pause for a session we never saw start (e.g. after a restart) must
        // not invent a resumable entry keyed by a mystery code.
        let s = GmeetResumeState::default();
        s.on_pause("ghost");
        assert_eq!(s.resume_check(CODE), None);
        assert_eq!(s.resume_check("adhoc"), None);
    }
}
