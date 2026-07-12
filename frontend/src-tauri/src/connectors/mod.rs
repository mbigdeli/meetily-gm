//! Integration connector platform (doc 10).
//!
//! Pure, provider-agnostic building blocks shared by the Jira/Slack/… sinks.
//! Markdown is the lingua franca; each connector converts to its own format
//! (ADF for Jira, mrkdwn/Block Kit for Slack). HTTP clients + the Connector /
//! TaskSink / MessageSink traits and the OS-keychain secret store build on
//! these format converters (follow-up).

pub mod adf;
pub mod integration_commands;
pub mod jira;
pub mod jira_client;
pub mod mrkdwn;
pub mod secrets;
pub mod slack;
pub mod slack_client;
pub mod slack_read;
