use chrono::Utc;
use sqlx::SqlitePool;

pub async fn recover_interrupted_summaries(pool: &SqlitePool) -> Result<u64, sqlx::Error> {
    let now = Utc::now();
    let result = sqlx::query(
        "UPDATE summary_processes
         SET status = 'cancelled',
             updated_at = ?,
             end_time = ?,
             error = 'Generation was interrupted by application restart',
             result = COALESCE(result_backup, result),
             result_backup = NULL,
             result_backup_timestamp = NULL
         WHERE LOWER(status) IN ('pending', 'processing', 'summarizing', 'regenerating')",
    )
    .bind(now)
    .bind(now)
    .execute(pool)
    .await?;
    Ok(result.rows_affected())
}

#[cfg(test)]
mod tests {
    use super::*;
    use sqlx::sqlite::SqlitePoolOptions;

    #[tokio::test]
    async fn restores_interrupted_summary_without_touching_completed_rows() {
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .unwrap();
        sqlx::query(
            "CREATE TABLE summary_processes (
                meeting_id TEXT, status TEXT, updated_at TEXT, end_time TEXT,
                error TEXT, result TEXT, result_backup TEXT,
                result_backup_timestamp TEXT
             );
             INSERT INTO summary_processes VALUES
                ('pending', 'PENDING', '', NULL, NULL, 'new', 'old', ''),
                ('done', 'completed', '', NULL, NULL, 'done', NULL, NULL);",
        )
        .execute(&pool)
        .await
        .unwrap();

        assert_eq!(recover_interrupted_summaries(&pool).await.unwrap(), 1);
        let pending: (String, String, Option<String>) = sqlx::query_as(
            "SELECT status, result, result_backup FROM summary_processes
             WHERE meeting_id = 'pending'",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        let completed: (String, String) = sqlx::query_as(
            "SELECT status, result FROM summary_processes WHERE meeting_id = 'done'",
        )
        .fetch_one(&pool)
        .await
        .unwrap();

        assert_eq!(pending, ("cancelled".into(), "old".into(), None));
        assert_eq!(completed, ("completed".into(), "done".into()));
    }
}
