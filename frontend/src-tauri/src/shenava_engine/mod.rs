pub mod catalog;
pub mod commands;
pub mod download;
pub mod engine;
mod process;

pub use catalog::{ModelInfo, ModelStatus};
pub use engine::ShenavaEngine;

#[cfg(test)]
mod tests;
