'use client';

import React, { useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { CheckCircle2, SquareKanban, Sparkles, ExternalLink } from 'lucide-react';
import { ConnectAssistant } from './ConnectAssistant';

const TOKEN_URL = 'https://id.atlassian.com/manage-profile/security/api-tokens';

/** Jira connection with the same assistant-first pattern as Slack. */
export function JiraConnectCard({ connected, onChanged }: { connected: boolean; onChanged: () => void }) {
  const [showAI, setShowAI] = useState(false);
  const [site, setSite] = useState('');
  const [email, setEmail] = useState('');
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const open = (url: string) => invoke('api_open_external', { url }).catch(() => {});

  const connect = async () => {
    if (!site.trim() || !email.trim() || !token.trim()) {
      setMsg('Fill site, email and API token.');
      return;
    }
    setBusy(true);
    setMsg(null);
    try {
      await invoke('api_set_integration_secret', { key: 'jira.site', value: site.trim() });
      await invoke('api_set_integration_secret', { key: 'jira.email', value: email.trim() });
      await invoke('api_set_integration_secret', { key: 'jira.api_token', value: token.trim() });
      setToken('');
      setMsg('Jira connected. 🎉');
      onChanged();
    } catch (e) {
      setMsg('Error: ' + e);
    } finally {
      setBusy(false);
    }
  };

  const disconnect = async () => {
    await invoke('api_disconnect_integration', { connector: 'jira' });
    onChanged();
  };

  const input = 'w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500';

  return (
    <div className="border border-gray-200 rounded-lg p-5 bg-white">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 font-semibold"><SquareKanban className="w-5 h-5 text-[#0052CC]" /> Jira</div>
        {connected
          ? <span className="flex items-center gap-1 text-green-600 text-sm"><CheckCircle2 className="w-4 h-4" /> Connected</span>
          : <span className="text-gray-400 text-sm">Not connected</span>}
      </div>
      <p className="mt-2 text-sm text-gray-600">
        Turn meeting action items into Jira issues. You&apos;ll need your site URL, login email, and an API token.
      </p>

      <div className="mt-3 flex flex-wrap gap-2">
        <button onClick={() => setShowAI((v) => !v)} className="px-3 py-2 rounded-md text-sm font-medium bg-violet-600 text-white flex items-center gap-1.5">
          <Sparkles className="w-4 h-4" /> Help me connect
        </button>
        <button onClick={() => open(TOKEN_URL)} className="px-3 py-2 rounded-md text-sm bg-gray-100 hover:bg-gray-200 flex items-center gap-1.5">
          <ExternalLink className="w-4 h-4" /> Create API token
        </button>
        {connected && <button onClick={disconnect} className="px-3 py-2 rounded-md text-sm text-gray-600">Disconnect</button>}
      </div>

      {showAI && <div className="mt-3"><ConnectAssistant topic="jira" /></div>}

      <div className="mt-3 space-y-2">
        <input className={input} placeholder="Site URL (https://you.atlassian.net)" value={site} onChange={(e) => setSite(e.target.value)} />
        <input className={input} placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} />
        <input className={input} type="password" placeholder="API token" value={token} onChange={(e) => setToken(e.target.value)} />
        <button className="px-4 py-2 rounded-md text-sm font-semibold bg-blue-600 text-white disabled:opacity-50" disabled={busy} onClick={connect}>Connect</button>
      </div>
      {msg && <div className="mt-2 text-sm text-gray-700">{msg}</div>}
    </div>
  );
}
