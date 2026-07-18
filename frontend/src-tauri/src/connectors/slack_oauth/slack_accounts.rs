//! Multiple connected Slack workspaces.
//!
//! Stored as a JSON list under the secrets key `slack.accounts`;
//! `slack.active_team` marks which one send/read act as — its token is mirrored
//! to `slack.user_token`, so the existing send/list/search paths keep working
//! against the active workspace with no change. Pure helpers + DB helpers here;
//! the Tauri commands live in `flow`.

use crate::connectors::secrets;
use serde::{Deserialize, Serialize};
use sqlx::SqlitePool;

pub const ACCOUNTS_KEY: &str = "slack.accounts";
pub const ACTIVE_KEY: &str = "slack.active_team";

#[derive(Serialize, Deserialize, Clone, PartialEq, Debug)]
pub struct SlackAccount {
    pub team_id: String,
    pub team_name: String,
    pub token: String,
}

/// Account info safe to hand the UI — never includes the token.
#[derive(Serialize, Debug, PartialEq)]
pub struct AccountView {
    pub team_id: String,
    pub team_name: String,
    pub active: bool,
}

pub fn parse(json: &str) -> Vec<SlackAccount> {
    serde_json::from_str(json).unwrap_or_default()
}

pub fn to_json(list: &[SlackAccount]) -> String {
    serde_json::to_string(list).unwrap_or_else(|_| "[]".into())
}

/// Insert or replace an account by team_id.
pub fn upsert(mut list: Vec<SlackAccount>, acc: SlackAccount) -> Vec<SlackAccount> {
    list.retain(|a| a.team_id != acc.team_id);
    list.push(acc);
    list
}

pub fn remove(mut list: Vec<SlackAccount>, team_id: &str) -> Vec<SlackAccount> {
    list.retain(|a| a.team_id != team_id);
    list
}

pub fn token_for<'a>(list: &'a [SlackAccount], team_id: &str) -> Option<&'a str> {
    list.iter().find(|a| a.team_id == team_id).map(|a| a.token.as_str())
}

pub fn views(list: &[SlackAccount], active: &str) -> Vec<AccountView> {
    list.iter()
        .map(|a| AccountView {
            team_id: a.team_id.clone(),
            team_name: a.team_name.clone(),
            active: a.team_id == active,
        })
        .collect()
}

pub async fn load(pool: &SqlitePool) -> Result<Vec<SlackAccount>, String> {
    let json = secrets::get(pool, ACCOUNTS_KEY).await.map_err(|e| e.to_string())?;
    Ok(json.map(|j| parse(&j)).unwrap_or_default())
}

pub async fn save(pool: &SqlitePool, list: &[SlackAccount]) -> Result<(), String> {
    secrets::set(pool, ACCOUNTS_KEY, &to_json(list)).await.map_err(|e| e.to_string())
}

/// Point the active-workspace keys at `team_id`, mirroring its token to
/// `slack.user_token` so send/read act as that workspace.
pub async fn set_active(pool: &SqlitePool, list: &[SlackAccount], team_id: &str) -> Result<(), String> {
    let token = token_for(list, team_id).ok_or("unknown_workspace")?;
    secrets::set(pool, ACTIVE_KEY, team_id).await.map_err(|e| e.to_string())?;
    secrets::set(pool, "slack.user_token", token).await.map_err(|e| e.to_string())?;
    Ok(())
}

pub async fn active_team(pool: &SqlitePool) -> Result<String, String> {
    Ok(secrets::get(pool, ACTIVE_KEY).await.map_err(|e| e.to_string())?.unwrap_or_default())
}

#[cfg(test)]
mod tests {
    use super::*;
    fn acc(id: &str, name: &str) -> SlackAccount {
        SlackAccount { team_id: id.into(), team_name: name.into(), token: format!("xoxp-{id}") }
    }
    #[test]
    fn upsert_dedupes_by_team() {
        let l = upsert(vec![acc("T1", "A")], acc("T1", "A renamed"));
        assert_eq!(l.len(), 1);
        assert_eq!(l[0].team_name, "A renamed");
    }
    #[test]
    fn remove_and_token_for() {
        let l = upsert(upsert(vec![], acc("T1", "A")), acc("T2", "B"));
        assert_eq!(token_for(&l, "T2"), Some("xoxp-T2"));
        let l = remove(l, "T1");
        assert!(token_for(&l, "T1").is_none());
    }
    #[test]
    fn views_marks_active() {
        let l = upsert(upsert(vec![], acc("T1", "A")), acc("T2", "B"));
        let v = views(&l, "T2");
        assert!(!v[0].active && v[1].active);
    }
    #[test]
    fn parse_bad_json_is_empty() {
        assert!(parse("not json").is_empty());
    }
}
