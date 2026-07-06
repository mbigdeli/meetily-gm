'use client';

import { Loader2, CheckCircle2, AlertCircle, Users } from 'lucide-react';
import type { MeetingStatus } from './SidebarProvider';

/**
 * Meetily-GM: compact per-meeting status chip for the sidebar list.
 * Priority: in-progress > failed > summarized > diarized > (nothing).
 */
export function MeetingStatusChip({ status }: { status?: MeetingStatus }) {
  if (!status) return null;

  const s = (status.summary_status || '').toLowerCase();
  const running = s === 'pending' || s === 'running' || s === 'processing';

  if (running) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-blue-100 px-1.5 py-0.5 text-[10px] font-medium text-blue-700">
        <Loader2 className="h-3 w-3 animate-spin" /> Summarizing
      </span>
    );
  }
  if (s === 'failed' || s === 'error') {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-700">
        <AlertCircle className="h-3 w-3" /> Failed
      </span>
    );
  }
  if (s === 'completed') {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700">
        <CheckCircle2 className="h-3 w-3" /> Summarized
      </span>
    );
  }
  if (status.diarized) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-indigo-100 px-1.5 py-0.5 text-[10px] font-medium text-indigo-700">
        <Users className="h-3 w-3" /> Diarized
      </span>
    );
  }
  return null;
}
