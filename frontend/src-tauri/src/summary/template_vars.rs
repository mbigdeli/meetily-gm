//! Prompt-template variable engine (Prompt Studio, doc 06 §4).
//! A template body is user-editable text with `{{var}}` placeholders; exactly
//! one — `{{transcript}}` — is required. Expansion is plain, dependency-free
//! substitution (byte-exact preview); `\{{` is a literal `{{`; unknown tokens
//! stay verbatim (and are flagged by `validate`).

/// The one placeholder every template must contain.
pub const REQUIRED_VAR: &str = "transcript";

/// Values substituted into a template at generation time.
#[derive(Debug, Default, Clone)]
pub struct TemplateContext {
    pub transcript: String,
    pub meeting_title: String,
    pub date: String,
    pub duration: String,
    pub participants: String,
    pub language: String,
    pub my_name: String,
}

impl TemplateContext {
    fn lookup(&self, name: &str) -> Option<&str> {
        Some(match name {
            "transcript" => &self.transcript,
            "meeting_title" => &self.meeting_title,
            "date" => &self.date,
            "duration" => &self.duration,
            "participants" => &self.participants,
            "language" => &self.language,
            "my_name" => &self.my_name,
            _ => return None,
        })
    }
}

/// Every variable name the engine understands.
pub const KNOWN_VARS: [&str; 7] = ["transcript", "meeting_title", "date", "duration", "participants", "language", "my_name"];

#[derive(Debug, PartialEq, Eq)]
pub enum ValidationIssue {
    /// The required `{{transcript}}` placeholder is absent — save must be blocked.
    MissingTranscript,
    /// A `{{token}}` that isn't a known variable — warn; it's sent literally.
    UnknownVar(String),
}

/// Scan for `{{name}}` tokens, honoring `\{{` escapes. Returns the trimmed names.
fn scan_tokens(body: &str) -> Vec<String> {
    let bytes = body.as_bytes();
    let mut names = Vec::new();
    let mut i = 0;
    while i + 1 < bytes.len() {
        // Escaped opener: skip.
        if bytes[i] == b'\\' && bytes[i + 1] == b'{' {
            i += 2;
            continue;
        }
        if bytes[i] == b'{' && bytes[i + 1] == b'{' {
            if let Some(rel) = body[i + 2..].find("}}") {
                let name = body[i + 2..i + 2 + rel].trim().to_string();
                names.push(name);
                i = i + 2 + rel + 2;
                continue;
            }
        }
        i += 1;
    }
    names
}

/// Validate a template body. Empty result = OK to save.
pub fn validate(body: &str) -> Vec<ValidationIssue> {
    let tokens = scan_tokens(body);
    let mut issues = Vec::new();
    if !tokens.iter().any(|t| t == REQUIRED_VAR) {
        issues.push(ValidationIssue::MissingTranscript);
    }
    for t in &tokens {
        if !KNOWN_VARS.contains(&t.as_str()) {
            issues.push(ValidationIssue::UnknownVar(t.clone()));
        }
    }
    issues
}

/// Expand known `{{var}}` placeholders. Unknown tokens stay verbatim; `\{{`
/// becomes a literal `{{`.
pub fn expand(body: &str, ctx: &TemplateContext) -> String {
    let bytes = body.as_bytes();
    let mut out = String::with_capacity(body.len());
    let mut i = 0;
    while i < bytes.len() {
        if i + 1 < bytes.len() && bytes[i] == b'\\' && bytes[i + 1] == b'{' {
            out.push('{');
            // Consume "\{" then let a following '{' pass through as literal.
            i += 2;
            continue;
        }
        if i + 1 < bytes.len() && bytes[i] == b'{' && bytes[i + 1] == b'{' {
            if let Some(rel) = body[i + 2..].find("}}") {
                let raw = &body[i + 2..i + 2 + rel];
                let name = raw.trim();
                match ctx.lookup(name) {
                    Some(val) => out.push_str(val),
                    None => out.push_str(&body[i..i + 2 + rel + 2]), // leave unknown verbatim
                }
                i = i + 2 + rel + 2;
                continue;
            }
        }
        // Copy one whole UTF-8 char (template bodies may be Persian — never
        // push raw bytes as chars).
        let ch = body[i..].chars().next().expect("valid char at boundary");
        out.push(ch);
        i += ch.len_utf8();
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ctx() -> TemplateContext {
        TemplateContext {
            transcript: "T".into(),
            participants: "Ann, Bob".into(),
            date: "2026-07-07".into(),
            ..Default::default()
        }
    }

    #[test]
    fn missing_transcript_flagged() {
        assert!(validate("no vars here").contains(&ValidationIssue::MissingTranscript));
        assert!(validate("has {{transcript}}").is_empty());
    }

    #[test]
    fn unknown_var_flagged_but_not_missing() {
        let issues = validate("{{transcript}} {{bogus}}");
        assert_eq!(issues, vec![ValidationIssue::UnknownVar("bogus".into())]);
    }

    #[test]
    fn expands_known_leaves_unknown() {
        let out = expand("P: {{participants}} on {{date}}; X={{bogus}}; {{transcript}}", &ctx());
        assert_eq!(out, "P: Ann, Bob on 2026-07-07; X={{bogus}}; T");
    }

    #[test]
    fn escaped_braces_are_literal() {
        assert_eq!(expand("literal \\{{transcript}}", &ctx()), "literal {{transcript}}");
    }

    #[test]
    fn whitespace_in_token_is_trimmed() {
        assert_eq!(expand("{{  transcript  }}", &ctx()), "T");
    }

    #[test]
    fn preserves_persian_literal_text() {
        // Regression guard: literal non-ASCII must survive expansion intact.
        assert_eq!(expand("خلاصه جلسه: {{transcript}}", &ctx()), "خلاصه جلسه: T");
    }
}
