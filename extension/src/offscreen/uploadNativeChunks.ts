import { NATIVE_AUDIO_CHUNK_BYTES, uint8ArrayToBase64 } from "../shared/nativeHost.js";

export interface SegmentUploadMeta {
  segmentStartedAt: string;
  segmentEndedAt: string;
  sessionStartOffsetSec: number;
  durationSec: number;
  overlapPrevSec: number;
  overlapNextSec: number;
}

export async function uploadAudioViaNativeChunks(
  sessionId: string,
  blob: Blob,
  segmentIndex: number | null,
  meta?: SegmentUploadMeta,
): Promise<{ ok: boolean; error?: string }> {
  const contentType = blob.type && blob.type.length > 0 ? blob.type : "audio/webm";
  const buf = await blob.arrayBuffer();
  const u8 = new Uint8Array(buf);
  if (u8.length === 0) {
    return { ok: true };
  }

  let offset = 0;
  let chunkIndex = 0;
  while (offset < u8.length) {
    const end = Math.min(offset + NATIVE_AUDIO_CHUNK_BYTES, u8.length);
    const slice = u8.subarray(offset, end);
    const dataBase64 = uint8ArrayToBase64(slice);
    const isLast = end >= u8.length;
    const reply = (await chrome.runtime.sendMessage({
      type: "OFFSCREEN_NATIVE_AUDIO_CHUNK",
      sessionId,
      segmentIndex,
      contentType,
      chunkIndex,
      isLast,
      dataBase64,
      segmentStartedAt: meta?.segmentStartedAt,
      segmentEndedAt: meta?.segmentEndedAt,
      sessionStartOffsetSec: meta?.sessionStartOffsetSec,
      durationSec: meta?.durationSec,
      overlapPrevSec: meta?.overlapPrevSec,
      overlapNextSec: meta?.overlapNextSec,
    })) as { ok?: boolean; error?: string } | null;
    if (!reply?.ok) {
      const err = reply?.error ?? "native_chunk_failed";
      console.error(`[MCS:offscreen] native audio chunk ${chunkIndex} failed: ${err}`);
      return { ok: false, error: err };
    }
    offset = end;
    chunkIndex += 1;
  }
  console.info(`[MCS:offscreen] audio uploaded via native host ✓ (${blob.size} bytes, segment=${segmentIndex ?? "final"})`);
  return { ok: true };
}
