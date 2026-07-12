//! PKCE (RFC 7636) helpers for Slack OAuth — lets Miting act as a public
//! client with no client secret. S256 challenge only.

use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine;
use rand::RngCore;
use sha2::{Digest, Sha256};

/// A random URL-safe token (base64url, no padding) from `n` random bytes.
/// Uses the OS CSPRNG.
pub fn random_urlsafe(n: usize) -> String {
    let mut buf = vec![0u8; n];
    rand::rngs::OsRng.fill_bytes(&mut buf);
    URL_SAFE_NO_PAD.encode(buf)
}

/// A PKCE code verifier: 32 random bytes -> 43-char base64url (RFC range 43-128).
pub fn code_verifier() -> String {
    random_urlsafe(32)
}

/// S256 code challenge = base64url(sha256(verifier)), no padding.
pub fn challenge_s256(verifier: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(verifier.as_bytes());
    URL_SAFE_NO_PAD.encode(hasher.finalize())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// RFC 7636 Appendix B reference vector — proves our S256 derivation.
    #[test]
    fn rfc7636_challenge_vector() {
        let verifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
        assert_eq!(
            challenge_s256(verifier),
            "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM"
        );
    }

    #[test]
    fn verifier_is_valid_length_and_charset() {
        let v = code_verifier();
        assert!(v.len() >= 43 && v.len() <= 128, "len {}", v.len());
        assert!(v.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_'));
    }

    #[test]
    fn verifiers_are_unique() {
        assert_ne!(code_verifier(), code_verifier());
    }
}
