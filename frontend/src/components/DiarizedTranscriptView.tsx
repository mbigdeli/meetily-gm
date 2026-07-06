'use client';

import { memo } from 'react';

export interface DiarizedSegment {
  seq: number;
  start_sec?: number | null;
  end_sec?: number | null;
  speaker_name?: string | null;
  language?: string | null;
  confidence?: number | null;
  text: string;
}

// Fixed palette; a speaker's color is stable across the meeting (hash of name).
const SPEAKER_COLORS = [
  { chip: 'bg-blue-100 text-blue-800', dot: 'bg-blue-500' },
  { chip: 'bg-emerald-100 text-emerald-800', dot: 'bg-emerald-500' },
  { chip: 'bg-purple-100 text-purple-800', dot: 'bg-purple-500' },
  { chip: 'bg-amber-100 text-amber-800', dot: 'bg-amber-500' },
  { chip: 'bg-pink-100 text-pink-800', dot: 'bg-pink-500' },
  { chip: 'bg-cyan-100 text-cyan-800', dot: 'bg-cyan-500' },
  { chip: 'bg-indigo-100 text-indigo-800', dot: 'bg-indigo-500' },
  { chip: 'bg-rose-100 text-rose-800', dot: 'bg-rose-500' },
];

function colorFor(name: string) {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) | 0;
  return SPEAKER_COLORS[Math.abs(hash) % SPEAKER_COLORS.length];
}

function formatTime(seconds?: number | null): string {
  if (seconds === undefined || seconds === null) return '';
  const total = Math.floor(seconds);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}

const Line = memo(function Line({ seg, showSpeakerHeader }: { seg: DiarizedSegment; showSpeakerHeader: boolean }) {
  const name = seg.speaker_name?.trim() || 'Unknown';
  const color = colorFor(name);
  return (
    <div className="mb-3">
      {showSpeakerHeader && (
        <div className="flex items-center gap-2 mb-1">
          <span className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-semibold ${color.chip}`}>
            <span className={`h-2 w-2 rounded-full ${color.dot}`} />
            {name}
          </span>
          {(seg.start_sec ?? null) !== null && (
            <span className="text-xs text-gray-400">{formatTime(seg.start_sec)}</span>
          )}
        </div>
      )}
      <p className="text-base leading-relaxed text-gray-800 pl-1">{seg.text}</p>
    </div>
  );
});

export function DiarizedTranscriptView({ segments }: { segments: DiarizedSegment[] }) {
  if (!segments || segments.length === 0) {
    return (
      <div className="flex h-full items-center justify-center px-4 text-center text-gray-500">
        <div>
          <p className="text-sm font-medium">No diarized transcript yet</p>
          <p className="mt-1 text-xs text-gray-400">
            Record a Google Meet (captions on) and it will appear here with speaker names.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col overflow-y-auto px-4 py-2">
      {segments.map((seg, i) => {
        const prev = segments[i - 1];
        const showHeader =
          !prev || (prev.speaker_name?.trim() || 'Unknown') !== (seg.speaker_name?.trim() || 'Unknown');
        return <Line key={seg.seq} seg={seg} showSpeakerHeader={showHeader} />;
      })}
    </div>
  );
}
