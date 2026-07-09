//! Participant roster export (doc 04 §4.2): CSV / JSON / Markdown.
//!
//! Pure over a row struct so it's unit-testable without the DB. CSV is written
//! UTF-8 **with a BOM** so Excel renders Persian names correctly.

use serde::Serialize;

/// One attendee row (approximate join/leave at snapshot resolution).
#[derive(Debug, Clone, Serialize)]
pub struct ParticipantRow {
    pub name: String,
    pub first_seen: Option<String>,
    pub last_seen: Option<String>,
    pub is_self: bool,
}

const BOM: &str = "\u{FEFF}";

fn csv_field(s: &str) -> String {
    if s.contains([',', '"', '\n', '\r']) {
        format!("\"{}\"", s.replace('"', "\"\""))
    } else {
        s.to_string()
    }
}

/// CSV with a header row; UTF-8 BOM prefixed for Excel.
pub fn to_csv(rows: &[ParticipantRow]) -> String {
    let mut out = String::from(BOM);
    out.push_str("name,first_seen,last_seen,is_self\n");
    for r in rows {
        out.push_str(&csv_field(&r.name));
        out.push(',');
        out.push_str(&csv_field(r.first_seen.as_deref().unwrap_or("")));
        out.push(',');
        out.push_str(&csv_field(r.last_seen.as_deref().unwrap_or("")));
        out.push(',');
        out.push_str(if r.is_self { "true" } else { "false" });
        out.push('\n');
    }
    out
}

/// Markdown table (paste into Notion/Confluence).
pub fn to_markdown(rows: &[ParticipantRow]) -> String {
    let mut out = String::from("| Name | Joined | Left |\n| --- | --- | --- |\n");
    for r in rows {
        let me = if r.is_self { " (you)" } else { "" };
        out.push_str(&format!(
            "| {}{} | {} | {} |\n",
            r.name.replace('|', "\\|"),
            me,
            r.first_seen.as_deref().unwrap_or("—"),
            r.last_seen.as_deref().unwrap_or("—"),
        ));
    }
    out
}

/// JSON envelope with meeting metadata + rows.
pub fn to_json(meeting_title: &str, date: &str, rows: &[ParticipantRow]) -> String {
    let v = serde_json::json!({
        "meeting": { "title": meeting_title, "date": date },
        "participants": rows,
    });
    serde_json::to_string_pretty(&v).unwrap_or_else(|_| "{}".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn rows() -> Vec<ParticipantRow> {
        vec![
            ParticipantRow { name: "Mohamad".into(), first_seen: Some("10:00".into()), last_seen: Some("10:48".into()), is_self: true },
            ParticipantRow { name: "علی رضایی".into(), first_seen: None, last_seen: None, is_self: false },
            ParticipantRow { name: "Doe, Jane".into(), first_seen: None, last_seen: None, is_self: false },
        ]
    }

    #[test]
    fn csv_has_bom_header_and_quotes_commas() {
        let csv = to_csv(&rows());
        assert!(csv.starts_with('\u{FEFF}'));
        assert!(csv.contains("name,first_seen,last_seen,is_self"));
        assert!(csv.contains("\"Doe, Jane\"")); // comma field quoted
        assert!(csv.contains("علی رضایی")); // Persian preserved
    }

    #[test]
    fn markdown_marks_self_and_escapes_pipe() {
        let md = to_markdown(&rows());
        assert!(md.contains("Mohamad (you)"));
        assert!(md.contains("| --- | --- | --- |"));
    }

    #[test]
    fn json_wraps_meta_and_rows() {
        let j = to_json("Q3 sync", "2026-07-07", &rows());
        assert!(j.contains("\"title\": \"Q3 sync\""));
        assert!(j.contains("\"participants\""));
    }
}
