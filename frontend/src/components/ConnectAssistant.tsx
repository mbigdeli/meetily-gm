'use client';

import React, { useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import Link from 'next/link';
import { Sparkles, Send, Loader2 } from 'lucide-react';

type Msg = { role: 'user' | 'assistant'; content: string };

const GREETING: Record<string, string> = {
  slack:
    "Hi! I can help you connect Slack. Tell me what you want — just post meeting recaps, or also read & search your channels — and I'll walk you through it one step at a time. No jargon.",
  jira: "Hi! I'll help you connect Jira so Miting can turn meetings into issues. Say “start” and I'll guide you.",
  general: 'Hi! Ask me anything about connecting this integration.',
};

/** Chat panel that guides the user through connecting an integration, powered
 *  by whatever AI they configured in Settings -> Model (api_assistant_chat). */
export function ConnectAssistant({ topic }: { topic: 'slack' | 'jira' | 'general' }) {
  const [messages, setMessages] = useState<Msg[]>([
    { role: 'assistant', content: GREETING[topic] ?? GREETING.general },
  ]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [needsAI, setNeedsAI] = useState(false);

  const send = async () => {
    const text = input.trim();
    if (!text || busy) return;
    const next: Msg[] = [...messages, { role: 'user', content: text }];
    setMessages(next);
    setInput('');
    setBusy(true);
    try {
      const reply = await invoke<string>('api_assistant_chat', { topic, messages: next });
      setMessages([...next, { role: 'assistant', content: reply }]);
    } catch (e) {
      const s = String(e);
      if (s.includes('no_ai_configured')) setNeedsAI(true);
      else setMessages([...next, { role: 'assistant', content: `⚠️ ${s}` }]);
    } finally {
      setBusy(false);
    }
  };

  if (needsAI) {
    return (
      <div className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
        To use the assistant, first choose an AI in{' '}
        <Link href="/settings" className="font-semibold underline">Settings &rarr; Model</Link>. The
        free local options (Claude Code / Codex) need no API key.
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-violet-200 overflow-hidden">
      <div className="flex items-center gap-2 px-3 py-2 bg-violet-100 text-violet-800 text-sm font-medium">
        <Sparkles className="w-4 h-4" /> Connection assistant
      </div>
      <div className="max-h-72 overflow-y-auto p-3 space-y-3 bg-violet-50/40">
        {messages.map((m, i) => (
          <div key={i} className={m.role === 'user' ? 'text-right' : ''}>
            <div
              className={`inline-block text-left rounded-lg px-3 py-2 text-sm max-w-[90%] ${
                m.role === 'user'
                  ? 'bg-blue-600 text-white'
                  : 'bg-white border border-gray-200 text-gray-800'
              }`}
            >
              <div className="prose prose-sm max-w-none prose-p:my-1 prose-li:my-0">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{m.content}</ReactMarkdown>
              </div>
            </div>
          </div>
        ))}
        {busy && <Loader2 className="w-4 h-4 animate-spin text-violet-500" />}
      </div>
      <div className="flex items-center gap-2 border-t border-violet-200 p-2 bg-white">
        <input
          className="flex-1 border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-400"
          placeholder="Ask how to connect… (English or فارسی)"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') send();
          }}
          disabled={busy}
        />
        <button
          className="px-3 py-2 rounded-md bg-violet-600 text-white disabled:opacity-50"
          disabled={busy || !input.trim()}
          onClick={send}
          aria-label="Send"
        >
          <Send className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}
