/**
 * Model-list controls for a CLI provider card (codex / claude-code):
 * a "Refresh models" action (web-augmented fetch + per-id validation on the
 * backend) and, when no validated models exist beyond `default`, a manual
 * entry field that probes the typed id before saving it.
 */

import { useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { CliModelEntry, CliProvider, validateCliModel } from '@/services/cliModelService';

interface Props {
  provider: CliProvider;
  connected: boolean;
  models: CliModelEntry[] | null;
  loading: boolean;
  onRefresh: () => void;
  onValidated: (id: string) => void;
}

const DOCS: Record<CliProvider, { query: string; url: string }> = {
  codex: {
    query: "search 'OpenAI Codex CLI model names'",
    url: 'https://platform.openai.com/docs/models',
  },
  'claude-code': {
    query: "search 'Anthropic Claude model names'",
    url: 'https://docs.claude.com/en/docs/about-claude/models',
  },
};

export function CliModelsSection({ provider, connected, models, loading, onRefresh, onValidated }: Props) {
  const [customModel, setCustomModel] = useState('');
  const [validating, setValidating] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);

  const validatedCount = models ? models.filter((m) => m.id !== 'default').length : 0;
  const showFallback = !loading && models !== null && validatedCount === 0;

  const submitCustomModel = async () => {
    if (!customModel.trim() || validating) return;
    setValidating(true);
    setValidationError(null);
    try {
      const outcome = await validateCliModel(provider, customModel);
      if (outcome.valid) {
        onValidated(customModel.trim());
        setCustomModel('');
      } else {
        setValidationError(outcome.error ?? 'The model was rejected.');
      }
    } catch (err) {
      setValidationError(String(err));
    } finally {
      setValidating(false);
    }
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center space-x-2">
        <Button type="button" variant="outline" size="sm" onClick={onRefresh} disabled={loading || !connected}>
          <RefreshCw className={loading ? 'mr-2 h-3.5 w-3.5 animate-spin' : 'mr-2 h-3.5 w-3.5'} />
          {loading ? 'Verifying models…' : 'Refresh models'}
        </Button>
        <span className="text-xs text-muted-foreground">
          {loading
            ? 'Asking the CLI (web search), then test-running each model.'
            : validatedCount > 0
              ? `${validatedCount} verified model${validatedCount === 1 ? '' : 's'} + default.`
              : 'Fetches current models and verifies each one before listing it.'}
        </span>
      </div>
      {!connected && <div className="text-xs text-amber-600">Sign in first to refresh or verify models.</div>}
      {showFallback && (
        <div className="space-y-2 rounded-md border p-2">
          <div className="text-xs text-muted-foreground">
            No verified models yet (list not fetched, or every known id was rejected). Find the
            current model name — {DOCS[provider].query} or open{' '}
            <button
              type="button"
              className="underline text-primary"
              onClick={() => invoke('api_open_external', { url: DOCS[provider].url })}
            >
              the official model docs
            </button>{' '}
            — and paste it here. It is verified with a real call before being saved.
          </div>
          <div className="flex items-center space-x-2">
            <Input
              value={customModel}
              onChange={(e) => setCustomModel(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && submitCustomModel()}
              placeholder={provider === 'codex' ? 'e.g. gpt-5.6-sol' : 'e.g. claude-sonnet-4-6'}
              className="h-8 max-w-[240px] text-sm"
              disabled={validating || !connected}
            />
            <Button type="button" size="sm" onClick={submitCustomModel} disabled={validating || !connected || !customModel.trim()}>
              {validating ? 'Verifying…' : 'Verify & add'}
            </Button>
          </div>
          {validationError && <div className="text-xs text-red-600 break-words">{validationError}</div>}
        </div>
      )}
    </div>
  );
}
