//! One-call LLM generation via whatever provider the user configured in
//! Settings -> Model (ollama, claude, groq, openrouter, openai, custom-openai,
//! built-in, or the local Codex / Claude Code CLIs). Extracted so non-summary
//! features (e.g. gmeet caption fusion) run on the user's chosen LLM instead
//! of a hardcoded provider.

use std::path::PathBuf;

use sqlx::SqlitePool;

use crate::database::repositories::setting::SettingsRepository;
use crate::summary::llm_client::{generate_summary, LLMProvider};

/// Providers that don't read an API key from the standard settings column.
pub(crate) fn is_keyless(p: &LLMProvider) -> bool {
    matches!(
        p,
        LLMProvider::Ollama
            | LLMProvider::BuiltInAI
            | LLMProvider::CodexCli
            | LLMProvider::ClaudeCodeCli
    )
}

/// Generate with the configured provider. Errors with `no_ai_configured` when
/// Settings -> Model was never set.
pub async fn generate_with_configured(
    pool: &SqlitePool,
    app_data_dir: Option<&PathBuf>,
    system_prompt: &str,
    user_prompt: &str,
) -> Result<String, String> {
    let cfg = SettingsRepository::get_model_config(pool)
        .await
        .map_err(|e| e.to_string())?
        .filter(|c| !c.provider.trim().is_empty())
        .ok_or_else(|| "no_ai_configured".to_string())?;
    let provider = LLMProvider::from_str(&cfg.provider)?;
    let client = reqwest::Client::new();

    // Custom OpenAI carries its own endpoint + tuning.
    if provider == LLMProvider::CustomOpenAI {
        let c = SettingsRepository::get_custom_openai_config(pool)
            .await
            .map_err(|e| e.to_string())?
            .ok_or_else(|| {
                "Custom OpenAI selected but not configured (Settings -> Model).".to_string()
            })?;
        return generate_summary(
            &client,
            &provider,
            &c.model,
            c.api_key.as_deref().unwrap_or_default(),
            system_prompt,
            user_prompt,
            None,
            Some(&c.endpoint),
            c.max_tokens.map(|m| m as u32),
            c.temperature,
            c.top_p,
            app_data_dir,
            None,
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
        &client,
        &provider,
        &cfg.model,
        &key,
        system_prompt,
        user_prompt,
        cfg.ollama_endpoint.as_deref(),
        None,
        None,
        None,
        None,
        app_data_dir,
        None,
    )
    .await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cli_and_local_providers_are_keyless() {
        for p in [
            LLMProvider::Ollama,
            LLMProvider::BuiltInAI,
            LLMProvider::CodexCli,
            LLMProvider::ClaudeCodeCli,
        ] {
            assert!(is_keyless(&p), "{p:?} must not require an API key");
        }
        for p in [LLMProvider::OpenAI, LLMProvider::Claude, LLMProvider::Groq] {
            assert!(!is_keyless(&p), "{p:?} requires an API key");
        }
    }
}
