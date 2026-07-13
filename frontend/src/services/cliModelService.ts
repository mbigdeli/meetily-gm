/**
 * Dynamic model catalogs for the CLI summary providers (codex, claude-code).
 *
 * Thin wrappers over the Tauri commands. `refresh: false` reads the on-disk
 * cache (instant); `refresh: true` runs the full web-augmented fetch and
 * probe-validates every candidate with real CLI calls — seconds, and it
 * spends tokens, so only trigger it from an explicit user action.
 */

import { invoke } from '@tauri-apps/api/core';

export type CliProvider = 'codex' | 'claude-code';

export interface CliModelEntry {
  id: string;
  label: string;
}

export interface CliModelList {
  models: CliModelEntry[];
  /** Unix seconds of the last successful refresh; null if never fetched. */
  fetched_at: number | null;
  from_cache: boolean;
}

export interface CliValidationOutcome {
  valid: boolean;
  error: string | null;
}

const LIST_COMMAND: Record<CliProvider, string> = {
  codex: 'codex_list_models',
  'claude-code': 'claude_list_models',
};

const VALIDATE_COMMAND: Record<CliProvider, string> = {
  codex: 'codex_validate_model',
  'claude-code': 'claude_validate_model',
};

export function listCliModels(provider: CliProvider, refresh: boolean): Promise<CliModelList> {
  return invoke<CliModelList>(LIST_COMMAND[provider], { refresh });
}

/** Probe one user-typed id; the backend persists it when it validates. */
export function validateCliModel(
  provider: CliProvider,
  model: string,
): Promise<CliValidationOutcome> {
  return invoke<CliValidationOutcome>(VALIDATE_COMMAND[provider], { model });
}
