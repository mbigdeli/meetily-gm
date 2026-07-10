//! Integration secrets/config in the `integration_settings` table (doc 10;
//! user chose DB storage, consistent with the app's existing API-key handling).
//! Key convention: "<connector>.<field>" (e.g. "slack.bot_token").

use sqlx::SqlitePool;

pub async fn set(pool: &SqlitePool, key: &str, value: &str) -> Result<(), sqlx::Error> {
    sqlx::query(
        "INSERT INTO integration_settings (key, value, updated_at) \
         VALUES (?, ?, strftime('%Y-%m-%dT%H:%M:%SZ','now')) \
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
    )
    .bind(key)
    .bind(value)
    .execute(pool)
    .await
    .map(|_| ())
}

pub async fn get(pool: &SqlitePool, key: &str) -> Result<Option<String>, sqlx::Error> {
    sqlx::query_scalar("SELECT value FROM integration_settings WHERE key = ?")
        .bind(key)
        .fetch_optional(pool)
        .await
}

/// Remove every key for a connector (disconnect), e.g. connector = "jira".
pub async fn delete_connector(pool: &SqlitePool, connector: &str) -> Result<(), sqlx::Error> {
    sqlx::query("DELETE FROM integration_settings WHERE key LIKE ?")
        .bind(format!("{connector}.%"))
        .execute(pool)
        .await
        .map(|_| ())
}

/// Distinct connector prefixes that have at least one stored key.
pub async fn connected(pool: &SqlitePool) -> Result<Vec<String>, sqlx::Error> {
    let keys: Vec<String> = sqlx::query_scalar("SELECT key FROM integration_settings")
        .fetch_all(pool)
        .await?;
    let mut set = std::collections::BTreeSet::new();
    for k in keys {
        if let Some((connector, _)) = k.split_once('.') {
            set.insert(connector.to_string());
        }
    }
    Ok(set.into_iter().collect())
}

#[cfg(test)]
mod tests {
    use super::*;
    use sqlx::sqlite::SqlitePoolOptions;

    async fn pool() -> SqlitePool {
        let p = SqlitePoolOptions::new().max_connections(1)
            .connect("sqlite::memory:").await.unwrap();
        sqlx::migrate!("./migrations").run(&p).await.unwrap();
        p
    }

    #[tokio::test]
    async fn set_get_update() {
        let p = pool().await;
        set(&p, "slack.bot_token", "xoxb-1").await.unwrap();
        assert_eq!(get(&p, "slack.bot_token").await.unwrap().as_deref(), Some("xoxb-1"));
        set(&p, "slack.bot_token", "xoxb-2").await.unwrap();
        assert_eq!(get(&p, "slack.bot_token").await.unwrap().as_deref(), Some("xoxb-2"));
        assert!(get(&p, "missing.key").await.unwrap().is_none());
    }

    #[tokio::test]
    async fn connected_and_disconnect() {
        let p = pool().await;
        set(&p, "slack.bot_token", "x").await.unwrap();
        set(&p, "jira.site", "https://a.atlassian.net").await.unwrap();
        set(&p, "jira.email", "me@x.com").await.unwrap();
        assert_eq!(connected(&p).await.unwrap(), vec!["jira".to_string(), "slack".to_string()]);
        delete_connector(&p, "jira").await.unwrap();
        assert_eq!(connected(&p).await.unwrap(), vec!["slack".to_string()]);
    }
}
