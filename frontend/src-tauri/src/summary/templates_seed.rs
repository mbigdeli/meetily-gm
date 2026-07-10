//! Default Prompt Studio templates, seeded once on first run (doc 06 §3).
//! Each body contains the required `{{transcript}}`. Ids are stable slugs so a
//! future "reset to default" can target them. Seeding is idempotent (no-op when
//! the table already has rows).

use super::templates_store::{self, MeetingTemplate};
use sqlx::SqlitePool;

/// (id, name, icon, prompt_body) — shipped defaults.
const DEFAULTS: [(&str, &str, &str, &str); 4] = [
    (
        "default-standard", "Standard meeting", "📋",
        "Summarize this meeting. Produce a short overview, the key decisions \
(each with who made it), and action items as `owner — task — due`.\n\nTranscript:\n{{transcript}}",
    ),
    (
        "default-standup", "Daily standup", "🌅",
        "Summarize this standup per person as: yesterday / today / blockers. \
List any blockers that need follow-up at the end.\n\nTranscript:\n{{transcript}}",
    ),
    (
        "default-project-sync", "Project sync", "🔁",
        "Minutes for a recurring project sync. Sections: Progress, Decisions \
(with owner), Blockers & risks, Action items (owner | task | due). Use the \
speakers' names.\n\nTranscript:\n{{transcript}}",
    ),
    (
        "default-standard-fa", "Standard meeting (فارسی)", "📋",
        "این جلسه را به زبان فارسی خلاصه کن. یک نمای کلی کوتاه، تصمیم‌های کلیدی، \
و کارهای اقدام (مسئول — کار — مهلت) ارائه بده.\n\nمتن جلسه:\n{{transcript}}",
    ),
];

/// Insert the defaults when the table is empty. Idempotent.
pub async fn seed_defaults(pool: &SqlitePool, now_rfc3339: &str) -> Result<(), sqlx::Error> {
    if templates_store::count(pool).await? > 0 {
        return Ok(());
    }
    for (i, (id, name, icon, body)) in DEFAULTS.iter().enumerate() {
        let t = MeetingTemplate {
            id: (*id).into(),
            name: (*name).into(),
            description: None,
            icon: Some((*icon).into()),
            prompt_body: (*body).into(),
            is_default: true,
            sort_order: i as i64,
            created_at: now_rfc3339.into(),
            updated_at: now_rfc3339.into(),
        };
        templates_store::upsert(pool, &t).await?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::summary::template_vars;
    use sqlx::sqlite::SqlitePoolOptions;

    async fn pool() -> SqlitePool {
        let p = SqlitePoolOptions::new().max_connections(1)
            .connect("sqlite::memory:").await.unwrap();
        sqlx::migrate!("./migrations").run(&p).await.unwrap();
        p
    }

    #[test]
    fn every_default_has_required_transcript_var() {
        for (_, name, _, body) in DEFAULTS {
            assert!(
                template_vars::validate(body).is_empty(),
                "default '{name}' fails validation",
            );
        }
    }

    #[tokio::test]
    async fn seeding_is_idempotent() {
        let p = pool().await;
        seed_defaults(&p, "t0").await.unwrap();
        let first = templates_store::count(&p).await.unwrap();
        assert_eq!(first, DEFAULTS.len() as i64);
        seed_defaults(&p, "t1").await.unwrap(); // second run must not duplicate
        assert_eq!(templates_store::count(&p).await.unwrap(), first);
    }
}
