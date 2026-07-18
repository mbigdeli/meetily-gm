//! Miting pairing host — Chrome native-messaging endpoint.
//!
//! Chrome launches this binary on `chrome.runtime.connectNative(...)` from the
//! pinned companion extension (identity enforced by `allowed_origins` in the
//! host manifest the desktop app registers). Short-lived by design: answer
//! frames until stdin closes, then exit.
//!
//! Wire contract (extension/src/shared/nativeHost.ts): request
//! `{id, action, payload}` -> reply `{id, success, payload}` or
//! `{id, success:false, error}`.
//!
//! Actions:
//!   health.check -> payload {host_version}
//!   pairing.get  -> payload {base_url, token}

mod codec;
mod pairing;

use serde_json::{json, Value};

fn reply(id: Option<&Value>, result: Result<Value, String>) -> Value {
    let id = id.cloned().unwrap_or(Value::Null);
    match result {
        Ok(payload) => json!({ "id": id, "success": true, "payload": payload }),
        Err(error) => json!({ "id": id, "success": false, "error": error }),
    }
}

fn handle(message: &Value) -> Value {
    let id = message.get("id");
    let result = match message.get("action").and_then(Value::as_str) {
        Some("health.check") => Ok(json!({ "host_version": env!("CARGO_PKG_VERSION") })),
        Some("pairing.get") => pairing::load_or_create_token()
            .map(|token| json!({ "base_url": pairing::BASE_URL, "token": token }))
            .map_err(|e| format!("token unavailable: {e}")),
        other => Err(format!("unknown action: {}", other.unwrap_or("<missing>"))),
    };
    reply(id, result)
}

fn main() -> std::io::Result<()> {
    let stdin = std::io::stdin();
    let stdout = std::io::stdout();
    let mut input = stdin.lock();
    let mut output = stdout.lock();
    while let Some(message) = codec::read_message(&mut input)? {
        let response = handle(&message);
        codec::write_message(&mut output, &response)?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn health_check_uses_success_envelope_and_echoes_id() {
        let out = handle(&json!({"id": "req-1", "action": "health.check", "payload": {}}));
        assert_eq!(out["id"], "req-1");
        assert_eq!(out["success"], true);
        assert_eq!(out["payload"]["host_version"], env!("CARGO_PKG_VERSION"));
    }

    #[test]
    fn unknown_action_is_a_success_false_error() {
        let out = handle(&json!({"id": 7, "action": "nope"}));
        assert_eq!(out["id"], 7);
        assert_eq!(out["success"], false);
        assert!(out["error"].as_str().unwrap().contains("nope"));
    }

    #[test]
    fn missing_id_yields_null_id_not_a_crash() {
        let out = handle(&json!({"action": "health.check"}));
        assert!(out["id"].is_null());
        assert_eq!(out["success"], true);
    }
}
