'use client';

import React, { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { CheckCircle2, Slack, Sparkles, ExternalLink, ChevronDown, Loader2 } from 'lucide-react';
import { ConnectAssistant } from './ConnectAssistant';

const SLACK_APPS_URL = 'https://api.slack.com/apps';
const DEFAULT_CALLBACK = 'https://mbigdeli.github.io/meetily-gm/oauth/slack-callback.html';

/** Slack connection. Primary path = one-click OAuth (PKCE, no secret). The
 *  assistant guides the one-time app setup; raw tokens live under "Advanced". */
export function SlackConnectCard({ connected, onChanged }: { connected: boolean; onChanged: () => void }) {
  const [showAI, setShowAI] = useState(false);
  const [showSetup, setShowSetup] = useState(!connected);
  const [showManual, setShowManual] = useState(false);
  const [clientId, setClientId] = useState('');
  const [callback, setCallback] = useState(DEFAULT_CALLBACK);
  const [user, setUser] = useState('');
  const [bot, setBot] = useState('');
  const [webhook, setWebhook] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    invoke<[string, string]>('api_slack_oauth_config')
      .then(([cid, uri]) => { if (cid) setClientId(cid); if (uri) setCallback(uri); })
      .catch(() => {});
  }, []);

  const open = (url: string) => invoke('api_open_external', { url }).catch(() => {});

  const connectOAuth = async () => {
    if (!clientId.trim()) { setShowSetup(true); setMsg('Paste your Slack Client ID first (see "Help me connect").'); return; }
    setBusy(true); setMsg('Opening Slack in your browser… approve there, then come back.');
    try {
      const team = await invoke<string>('api_slack_oauth_connect', { clientId: clientId.trim(), redirectUri: callback.trim() });
      setMsg(`Connected to ${team || 'Slack'} 🎉`);
      onChanged();
    } catch (e) { setMsg('Slack: ' + e); } finally { setBusy(false); }
  };

  const connectManual = async () => {
    if (!user.trim() && !bot.trim() && !webhook.trim()) { setMsg('Paste a token or webhook first.'); return; }
    setBusy(true); setMsg(null);
    try {
      if (user.trim()) await invoke('api_set_integration_secret', { key: 'slack.user_token', value: user.trim() });
      if (bot.trim()) await invoke('api_set_integration_secret', { key: 'slack.bot_token', value: bot.trim() });
      if (webhook.trim()) await invoke('api_set_integration_secret', { key: 'slack.webhook_url', value: webhook.trim() });
      setUser(''); setBot(''); setWebhook('');
      setMsg('Saved.'); onChanged();
    } catch (e) { setMsg('Error: ' + e); } finally { setBusy(false); }
  };

  const disconnect = async () => { await invoke('api_disconnect_integration', { connector: 'slack' }); onChanged(); };
  const input = 'w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500';

  return (
    <div className="border border-gray-200 rounded-lg p-5 bg-white">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 font-semibold"><Slack className="w-5 h-5 text-[#611F69]" /> Slack</div>
        {connected
          ? <span className="flex items-center gap-1 text-green-600 text-sm"><CheckCircle2 className="w-4 h-4" /> Connected</span>
          : <span className="text-gray-400 text-sm">Not connected</span>}
      </div>
      <p className="mt-2 text-sm text-gray-600">Post recaps and read your channels as you. One-time setup (~2 min) — the assistant walks you through it — then it&apos;s just <span className="font-medium">Connect &rarr; Allow</span>.</p>

      <div className="mt-3 flex flex-wrap gap-2">
        <button onClick={connectOAuth} disabled={busy} className="px-3 py-2 rounded-md text-sm font-semibold bg-[#611F69] text-white disabled:opacity-50 flex items-center gap-1.5">
          {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Slack className="w-4 h-4" />} Connect with Slack
        </button>
        <button onClick={() => setShowAI((v) => !v)} className="px-3 py-2 rounded-md text-sm font-medium bg-violet-100 text-violet-700 flex items-center gap-1.5"><Sparkles className="w-4 h-4" /> Help me connect</button>
        {connected && <button onClick={disconnect} className="px-3 py-2 rounded-md text-sm text-gray-600">Disconnect</button>}
      </div>

      <button onClick={() => setShowSetup((v) => !v)} className="mt-3 text-xs text-gray-500 flex items-center gap-1">
        <ChevronDown className={`w-3 h-3 transition ${showSetup ? 'rotate-180' : ''}`} /> One-time setup (Client ID + callback)
      </button>
      {showSetup && (
        <div className="mt-2 space-y-2">
          <input className={input} placeholder="Slack Client ID (from api.slack.com → your app)" value={clientId} onChange={(e) => setClientId(e.target.value)} />
          <input className={input} placeholder="Callback URL (GitHub Pages)" value={callback} onChange={(e) => setCallback(e.target.value)} />
          <button onClick={() => open(SLACK_APPS_URL)} className="text-xs text-blue-600 flex items-center gap-1"><ExternalLink className="w-3 h-3" /> Open api.slack.com/apps</button>
        </div>
      )}

      {showAI && <div className="mt-3"><ConnectAssistant topic="slack" /></div>}

      <button onClick={() => setShowManual((v) => !v)} className="mt-3 text-xs text-gray-400 flex items-center gap-1">
        <ChevronDown className={`w-3 h-3 transition ${showManual ? 'rotate-180' : ''}`} /> Advanced: paste a token / webhook manually
      </button>
      {showManual && (
        <div className="mt-2 space-y-2">
          <input className={input} placeholder="User token xoxp-… (read + send as you)" value={user} onChange={(e) => setUser(e.target.value)} />
          <input className={input} placeholder="Bot token xoxb-… (send only)" value={bot} onChange={(e) => setBot(e.target.value)} />
          <input className={input} placeholder="Incoming webhook URL (send only)" value={webhook} onChange={(e) => setWebhook(e.target.value)} />
          <button className="px-4 py-2 rounded-md text-sm font-semibold bg-blue-600 text-white disabled:opacity-50" disabled={busy} onClick={connectManual}>Save token</button>
        </div>
      )}
      {msg && <div className="mt-2 text-sm text-gray-700">{msg}</div>}
    </div>
  );
}
