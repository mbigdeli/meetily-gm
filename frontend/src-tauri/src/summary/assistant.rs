//! In-app connection assistant command.
//!
//! Reuses the LLM the user already configured for summaries (Settings -> Model),
//! including the free local Codex / Claude Code CLIs, to help them connect an
//! integration. Purely additive: no new provider, stores nothing.

use crate::database::repositories::setting::SettingsRepository;
use crate::state::AppState;
use crate::summary::llm_client::{generate_summary, LLMProvider};
use serde::Deserialize;
use tauri::{AppHandle, Manager, Runtime, State};

#[derive(Deserialize, Clone)]
pub struct ChatMsg {
    pub role: String,
    pub content: String,
}

/// Fold the chat history into one user prompt (generate_summary takes a single
/// system + user string) and leave it open for the assistant's next reply.
fn fold_history(messages: &[ChatMsg]) -> String {
    let mut out = String::from(
        "Continue this support chat as the assistant. Reply with only your next \
message.\n\nConversation so far:\n",
    );
    for m in messages {
        let who = if m.role.eq_ignore_ascii_case("assistant") { "Assistant" } else { "User" };
        out.push_str(who);
        out.push_str(": ");
        out.push_str(m.content.trim());
        out.push('\n');
    }
    out.push_str("Assistant:");
    out
}

/// Providers that don't read an API key from the standard settings column.
fn is_keyless(p: &LLMProvider) -> bool {
    matches!(
        p,
        LLMProvider::Ollama
            | LLMProvider::BuiltInAI
            | LLMProvider::CodexCli
            | LLMProvider::ClaudeCodeCli
    )
}

/// Chat with the configured AI to get help connecting an integration.
/// `topic` selects the guidance ("slack", "jira", ...).
#[tauri::command]
pub async fn api_assistant_chat<R: Runtime>(
    app: AppHandle<R>,
    state: State<'_, AppState>,
    topic: String,
    messages: Vec<ChatMsg>,
) -> Result<String, String> {
    let pool = state.db_manager.pool();
    let cfg = SettingsRepository::get_model_config(pool)
        .await
        .map_err(|e| e.to_string())?
        .filter(|c| !c.provider.trim().is_empty())
        .ok_or_else(|| "no_ai_configured".to_string())?;
    let provider = LLMProvider::from_str(&cfg.provider)?;
    let system = super::assistant_prompts::system_for(&topic);
    let user = fold_history(&messages);
    let app_data_dir = app.path().app_data_dir().ok();
    let client = reqwest::Client::new();

    // Custom OpenAI carries its own endpoint + tuning.
    if provider == LLMProvider::CustomOpenAI {
        let c = SettingsRepository::get_custom_openai_config(pool)
            .await
            .map_err(|e| e.to_string())?
            .ok_or_else(|| "Custom OpenAI selected but not configured (Settings -> Model).".to_string())?;
        return generate_summary(
            &client, &provider, &c.model, c.api_key.as_deref().unwrap_or_default(),
            &system, &user, None, Some(&c.endpoint),
            c.max_tokens.map(|m| m as u32), c.temperature, c.top_p,
            app_data_dir.as_ref(), None,
        )
        .await;
    }

    let key = if is_keyless(&provider) {
        String::new()
    } else {
        SettingsRepository::get_api_key(pool, &cfg.provider)
            .await
            .map_err(|e| e.to_string())?
            .unwrap_or_default()
    };
    generate_summary(
        &client, &provider, &cfg.model, &key, &system, &user,
        cfg.ollama_endpoint.as_deref(), None, None, None, None,
        app_data_dir.as_ref(), None,
    )
    .await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fold_history_labels_roles_and_ends_open() {
        let msgs = vec![
            ChatMsg { role: "user".into(), content: "hi".into() },
            ChatMsg { role: "assistant".into(), content: "hello".into() },
            ChatMsg { role: "user".into(), content: "how do I get a token?".into() },
        ];
        let f = fold_history(&msgs);
        assert!(f.contains("User: hi"));
        assert!(f.contains("Assistant: hello"));
        assert!(f.trim_end().ends_with("Assistant:"));
    }

    #[test]
    fn keyless_providers_detected() {
        assert!(is_keyless(&LLMProvider::CodexCli));
        assert!(is_keyless(&LLMProvider::ClaudeCodeCli));
        assert!(!is_keyless(&LLMProvider::OpenAI));
    }
}
