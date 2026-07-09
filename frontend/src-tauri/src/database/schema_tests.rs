//! Migration-chain integration tests (fills the database/ test gap, doc 09/A3).
//! Applies the full embedded migration set to a fresh in-memory DB and asserts
//! new columns exist — guards every migration against a broken chain.

use sqlx::sqlite::SqlitePoolOptions;
use sqlx::SqlitePool;

async fn fresh_migrated_pool() -> SqlitePool {
    // max_connections(1): a multi-connection `:memory:` pool would give each
    // connection its own empty DB — migrate and query must share one.
    let pool = SqlitePoolOptions::new()
        .max_connections(1)
        .connect("sqlite::memory:")
        .await
        .expect("open in-memory sqlite");
    sqlx::migrate!("./migrations")
        .run(&pool)
        .await
        .expect("all migrations apply cleanly on a fresh DB");
    pool
}

async fn columns(pool: &SqlitePool, table: &str) -> Vec<String> {
    sqlx::query_scalar::<_, String>(&format!("SELECT name FROM pragma_table_info('{table}')"))
        .fetch_all(pool)
        .await
        .expect("read table_info")
}

#[tokio::test]
async fn full_migration_chain_applies_on_fresh_db() {
    // The mere fact that this returns without panicking proves the chain is intact.
    let _pool = fresh_migrated_pool().await;
}

#[tokio::test]
async fn meetings_library_columns_present() {
    let pool = fresh_migrated_pool().await;
    let cols = columns(&pool, "meetings").await;
    assert!(cols.contains(&"starred".to_string()), "missing starred: {cols:?}");
    assert!(cols.contains(&"duration_sec".to_string()), "missing duration_sec: {cols:?}");
    assert!(cols.contains(&"template_id".to_string()), "missing template_id: {cols:?}");
}

#[tokio::test]
async fn meeting_templates_table_present() {
    let pool = fresh_migrated_pool().await;
    let cols = columns(&pool, "meeting_templates").await;
    assert!(cols.contains(&"prompt_body".to_string()), "missing prompt_body: {cols:?}");
    assert!(cols.contains(&"is_default".to_string()), "missing is_default: {cols:?}");
}
