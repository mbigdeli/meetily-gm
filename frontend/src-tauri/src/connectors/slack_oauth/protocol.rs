//! Pure Slack OAuth v2 protocol pieces: authorize URL, token-exchange form,
//! and response parsing. No I/O here so it can be unit-tested.

use serde_json::Value;
use url::Url;

pub const AUTHORIZE_BASE: &str = "https://slack.com/oauth/v2/authorize";
pub const TOKEN_URL: &str = "https://slack.com/api/oauth.v2.access";

/// User-token scopes that let Miting act as the user: read, search, send.
pub const USER_SCOPES: &str = "channels:read,groups:read,chat:write,search:read";

/// Result of a successful user-token exchange.
#[derive(Debug, PartialEq)]
pub struct UserAuth {
    pub user_token: String,
    pub team: String,
}

/// Build the Slack authorize URL for a PKCE user-token flow.
pub fn authorize_url(client_id: &str, redirect_uri: &str, challenge: &str, state: &str) -> String {
    let mut u = Url::parse(AUTHORIZE_BASE).expect("static base url");
    u.query_pairs_mut()
        .append_pair("client_id", client_id)
        .append_pair("user_scope", USER_SCOPES)
        .append_pair("redirect_uri", redirect_uri)
        .append_pair("code_challenge", challenge)
        .append_pair("code_challenge_method", "S256")
        .append_pair("state", state);
    u.into()
}

/// Form fields for oauth.v2.access under PKCE (no client_secret).
pub fn token_form<'a>(
    client_id: &'a str,
    code: &'a str,
    verifier: &'a str,
    redirect_uri: &'a str,
) -> [(&'a str, &'a str); 4] {
    [
        ("client_id", client_id),
        ("code", code),
        ("code_verifier", verifier),
        ("redirect_uri", redirect_uri),
    ]
}

/// Extract the user token (authed_user.access_token) from an oauth.v2.access
/// response body, or a friendly error if Slack rejected the exchange.
pub fn parse_user_token(body: &str) -> Result<UserAuth, String> {
    let v: Value = serde_json::from_str(body).map_err(|e| e.to_string())?;
    if !v.get("ok").and_then(|b| b.as_bool()).unwrap_or(false) {
        let err = v.get("error").and_then(|e| e.as_str()).unwrap_or("unknown_error");
        return Err(format!("Slack OAuth failed: {err}"));
    }
    let token = v
        .pointer("/authed_user/access_token")
        .and_then(|t| t.as_str())
        .filter(|t| !t.is_empty())
        .ok_or("Slack response missing authed_user.access_token")?;
    let team = v.pointer("/team/name").and_then(|t| t.as_str()).unwrap_or("").to_string();
    Ok(UserAuth { user_token: token.to_string(), team })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn authorize_url_has_pkce_and_scopes() {
        let u = authorize_url("A123", "https://x/cb", "chal", "st.42");
        assert!(u.starts_with(AUTHORIZE_BASE));
        assert!(u.contains("client_id=A123"));
        assert!(u.contains("code_challenge=chal"));
        assert!(u.contains("code_challenge_method=S256"));
        assert!(u.contains("state=st.42"));
        assert!(u.contains("user_scope=channels%3Aread")); // scopes url-encoded
    }

    #[test]
    fn parse_ok_response_extracts_user_token_and_team() {
        let body = r#"{"ok":true,"authed_user":{"id":"U1","access_token":"xoxp-abc"},"team":{"id":"T1","name":"Acme"}}"#;
        assert_eq!(
            parse_user_token(body).unwrap(),
            UserAuth { user_token: "xoxp-abc".into(), team: "Acme".into() }
        );
    }

    #[test]
    fn parse_error_response_is_friendly() {
        let e = parse_user_token(r#"{"ok":false,"error":"invalid_code"}"#).unwrap_err();
        assert!(e.contains("invalid_code"));
    }

    #[test]
    fn token_form_omits_secret() {
        let f = token_form("A", "C", "V", "R");
        assert!(f.iter().all(|(k, _)| *k != "client_secret"));
        assert_eq!(f.len(), 4);
    }
}
