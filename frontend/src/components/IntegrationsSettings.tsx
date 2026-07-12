'use client';

import React, { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { SlackConnectCard } from './SlackConnectCard';
import { JiraConnectCard } from './JiraConnectCard';

/**
 * Integrations panel — connect Slack + Jira with your own accounts. Tokens are
 * stored in the app database on this device. Each card is assistant-first: the
 * built-in AI (Settings -> Model) can walk the user through getting a token.
 */
export function IntegrationsSettings() {
  const [connected, setConnected] = useState<string[]>([]);

  const refresh = async () => {
    try {
      setConnected(await invoke<string[]>('api_integration_status'));
    } catch (e) {
      console.error('integration status failed', e);
    }
  };
  useEffect(() => {
    refresh();
  }, []);

  return (
    <div className="mt-6 space-y-6 max-w-2xl">
      <p className="text-gray-600 text-sm">
        Connect your own accounts — tokens stay on this device. New to this? Click{' '}
        <span className="font-medium text-violet-700">Help me connect</span> on any card and the
        assistant will guide you step by step.
      </p>
      <SlackConnectCard connected={connected.includes('slack')} onChanged={refresh} />
      <JiraConnectCard connected={connected.includes('jira')} onChanged={refresh} />
    </div>
  );
}
