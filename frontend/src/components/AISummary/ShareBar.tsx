'use client';

import React, { useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { Slack, SquareKanban, Loader2 } from 'lucide-react';

interface Props {
  meetingTitle: string;
  getMarkdown: () => string;
}

/**
 * Meeting-level actions: post the recap to Slack, or create a Jira issue from
 * the summary. Uses the api_slack_send_recap / api_jira_create_issue commands.
 * Connect accounts first in Settings → Integrations.
 */
export function ShareBar({ meetingTitle, getMarkdown }: Props) {
  const [panel, setPanel] = useState<null | 'slack' | 'jira'>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const [channel, setChannel] = useState('');
  const [projectId, setProjectId] = useState('');
  const [issueTypeId, setIssueTypeId] = useState('');
  const [summary, setSummary] = useState(meetingTitle || '');

  const sendSlack = async () => {
    setBusy(true); setMsg(null);
    try {
      const ts = await invoke<string>('api_slack_send_recap', {
        channel: channel.trim(),
        title: meetingTitle || 'Meeting recap',
        context: 'via Miting',
        summaryMd: getMarkdown(),
      });
      setMsg(ts ? `Sent to Slack (ts ${ts}).` : 'Sent to Slack.');
      setPanel(null);
    } catch (e) { setMsg('Slack: ' + e); } finally { setBusy(false); }
  };

  const createJira = async () => {
    setBusy(true); setMsg(null);
    try {
      const [key] = await invoke<[string, string]>('api_jira_create_issue', {
        input: {
          project_id: projectId.trim(),
          issuetype_id: issueTypeId.trim(),
          summary: summary.trim(),
          description_md: getMarkdown(),
          labels: ['miting'],
          assignee_account_id: null,
          due: null,
        },
      });
      setMsg(`Created ${key}.`);
      setPanel(null);
    } catch (e) { setMsg('Jira: ' + e); } finally { setBusy(false); }
  };

  const tab = 'px-3 py-1.5 text-sm rounded-md flex items-center gap-1.5 bg-gray-100 hover:bg-gray-200';
  const input = 'border border-gray-300 rounded-md px-2 py-1 text-sm';
  const go = 'px-3 py-1.5 text-sm font-semibold rounded-md bg-blue-600 text-white disabled:opacity-50';

  return (
    <div className="mb-4 border border-gray-200 rounded-lg p-3 bg-white">
      <div className="flex items-center gap-2">
        <span className="text-xs text-gray-400 mr-1">Share:</span>
        <button className={tab} onClick={() => setPanel(panel === 'slack' ? null : 'slack')}>
          <Slack className="w-4 h-4 text-[#611F69]" /> Send to Slack
        </button>
        <button className={tab} onClick={() => setPanel(panel === 'jira' ? null : 'jira')}>
          <SquareKanban className="w-4 h-4 text-[#0052CC]" /> Create Jira issue
        </button>
        {busy && <Loader2 className="w-4 h-4 animate-spin text-gray-400" />}
      </div>

      {panel === 'slack' && (
        <div className="mt-3 flex items-center gap-2">
          <input className={`${input} flex-1`} placeholder="#channel or channel ID"
            value={channel} onChange={(e) => setChannel(e.target.value)} />
          <button className={go} disabled={busy || !channel.trim()} onClick={sendSlack}>Send</button>
        </div>
      )}

      {panel === 'jira' && (
        <div className="mt-3 grid grid-cols-2 gap-2">
          <input className={input} placeholder="Project ID (e.g. 10000)"
            value={projectId} onChange={(e) => setProjectId(e.target.value)} />
          <input className={input} placeholder="Issue type ID (e.g. 10002)"
            value={issueTypeId} onChange={(e) => setIssueTypeId(e.target.value)} />
          <input className={`${input} col-span-2`} placeholder="Summary"
            value={summary} onChange={(e) => setSummary(e.target.value)} />
          <div className="col-span-2">
            <button className={go} disabled={busy || !projectId.trim() || !issueTypeId.trim() || !summary.trim()}
              onClick={createJira}>Create issue</button>
            <span className="ml-2 text-xs text-gray-400">Description = the summary above.</span>
          </div>
        </div>
      )}

      {msg && <div className="mt-2 text-sm text-gray-700">{msg}</div>}
    </div>
  );
}
