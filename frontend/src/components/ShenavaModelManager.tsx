'use client';

import { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { ShenavaAPI, ShenavaModelInfo } from '@/lib/shenava';

interface Props {
  selectedModel?: string;
  onModelSelect: (name: string) => void;
}

export function ShenavaModelManager({ selectedModel, onModelSelect }: Props) {
  const [models, setModels] = useState<ShenavaModelInfo[]>([]);
  const [progress, setProgress] = useState<Record<string, number>>({});
  const [error, setError] = useState<string | null>(null);

  const refresh = async () => {
    await ShenavaAPI.init();
    setModels(await ShenavaAPI.models());
  };

  useEffect(() => {
    refresh().catch((reason) => setError(String(reason)));
  }, []);

  useEffect(() => {
    const unlisteners: Array<() => void> = [];
    Promise.all([
      listen<{ model_name: string; progress: number }>(
        'shenava-model-download-progress',
        ({ payload }) => setProgress((value) => ({ ...value, [payload.model_name]: payload.progress })),
      ),
      listen<{ modelName: string }>('shenava-model-download-complete', async ({ payload }) => {
        setProgress((value) => ({ ...value, [payload.modelName]: 100 }));
        await refresh();
      }),
      listen<{ modelName: string; error: string }>('shenava-model-download-error', ({ payload }) => {
        setError(`${payload.modelName}: ${payload.error}`);
      }),
    ]).then((items) => unlisteners.push(...items));
    return () => unlisteners.forEach((unlisten) => unlisten());
  }, []);

  const select = async (name: string) => {
    setError(null);
    try {
      await invoke('api_save_transcript_config', {
        provider: 'shenava',
        model: name,
        apiKey: null,
      });
      onModelSelect(name);
    } catch (reason) {
      setError(`Could not save Shenava selection: ${String(reason)}`);
    }
  };

  const download = async (name: string) => {
    setError(null);
    setProgress((value) => ({ ...value, [name]: 0 }));
    try {
      await ShenavaAPI.download(name);
    } catch (reason) {
      setError(String(reason));
    }
  };

  return (
    <div className="space-y-3">
      <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900">
        Shenava v1.0 is CC-BY-NC-4.0: attribution is required and commercial use is prohibited
        without separate permission from the model author.
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}
      {models.map((model) => {
        const available = model.status === 'Available';
        const percent = progress[model.name];
        return (
          <div
            key={model.name}
            className={`rounded-lg border p-4 ${selectedModel === model.name ? 'border-blue-500 bg-blue-50' : 'border-gray-200'}`}
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="font-semibold text-gray-900">Shenava {model.display_name}</p>
                <p className="text-sm text-gray-600">{model.description}</p>
                <p className="mt-1 text-xs text-gray-500">{model.size_mb} MB / Persian only</p>
              </div>
              {available ? (
                <button className="rounded-md bg-blue-600 px-3 py-1.5 text-sm text-white" onClick={() => select(model.name)}>
                  {selectedModel === model.name ? 'Selected' : 'Use'}
                </button>
              ) : (
                <button
                  className="rounded-md bg-blue-600 px-3 py-1.5 text-sm text-white disabled:opacity-60"
                  disabled={percent !== undefined && percent < 100}
                  onClick={() => download(model.name)}
                >
                  {percent !== undefined && percent < 100 ? `${percent}%` : 'Download'}
                </button>
              )}
            </div>
            {percent !== undefined && percent < 100 && (
              <div className="mt-3 h-2 overflow-hidden rounded bg-gray-200">
                <div className="h-full bg-blue-600" style={{ width: `${percent}%` }} />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
