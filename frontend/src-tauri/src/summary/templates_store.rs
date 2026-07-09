//! CRUD for Prompt Studio templates (doc 06 §3). Persists default + user
//! templates in SQLite. The `{{transcript}}` validation lives in the command
//! layer (`template_vars::validate`); this layer just stores/reads rows.

use serde::{Deserialize, Serialize};
use sqlx::SqlitePool;

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct MeetingTemplate {
    pub id: String,
    pub name: String,
    pub description: Option<String>,
    pub icon: Option<String>,
    pub prompt_body: String,
    pub is_default: bool,
    pub sort_order: i64,
    pub created_at: String,
    pub updated_at: String,
}

const COLS: &str =
    "id,name,description,icon,prompt_body,is_default,sort_order,created_at,updated_at";

/// Default templates first, then by sort order, then name.
pub async fn list(pool: &SqlitePool) -> Result<Vec<MeetingTemplate>, sqlx::Error> {
    let sql = format!(
        "SELECT {COLS} FROM meeting_templates ORDER BY is_default DESC, sort_order, name"
    );
    sqlx::query_as::<_, MeetingTemplate>(&sql).fetch_all(pool).await
}

pub async fn get(pool: &SqlitePool, id: &str) -> Result<Option<MeetingTemplate>, sqlx::Error> {
    let sql = format!("SELECT {COLS} FROM meeting_templates WHERE id = ?");
    sqlx::query_as::<_, MeetingTemplate>(&sql).bind(id).fetch_optional(pool).await
}

pub async fn upsert(pool: &SqlitePool, t: &MeetingTemplate) -> Result<(), sqlx::Error> {
    sqlx::query(
        "INSERT INTO meeting_templates \
         (id,name,description,icon,prompt_body,is_default,sort_order,created_at,updated_at) \
         VALUES (?,?,?,?,?,?,?,?,?) \
         ON CONFLICT(id) DO UPDATE SET \
         name=excluded.name, description=excluded.description, icon=excluded.icon, \
         prompt_body=excluded.prompt_body, sort_order=excluded.sort_order, \
         updated_at=excluded.updated_at",
    )
    .bind(&t.id).bind(&t.name).bind(&t.description).bind(&t.icon).bind(&t.prompt_body)
    .bind(t.is_default).bind(t.sort_order).bind(&t.created_at).bind(&t.updated_at)
    .execute(pool).await.map(|_| ())
}

/// Delete a user template. Defaults are protected (no-op) — use "reset" instead.
pub async fn delete(pool: &SqlitePool, id: &str) -> Result<(), sqlx::Error> {
    sqlx::query("DELETE FROM meeting_templates WHERE id = ? AND is_default = 0")
        .bind(id).execute(pool).await.map(|_| ())
}

pub async fn count(pool: &SqlitePool) -> Result<i64, sqlx::Error> {
    sqlx::query_scalar("SELECT COUNT(*) FROM meeting_templates").fetch_one(pool).await
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

    fn tmpl(id: &str, name: &str, default: bool, order: i64) -> MeetingTemplate {
        MeetingTemplate {
            id: id.into(), name: name.into(), description: None, icon: None,
            prompt_body: "{{transcript}}".into(), is_default: default, sort_order: order,
            created_at: "t0".into(), updated_at: "t0".into(),
        }
    }

    #[tokio::test]
    async fn upsert_list_get_delete() {
        let p = pool().await;
        upsert(&p, &tmpl("u1", "Mine", false, 5)).await.unwrap();
        upsert(&p, &tmpl("d1", "Default", true, 9)).await.unwrap();
        let all = list(&p).await.unwrap();
        assert_eq!(all.len(), 2);
        assert_eq!(all[0].id, "d1"); // defaults sort first
        assert_eq!(get(&p, "u1").await.unwrap().unwrap().name, "Mine");
    }

    #[tokio::test]
    async fn delete_protects_defaults() {
        let p = pool().await;
        upsert(&p, &tmpl("d1", "Default", true, 0)).await.unwrap();
        upsert(&p, &tmpl("u1", "Mine", false, 0)).await.unwrap();
        delete(&p, "d1").await.unwrap();
        delete(&p, "u1").await.unwrap();
        assert_eq!(count(&p).await.unwrap(), 1); // default survived, user gone
    }

    #[tokio::test]
    async fn upsert_updates_existing() {
        let p = pool().await;
        upsert(&p, &tmpl("u1", "Name A", false, 0)).await.unwrap();
        let mut t = tmpl("u1", "Name B", false, 0);
        t.updated_at = "t1".into();
        upsert(&p, &t).await.unwrap();
        assert_eq!(count(&p).await.unwrap(), 1);
        assert_eq!(get(&p, "u1").await.unwrap().unwrap().name, "Name B");
    }
}
