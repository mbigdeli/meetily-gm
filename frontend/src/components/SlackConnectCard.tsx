'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { CheckCircle2, Slack, Loader2, Plus, ChevronDown, X } from 'lucide-react';

// Miting's own registered Slack app (public client, PKCE — Client ID is not a
// secret). Fixed values; users just click Connect.
const DEFAULT_CLIENT_ID = '11569736741734.11565513375619';
const DEFAULT_CALLBACK = 'https://mbigdeli.github.io/meetily-gm/oauth/slack-callback.html';

type Account = { team_id: string; team_name: string; active: boolean };

/** Slack: one-click OAuth (PKCE). Supports multiple workspaces — the active one
 *  is what recaps/search act as. */
export function SlackConnectCard({ connected, onChanged }: { connected: boolean; onChanged: () => void }) {
  const [clientId, setClientId] = useState(DEFAULT_CLIENT_ID);
  const [callback, setCallback] = useState(DEFAULT_CALLBACK);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [showList, setShowList] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const refreshAccounts = useCallback(async () => {
    try { setAccounts(await invoke<Account[]>('api_slack_accounts')); } catch { setAccounts([]); }
  }, []);

  useEffect(() => {
    invoke<[string, string]>('api_slack_oauth_config')
      .then(([c, u]) => { if (c) setClientId(c); if (u) setCallback(u); })
      .catch(() => {});
    refreshAccounts();
  }, [refreshAccounts]);

  const connect = async () => {
    setBusy(true);
    setMsg('Opening Slack in your browser… approve there, then come back.');
    try {
      const team = await invoke<string>('api_slack_oauth_connect', { clientId: clientId.trim(), redirectUri: callback.trim() });
      setMsg(`Connected to ${team || 'Slack'} 🎉`);
      await refreshAccounts();
      onChanged();
    } catch (e) { setMsg('Slack: ' + e); } finally { setBusy(false); }
  };

  const setActive = async (id: string) => { await invoke('api_slack_set_active', { teamId: id }); await refreshAccounts(); };
  const removeAcct = async (id: string) => { await invoke('api_slack_disconnect_account', { teamId: id }); await refreshAccounts(); onChanged(); };

  const has = accounts.length > 0;

  return (
    <div className="border border-gray-200 rounded-lg p-5 bg-white">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 font-semibold"><Slack className="w-5 h-5 text-[#611F69]" /> Slack</div>
        {has || connected
          ? <span className="flex items-center gap-1 text-green-600 text-sm"><CheckCircle2 className="w-4 h-4" /> Connected</span>
          : <span className="text-gray-400 text-sm">Not connected</span>}
      </div>
      <p className="mt-2 text-sm text-gray-600">Post recaps and read your channels as you. Just click <span className="font-medium">Connect &rarr; Allow</span>.</p>

      <div className="mt-3 flex flex-wrap gap-2">
        <button onClick={connect} disabled={busy} className="px-3 py-2 rounded-md text-sm font-semibold bg-[#611F69] text-white disabled:opacity-50 flex items-center gap-1.5">
          {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : has ? <Plus className="w-4 h-4" /> : <Slack className="w-4 h-4" />}
          {has ? 'Add workspace' : 'Connect with Slack'}
        </button>
      </div>

      {has && (
        <>
          <button onClick={() => setShowList((v) => !v)} className="mt-3 text-xs text-gray-500 flex items-center gap-1">
            <ChevronDown className={`w-3 h-3 transition ${showList ? 'rotate-180' : ''}`} /> Connected workspaces ({accounts.length})
          </button>
          {showList && (
            <div className="mt-2 space-y-1.5">
              {accounts.map((a) => (
                <div key={a.team_id} className="flex items-center justify-between rounded-md border border-gray-100 bg-gray-50 px-3 py-1.5 text-sm">
                  <span className="flex items-center gap-2">
                    {a.active
                      ? <span className="flex items-center gap-1 text-green-600 text-xs font-medium"><CheckCircle2 className="w-3.5 h-3.5" /> active</span>
                      : <button onClick={() => setActive(a.team_id)} className="text-xs text-blue-600 hover:underline">make active</button>}
                    <span className="text-gray-800">{a.team_name || a.team_id}</span>
                  </span>
                  <button onClick={() => removeAcct(a.team_id)} title="Remove" className="text-gray-400 hover:text-red-500"><X className="w-4 h-4" /></button>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {msg && <div className="mt-2 text-sm text-gray-700">{msg}</div>}
    </div>
  );
}
