"use client";

import { Transcript, TranscriptSegmentData } from '@/types';
import { TranscriptView } from '@/components/TranscriptView';
import { VirtualizedTranscriptView } from '@/components/VirtualizedTranscriptView';
import { DiarizedTranscriptView, type DiarizedSegment } from '@/components/DiarizedTranscriptView';
import { TranscriptButtonGroup } from './TranscriptButtonGroup';
import { useMemo, useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';

interface TranscriptPanelProps {
  transcripts: Transcript[];
  customPrompt: string;
  onPromptChange: (value: string) => void;
  onCopyTranscript: () => void;
  onOpenMeetingFolder: () => Promise<void>;
  isRecording: boolean;
  disableAutoScroll?: boolean;

  // Optional pagination props (when using virtualization)
  usePagination?: boolean;
  segments?: TranscriptSegmentData[];
  hasMore?: boolean;
  isLoadingMore?: boolean;
  totalCount?: number;
  loadedCount?: number;
  onLoadMore?: () => void;

  // Retranscription props
  meetingId?: string;
  meetingFolderPath?: string | null;
  onRefetchTranscripts?: () => Promise<void>;
}

export function TranscriptPanel({
  transcripts,
  customPrompt,
  onPromptChange,
  onCopyTranscript,
  onOpenMeetingFolder,
  isRecording,
  disableAutoScroll = false,
  usePagination = false,
  segments,
  hasMore,
  isLoadingMore,
  totalCount,
  loadedCount,
  onLoadMore,
  meetingId,
  meetingFolderPath,
  onRefetchTranscripts,
}: TranscriptPanelProps) {
  // Convert transcripts to segments if pagination is not used but we want virtualization
  const convertedSegments = useMemo(() => {
    if (usePagination && segments) {
      return segments;
    }
    // Convert transcripts to segments for virtualization
    return transcripts.map(t => ({
      id: t.id,
      timestamp: t.audio_start_time ?? 0,
      endTime: t.audio_end_time,
      text: t.text,
      confidence: t.confidence,
    }));
  }, [transcripts, usePagination, segments]);

  // Meetily-GM: load diarized (speaker-named) segments for this meeting, if any.
  const [diarized, setDiarized] = useState<DiarizedSegment[]>([]);
  const [view, setView] = useState<'transcript' | 'diarized'>('transcript');

  useEffect(() => {
    let cancelled = false;
    if (!meetingId || isRecording) {
      setDiarized([]);
      return;
    }
    invoke<DiarizedSegment[]>('api_get_diarized_segments', { meetingId })
      .then((rows) => {
        if (cancelled) return;
        setDiarized(rows);
        // Default to the diarized view when it exists (it's the richer output).
        if (rows.length > 0) setView('diarized');
      })
      .catch(() => {
        if (!cancelled) setDiarized([]);
      });
    return () => {
      cancelled = true;
    };
  }, [meetingId, isRecording]);

  const hasDiarized = diarized.length > 0;

  return (
    <div className="hidden md:flex md:w-1/4 lg:w-1/3 min-w-0 border-r border-gray-200 bg-white flex-col relative shrink-0">
      {/* Title area */}
      <div className="p-4 border-b border-gray-200">
        <TranscriptButtonGroup
          transcriptCount={usePagination ? (totalCount ?? convertedSegments.length) : (transcripts?.length || 0)}
          onCopyTranscript={onCopyTranscript}
          onOpenMeetingFolder={onOpenMeetingFolder}
          meetingId={meetingId}
          meetingFolderPath={meetingFolderPath}
          onRefetchTranscripts={onRefetchTranscripts}
        />
        {/* Diarized vs raw transcript toggle (only when a diarized transcript exists) */}
        {hasDiarized && !isRecording && (
          <div className="mt-3 inline-flex rounded-lg border border-gray-200 p-0.5 text-sm">
            <button
              type="button"
              onClick={() => setView('diarized')}
              className={`px-3 py-1 rounded-md transition-colors ${
                view === 'diarized' ? 'bg-blue-500 text-white' : 'text-gray-600 hover:bg-gray-100'
              }`}
            >
              Diarized
            </button>
            <button
              type="button"
              onClick={() => setView('transcript')}
              className={`px-3 py-1 rounded-md transition-colors ${
                view === 'transcript' ? 'bg-blue-500 text-white' : 'text-gray-600 hover:bg-gray-100'
              }`}
            >
              Transcript
            </button>
          </div>
        )}
      </div>

      {/* Transcript content */}
      <div className="flex-1 overflow-hidden pb-4">
        {view === 'diarized' && hasDiarized ? (
          <DiarizedTranscriptView segments={diarized} />
        ) : (
          <VirtualizedTranscriptView
            segments={convertedSegments}
            isRecording={isRecording}
            isPaused={false}
            isProcessing={false}
            isStopping={false}
            enableStreaming={false}
            showConfidence={true}
            disableAutoScroll={disableAutoScroll}
            hasMore={hasMore}
            isLoadingMore={isLoadingMore}
            totalCount={totalCount}
            loadedCount={loadedCount}
            onLoadMore={onLoadMore}
          />
        )}
      </div>

      {/* Custom prompt input at bottom of transcript section */}
      {!isRecording && convertedSegments.length > 0 && (
        <div className="p-1 border-t border-gray-200">
          <textarea
            placeholder="Add context for AI summary. For example people involved, meeting overview, objective etc..."
            className="w-full px-3 py-2 border border-gray-200 rounded-md text-sm focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500 bg-white shadow-sm min-h-[80px] resize-y"
            value={customPrompt}
            onChange={(e) => onPromptChange(e.target.value)}
          />
        </div>
      )}
    </div>
  );
}
