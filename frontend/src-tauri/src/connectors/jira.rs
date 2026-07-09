//! Jira REST v3 create-issue payload builder (doc 07 §3). Pure — the HTTP/MCP
//! send is a separate layer, live-tested against a real site. Description is
//! ADF (v3 rejects a plain string).

use super::adf::markdown_to_adf;
use serde_json::{json, Value};

/// Build the `POST /rest/api/3/issue` body. `project_id`/`issuetype_id` are the
/// numeric ids from create-meta (ids differ per project — never cache across).
pub fn build_create_issue_body(
    project_id: &str,
    issuetype_id: &str,
    summary: &str,
    description_md: &str,
    labels: &[String],
    assignee_account_id: Option<&str>,
    due: Option<&str>,
) -> Value {
    let mut fields = json!({
        "project": { "id": project_id },
        "issuetype": { "id": issuetype_id },
        "summary": summary,
        "description": markdown_to_adf(description_md),
    });
    if !labels.is_empty() {
        fields["labels"] = json!(labels);
    }
    if let Some(acc) = assignee_account_id {
        fields["assignee"] = json!({ "accountId": acc });
    }
    if let Some(d) = due {
        fields["duedate"] = json!(d);
    }
    json!({ "fields": fields })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn required_fields_and_adf_description() {
        let body = build_create_issue_body(
            "10000", "10002", "Follow up with vendor", "Context\n- do X", &[], None, None,
        );
        assert_eq!(body["fields"]["project"]["id"], "10000");
        assert_eq!(body["fields"]["issuetype"]["id"], "10002");
        assert_eq!(body["fields"]["summary"], "Follow up with vendor");
        // description must be an ADF doc, not a string
        assert_eq!(body["fields"]["description"]["type"], "doc");
        // optional fields omitted
        assert!(body["fields"].get("labels").is_none());
        assert!(body["fields"].get("assignee").is_none());
        assert!(body["fields"].get("duedate").is_none());
    }

    #[test]
    fn optional_fields_included() {
        let body = build_create_issue_body(
            "1", "2", "s", "d",
            &["miting".into(), "sso".into()],
            Some("acc-123"), Some("2026-07-13"),
        );
        assert_eq!(body["fields"]["labels"][0], "miting");
        assert_eq!(body["fields"]["assignee"]["accountId"], "acc-123");
        assert_eq!(body["fields"]["duedate"], "2026-07-13");
    }
}
