//! Slack OAuth via PKCE (public-client flow).
//!
//! Connects a Slack account with **no client secret and no backend**: Miting
//! generates a PKCE verifier locally, the user approves in their browser, a
//! static callback page bounces the `code` to Miting's loopback listener, and
//! Miting exchanges it (code + verifier, no secret) for a user token (xoxp).
//!
//! `pkce` + `protocol` are pure and unit-tested; the runtime loopback flow and
//! Tauri command build on them (follow-up increment).

pub mod flow;
pub mod loopback;
pub mod pkce;
pub mod protocol;
pub mod slack_accounts;
