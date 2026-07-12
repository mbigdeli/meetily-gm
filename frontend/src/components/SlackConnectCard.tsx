'use client';

import React, { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { CheckCircle2, Slack, Loader2 } from 'lucide-react';

// Miting's own registered Slack app (public client, PKCE — Client ID is not a
// secret). Fixed values; users just click Connect.
const DEFAULT_CLIENT_ID = '11569736741734.11565513375619';
const DEFAULT_CALLBACK = 'https://mbigdeli.github.io/meetily-gm/oauth/slack-callback.html';

/** Slack connection: one-click OAuth (PKCE, no secret, no setup). */
export function SlackConnectCard({ connected, onChanged }: { connected: boolean; onChanged: () => void }) {
  const [clientId, setClientId] = useState(DEFAULT_CLIENT_ID);
  const [callback, setCallback] = useState(DEFAULT_CALLBACK);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  // Honor a stored override if one was ever set (self-hosters); else defaults.
  useEffect(() => {
    invoke<[string, string]>('api_slack_oauth_config')
      .then(([cid, uri]) => { if (cid) setClientId(cid); if (uri) setCallback(uri); })
      .catch(() => {});
  }, []);

  const connect = async () => {
    setBusy(true);
    setMsg('Opening Slack in your browser… approve there, then come back.');
    try {
      const team = await invoke<string>('api_slack_oauth_connect', {
        clientId: clientId.trim(),
        redirectUri: callback.trim(),
      });
      setMsg(`Connected to ${team || 'Slack'} 🎉`);
      onChanged();
    } catch (e) {
      setMsg('Slack: ' + e);
    } finally {
      setBusy(false);
    }
  };

  const disconnect = async () => {
    await invoke('api_disconnect_integration', { connector: 'slack' });
    onChanged();
  };

  return (
    <div className="border border-gray-200 rounded-lg p-5 bg-white">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 font-semibold"><Slack className="w-5 h-5 text-[#611F69]" /> Slack</div>
        {connected
          ? <span className="flex items-center gap-1 text-green-600 text-sm"><CheckCircle2 className="w-4 h-4" /> Connected</span>
          : <span className="text-gray-400 text-sm">Not connected</span>}
      </div>
      <p className="mt-2 text-sm text-gray-600">Post recaps and read your channels as you. Just click <span className="font-medium">Connect &rarr; Allow</span>.</p>

      <div className="mt-3 flex flex-wrap gap-2">
        <button onClick={connect} disabled={busy} className="px-3 py-2 rounded-md text-sm font-semibold bg-[#611F69] text-white disabled:opacity-50 flex items-center gap-1.5">
          {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Slack className="w-4 h-4" />} {connected ? 'Reconnect' : 'Connect with Slack'}
        </button>
        {connected && <button onClick={disconnect} className="px-3 py-2 rounded-md text-sm text-gray-600">Disconnect</button>}
      </div>

      {msg && <div className="mt-2 text-sm text-gray-700">{msg}</div>}
    </div>
  );
}
