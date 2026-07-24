use chrono::Utc;
use sqlx::{Result, SqlitePool};

pub struct TranscriptEnhancementRepository;

impl TranscriptEnhancementRepository {
    pub async fn replace_texts(
        pool: &SqlitePool,
        meeting_id: &str,
        texts: &[String],
    ) -> Result<bool> {
        let mut transaction = pool.begin().await?;
        let ids = sqlx::query_scalar::<_, String>(
            "SELECT id FROM transcripts WHERE meeting_id = ? ORDER BY rowid",
        )
        .bind(meeting_id)
        .fetch_all(&mut *transaction)
        .await?;

        if ids.len() != texts.len() {
            return Ok(false);
        }

        for (id, text) in ids.iter().zip(texts) {
            sqlx::query("UPDATE transcripts SET transcript = ? WHERE id = ?")
                .bind(text)
                .bind(id)
                .execute(&mut *transaction)
                .await?;
        }
        sqlx::query("UPDATE meetings SET updated_at = ? WHERE id = ?")
            .bind(Utc::now())
            .bind(meeting_id)
            .execute(&mut *transaction)
            .await?;
        transaction.commit().await?;
        Ok(true)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn replaces_only_text_and_requires_matching_count() {
        let pool = SqlitePool::connect("sqlite::memory:").await.unwrap();
        sqlx::query("CREATE TABLE meetings(id TEXT, updated_at TEXT)")
            .execute(&pool)
            .await
            .unwrap();
        sqlx::query(
            "CREATE TABLE transcripts(id TEXT, meeting_id TEXT, transcript TEXT, timestamp TEXT)",
        )
        .execute(&pool)
        .await
        .unwrap();
        sqlx::query("INSERT INTO meetings VALUES('m1', 'old')")
            .execute(&pool)
            .await
            .unwrap();
        for (id, text, timestamp) in [("a", "raw one", "00:01"), ("b", "raw two", "00:02")] {
            sqlx::query("INSERT INTO transcripts VALUES(?, 'm1', ?, ?)")
                .bind(id)
                .bind(text)
                .bind(timestamp)
                .execute(&pool)
                .await
                .unwrap();
        }

        assert!(!TranscriptEnhancementRepository::replace_texts(
            &pool,
            "m1",
            &["wrong count".into()]
        )
        .await
        .unwrap());
        assert!(TranscriptEnhancementRepository::replace_texts(
            &pool,
            "m1",
            &["better one".into(), "better two".into()]
        )
        .await
        .unwrap());
        let rows = sqlx::query_as::<_, (String, String)>(
            "SELECT transcript, timestamp FROM transcripts ORDER BY rowid",
        )
        .fetch_all(&pool)
        .await
        .unwrap();
        assert_eq!(
            rows,
            vec![
                ("better one".into(), "00:01".into()),
                ("better two".into(), "00:02".into())
            ]
        );
    }
}
