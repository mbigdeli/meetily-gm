'use client';

import { useEffect, useRef, useState } from 'react';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { invoke } from '@tauri-apps/api/core';
import { toast } from 'sonner';

const GRACE_SECONDS = 300; // 5-minute resume window after a Meet closes/pauses.

/**
 * Meetily-GM: owns the Google Meet recording lifecycle events from the ingest
 * server and the post-meeting grace window.
 *
 * - gmeet-start-recording: start meetily's live recording (or RESUME if the same
 *   Meet was rejoined within the grace window).
 * - gmeet-pause-recording (Meet closed/paused): pause the recording and start a
 *   5-minute countdown; auto-finalize on expiry. A "Finalize now" button skips
 *   the wait.
 * - gmeet-stop-recording: finalize immediately.
 */
export function GmeetGraceController({ showOnboarding }: { showOnboarding: boolean }) {
  const [graceActive, setGraceActive] = useState(false);
  const [secondsLeft, setSecondsLeft] = useState(GRACE_SECONDS);

  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const graceActiveRef = useRef(false);
  const onboardingRef = useRef(showOnboarding);
  onboardingRef.current = showOnboarding;

  const clearCountdown = () => {
    if (tickRef.current) {
      clearInterval(tickRef.current);
      tickRef.current = null;
    }
    graceActiveRef.current = false;
    setGraceActive(false);
  };

  const finalizeNow = () => {
    clearCountdown();
    const w = window as unknown as { handleRecordingStop?: (callApi: boolean) => void };
    if (typeof w.handleRecordingStop === 'function') {
      w.handleRecordingStop(true);
    }
  };

  const startCountdown = () => {
    if (tickRef.current) clearInterval(tickRef.current);
    const deadline = Date.now() + GRACE_SECONDS * 1000;
    graceActiveRef.current = true;
    setGraceActive(true);
    setSecondsLeft(GRACE_SECONDS);
    tickRef.current = setInterval(() => {
      const left = Math.max(0, Math.round((deadline - Date.now()) / 1000));
      setSecondsLeft(left);
      if (left <= 0) finalizeNow();
    }, 1000);
  };

  useEffect(() => {
    let cancelled = false;
    let cleanups: UnlistenFn[] = [];

    const startL = listen<{ gmeet_session_id: string; title?: string; resume?: boolean }>(
      'gmeet-start-recording',
      (e) => {
        const { gmeet_session_id, title, resume } = e.payload || ({} as any);
        if (onboardingRef.current) {
          toast.error('Finish setup first', { description: 'Complete onboarding before recording a Meet.' });
          return;
        }
        if (resume && graceActiveRef.current) {
          // Same Meet rejoined within the window → resume, keep the session.
          clearCountdown();
          invoke('resume_recording').catch((err) => console.warn('[gmeet] resume failed', err));
          toast.success('Resumed recording', { description: 'Continuing the same meeting.' });
          return;
        }
        // Fresh start (or resume arrived with no active grace → start clean).
        clearCountdown();
        try {
          sessionStorage.setItem('gmeet_session_id', gmeet_session_id);
          if (title) sessionStorage.setItem('gmeet_title', title);
        } catch {}
        window.dispatchEvent(new CustomEvent('start-recording-from-sidebar'));
        toast.success('Recording Google Meet', {
          description: title ? `Meetily is recording: ${title}` : 'Meetily is now recording.',
        });
      },
    );

    const pauseL = listen<{ gmeet_session_id: string }>('gmeet-pause-recording', () => {
      // Meet closed/paused → pause recording and open the grace window.
      invoke('pause_recording').catch((err) => console.warn('[gmeet] pause failed', err));
      startCountdown();
    });

    const stopL = listen('gmeet-stop-recording', () => {
      finalizeNow();
    });

    Promise.all([startL, pauseL, stopL]).then((fns) => {
      if (cancelled) fns.forEach((fn) => fn());
      else cleanups = fns;
    });

    return () => {
      cancelled = true;
      cleanups.forEach((fn) => fn());
      if (tickRef.current) clearInterval(tickRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!graceActive) return null;

  const mm = Math.floor(secondsLeft / 60);
  const ss = (secondsLeft % 60).toString().padStart(2, '0');

  return (
    <div className="fixed bottom-4 right-4 z-[9999] flex items-center gap-3 rounded-lg border border-gray-200 bg-white px-4 py-3 shadow-lg">
      <div className="flex flex-col">
        <span className="text-sm font-medium text-gray-800">Meeting ended — paused</span>
        <span className="text-xs text-gray-500">
          Finalizing in {mm}:{ss} (rejoin to resume)
        </span>
      </div>
      <button
        type="button"
        onClick={finalizeNow}
        className="rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700"
      >
        Stop &amp; summarize now
      </button>
    </div>
  );
}
