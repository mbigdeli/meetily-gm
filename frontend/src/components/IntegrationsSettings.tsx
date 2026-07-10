'use client';

import React, { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { CheckCircle2, Loader2, Slack, SquareKanban } from 'lucide-react';

/**
 * Integrations panel — connect Slack + Jira with your own accounts. Tokens are
 * stored in the app database (same as your other API keys). Wraps the Rust
 * commands: api_integration_status / api_set_integration_secret /
 * api_disconnect_integration. Meeting recaps + Jira issues send from the
 * meeting view once connected here.
 */
export function IntegrationsSettings() {
  const [connected, setConnected] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const [slackToken, setSlackToken] = useState('');
  const [slackWebhook, setSlackWebhook] = useState('');
  const [jiraSite, setJiraSite] = useState('');
  const [jiraEmail, setJiraEmail] = useState('');
  const [jiraToken, setJiraToken] = useState('');

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

  const setSecret = (key: string, value: string) =>
    invoke('api_set_integration_secret', { key, value });

  const connectSlack = async () => {
    setBusy(true);
    setMsg(null);
    try {
      if (!slackToken.trim() && !slackWebhook.trim()) {
        setMsg('Enter a bot token or a webhook URL.');
        return;
      }
      if (slackToken.trim()) await setSecret('slack.bot_token', slackToken.trim());
      if (slackWebhook.trim()) await setSecret('slack.webhook_url', slackWebhook.trim());
      setSlackToken('');
      setSlackWebhook('');
      setMsg('Slack connected.');
      await refresh();
    } catch (e) {
      setMsg('Slack error: ' + e);
    } finally {
      setBusy(false);
    }
  };

  const connectJira = async () => {
    setBusy(true);
    setMsg(null);
    try {
      if (!jiraSite.trim() || !jiraEmail.trim() || !jiraToken.trim()) {
        setMsg('Fill site URL, email, and API token.');
        return;
      }
      await setSecret('jira.site', jiraSite.trim());
      await setSecret('jira.email', jiraEmail.trim());
      await setSecret('jira.api_token', jiraToken.trim());
      setJiraToken('');
      setMsg('Jira connected.');
      await refresh();
    } catch (e) {
      setMsg('Jira error: ' + e);
    } finally {
      setBusy(false);
    }
  };

  const disconnect = async (c: string) => {
    await invoke('api_disconnect_integration', { connector: c });
    await refresh();
  };

  const on = (c: string) => connected.includes(c);
  const input =
    'w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500';
  const btn = 'px-4 py-2 rounded-md text-sm font-semibold bg-blue-600 text-white disabled:opacity-50';

  return (
    <div className="mt-6 space-y-6 max-w-2xl">
      <p className="text-gray-600 text-sm">
        Connect your own accounts. Tokens stay on this device. After connecting, use
        <span className="font-medium"> Send to Slack</span> and <span className="font-medium">Create Jira issue</span> from a meeting.
      </p>

      {/* Slack */}
      <div className="border border-gray-200 rounded-lg p-5 bg-white">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 font-semibold">
            <Slack className="w-5 h-5 text-[#611F69]" /> Slack
          </div>
          {on('slack') ? (
            <span className="flex items-center gap-1 text-green-600 text-sm">
              <CheckCircle2 className="w-4 h-4" /> Connected
            </span>
          ) : (
            <span className="text-gray-400 text-sm">Not connected</span>
          )}
        </div>
        <div className="mt-3 space-y-2">
          <input className={input} placeholder="Bot token (xoxb-…)" value={slackToken}
            onChange={(e) => setSlackToken(e.target.value)} />
          <div className="text-center text-xs text-gray-400">or</div>
          <input className={input} placeholder="Incoming webhook URL (https://hooks.slack.com/…)"
            value={slackWebhook} onChange={(e) => setSlackWebhook(e.target.value)} />
          <div className="flex gap-2 pt-1">
            <button className={btn} disabled={busy} onClick={connectSlack}>Connect</button>
            {on('slack') && (
              <button className="px-4 py-2 rounded-md text-sm text-gray-600" onClick={() => disconnect('slack')}>
                Disconnect
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Jira */}
      <div className="border border-gray-200 rounded-lg p-5 bg-white">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 font-semibold">
            <SquareKanban className="w-5 h-5 text-[#0052CC]" /> Jira
          </div>
          {on('jira') ? (
            <span className="flex items-center gap-1 text-green-600 text-sm">
              <CheckCircle2 className="w-4 h-4" /> Connected
            </span>
          ) : (
            <span className="text-gray-400 text-sm">Not connected</span>
          )}
        </div>
        <div className="mt-3 space-y-2">
          <input className={input} placeholder="Site URL (https://you.atlassian.net)" value={jiraSite}
            onChange={(e) => setJiraSite(e.target.value)} />
          <input className={input} placeholder="Email" value={jiraEmail}
            onChange={(e) => setJiraEmail(e.target.value)} />
          <input className={input} type="password" placeholder="API token" value={jiraToken}
            onChange={(e) => setJiraToken(e.target.value)} />
          <div className="flex gap-2 pt-1">
            <button className={btn} disabled={busy} onClick={connectJira}>Connect</button>
            {on('jira') && (
              <button className="px-4 py-2 rounded-md text-sm text-gray-600" onClick={() => disconnect('jira')}>
                Disconnect
              </button>
            )}
          </div>
          <p className="text-xs text-gray-400">
            Create an API token at id.atlassian.com → Security → API tokens.
          </p>
        </div>
      </div>

      {msg && (
        <div className="text-sm flex items-center gap-2 text-gray-700">
          {busy && <Loader2 className="w-4 h-4 animate-spin" />} {msg}
        </div>
      )}
    </div>
  );
}
