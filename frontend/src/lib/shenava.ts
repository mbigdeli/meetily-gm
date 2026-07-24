import { invoke } from '@tauri-apps/api/core';

export type ShenavaStatus =
  | 'Available'
  | 'Missing'
  | { Downloading: { progress: number } }
  | { Error: string }
  | { Corrupted: { file_size: number; expected_size: number } };

export interface ShenavaModelInfo {
  name: string;
  display_name: string;
  path: string;
  size_mb: number;
  status: ShenavaStatus;
  description: string;
  license: string;
}

export const ShenavaAPI = {
  init: () => invoke<void>('shenava_init'),
  models: () => invoke<ShenavaModelInfo[]>('shenava_get_available_models'),
  download: (modelName: string) => invoke<void>('shenava_download_model', { modelName }),
  delete: (modelName: string) => invoke<void>('shenava_delete_model', { modelName }),
};
