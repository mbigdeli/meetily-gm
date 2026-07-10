//! Jira REST v3 create-issue send (email + API-token Basic auth). Payload comes
//! from `jira::build_create_issue_body`. Network call live-tested against a real
//! site; the response parser is unit-tested. (MCP transport is a later option.)

use super::jira::build_create_issue_body;
use serde_json::Value;

/// Everything needed for one create-issue call (kept as a struct so the fn
/// stays a 2-arg call, not an 11-arg smell).
pub struct JiraCreate<'a> {
    pub site_base: &'a str, // e.g. https://acme.atlassian.net
    pub email: &'a str,
    pub api_token: &'a str,
    pub project_id: &'a str,
    pub issuetype_id: &'a str,
    pub summary: &'a str,
    pub description_md: &'a str,
    pub labels: &'a [String],
    pub assignee_account_id: Option<&'a str>,
    pub due: Option<&'a str>,
}

/// Parse a create-issue response → Ok((key, self_url)) or a readable error. Pure.
fn parse_create_response(status: u16, body: &str) -> Result<(String, String), String> {
    if status == 201 {
        let v: Value = serde_json::from_str(body).map_err(|e| e.to_string())?;
        Ok((
            v["key"].as_str().unwrap_or_default().to_string(),
            v["self"].as_str().unwrap_or_default().to_string(),
        ))
    } else {
        let snippet: String = body.chars().take(300).collect();
        Err(format!("Jira create failed (HTTP {status}): {snippet}"))
    }
}

/// POST /rest/api/3/issue. Returns the created issue key + self URL.
pub async fn create_issue(
    client: &reqwest::Client,
    req: JiraCreate<'_>,
) -> Result<(String, String), String> {
    let body = build_create_issue_body(
        req.project_id,
        req.issuetype_id,
        req.summary,
        req.description_md,
        req.labels,
        req.assignee_account_id,
        req.due,
    );
    let url = format!("{}/rest/api/3/issue", req.site_base.trim_end_matches('/'));
    let resp = client
        .post(&url)
        .basic_auth(req.email, Some(req.api_token))
        .json(&body)
        .send()
        .await
        .map_err(|e| e.to_string())?;
    let status = resp.status().as_u16();
    let text = resp.text().await.map_err(|e| e.to_string())?;
    parse_create_response(status, &text)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_201_returns_key_and_url() {
        let (k, u) = parse_create_response(
            201,
            r#"{"id":"10123","key":"DB-457","self":"https://acme.atlassian.net/rest/api/3/issue/10123"}"#,
        )
        .unwrap();
        assert_eq!(k, "DB-457");
        assert!(u.ends_with("/issue/10123"));
    }

    #[test]
    fn parse_400_is_error_with_snippet() {
        let e = parse_create_response(400, r#"{"errors":{"summary":"required"}}"#).unwrap_err();
        assert!(e.contains("HTTP 400"));
        assert!(e.contains("summary"));
    }
}
