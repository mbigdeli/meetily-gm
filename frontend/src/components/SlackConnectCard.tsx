'use client';

import React, { useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { CheckCircle2, Slack, Sparkles, ExternalLink, ChevronDown } from 'lucide-react';
import { ConnectAssistant } from './ConnectAssistant';

const SLACK_APPS_URL = 'https://api.slack.com/apps';

/** Friendly Slack connection: assistant-first, with a one-click link to the
 *  Slack app creator; raw token/webhook fields tucked under "Advanced". */
export function SlackConnectCard({ connected, onChanged }: { connected: boolean; onChanged: () => void }) {
  const [showAI, setShowAI] = useState(!connected);
  const [showManual, setShowManual] = useState(false);
  const [user, setUser] = useState('');
  const [bot, setBot] = useState('');
  const [webhook, setWebhook] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const open = (url: string) => invoke('api_open_external', { url }).catch(() => {});

  const connect = async () => {
    if (!user.trim() && !bot.trim() && !webhook.trim()) {
      setMsg('Paste a token or webhook first.');
      return;
    }
    setBusy(true);
    setMsg(null);
    try {
      if (user.trim()) await invoke('api_set_integration_secret', { key: 'slack.user_token', value: user.trim() });
      if (bot.trim()) await invoke('api_set_integration_secret', { key: 'slack.bot_token', value: bot.trim() });
      if (webhook.trim()) await invoke('api_set_integration_secret', { key: 'slack.webhook_url', value: webhook.trim() });
      setUser(''); setBot(''); setWebhook('');
      try {
        const ch = await invoke<unknown[]>('api_slack_list_channels');
        setMsg(`Connected — I can see ${ch.length} channels. 🎉`);
      } catch {
        setMsg('Saved. (Could not list channels — a webhook is send-only.)');
      }
      onChanged();
    } catch (e) {
      setMsg('Error: ' + e);
    } finally {
      setBusy(false);
    }
  };

  const disconnect = async () => {
    await invoke('api_disconnect_integration', { connector: 'slack' });
    onChanged();
  };

  const input = 'w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500';

  return (
    <div className="border border-gray-200 rounded-lg p-5 bg-white">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 font-semibold"><Slack className="w-5 h-5 text-[#611F69]" /> Slack</div>
        {connected
          ? <span className="flex items-center gap-1 text-green-600 text-sm"><CheckCircle2 className="w-4 h-4" /> Connected</span>
          : <span className="text-gray-400 text-sm">Not connected</span>}
      </div>
      <p className="mt-2 text-sm text-gray-600">
        Post recaps to Slack — and, with a personal token, read &amp; search your channels as you. Setup takes ~2 minutes; the assistant can walk you through it.
      </p>

      <div className="mt-3 flex flex-wrap gap-2">
        <button onClick={() => setShowAI((v) => !v)} className="px-3 py-2 rounded-md text-sm font-medium bg-violet-600 text-white flex items-center gap-1.5">
          <Sparkles className="w-4 h-4" /> Help me connect
        </button>
        <button onClick={() => open(SLACK_APPS_URL)} className="px-3 py-2 rounded-md text-sm bg-gray-100 hover:bg-gray-200 flex items-center gap-1.5">
          <ExternalLink className="w-4 h-4" /> Open Slack app creator
        </button>
        {connected && <button onClick={disconnect} className="px-3 py-2 rounded-md text-sm text-gray-600">Disconnect</button>}
      </div>

      {showAI && <div className="mt-3"><ConnectAssistant topic="slack" /></div>}

      <button onClick={() => setShowManual((v) => !v)} className="mt-3 text-xs text-gray-500 flex items-center gap-1">
        <ChevronDown className={`w-3 h-3 transition ${showManual ? 'rotate-180' : ''}`} /> I already have a token / webhook
      </button>
      {showManual && (
        <div className="mt-2 space-y-2">
          <input className={input} placeholder="User token xoxp-… (read + send as you)" value={user} onChange={(e) => setUser(e.target.value)} />
          <input className={input} placeholder="Bot token xoxb-… (send only)" value={bot} onChange={(e) => setBot(e.target.value)} />
          <input className={input} placeholder="Incoming webhook URL (send only)" value={webhook} onChange={(e) => setWebhook(e.target.value)} />
          <button className="px-4 py-2 rounded-md text-sm font-semibold bg-blue-600 text-white disabled:opacity-50" disabled={busy} onClick={connect}>Connect</button>
        </div>
      )}
      {msg && <div className="mt-2 text-sm text-gray-700">{msg}</div>}
    </div>
  );
}
