let recordedTotalBytes = 0;
let recordedChunkCount = 0;
let statsThrottle: ReturnType<typeof setTimeout> | null = null;

export function resetRecordingStats(): void {
  recordedTotalBytes = 0;
  recordedChunkCount = 0;
}

export function recordMediaChunk(size: number): void {
  recordedTotalBytes += size;
  recordedChunkCount += 1;
  scheduleStatsForward();
}

function scheduleStatsForward(): void {
  if (statsThrottle !== null) return;
  statsThrottle = setTimeout(() => {
    statsThrottle = null;
    void chrome.runtime
      .sendMessage({
        type: "OFFSCREEN_RECORD_STATS",
        totalBytes: recordedTotalBytes,
        chunkCount: recordedChunkCount,
      })
      .catch(() => undefined);
  }, 200);
}
