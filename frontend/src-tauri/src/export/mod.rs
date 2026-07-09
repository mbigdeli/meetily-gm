//! Export formatters (doc 04, doc 09 §4.5). Pure functions over row/record
//! structs so they're testable without the DB; the DB layer maps rows and the
//! Tauri commands write files via the OS dialog (never hardcode paths).

pub mod participants;
