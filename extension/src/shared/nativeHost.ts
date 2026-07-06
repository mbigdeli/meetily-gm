/** Chrome Native Messaging host name (must match install manifest + registry). */
export const MEETING_CAPTURE_NATIVE_HOST = "com.meetingcapture.host";

/** Raw bytes per `session.audio` chunk — keep framed JSON under Chrome's ~1 MiB limit. */
export const NATIVE_AUDIO_CHUNK_BYTES = 360 * 1024;

export function uint8ArrayToBase64(bytes: Uint8Array): string {
  const chunkSize = 0x8000;
  let binary = "";
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

/**
 * One request/response round-trip to the Rust native host. Chrome spawns the host
 * process, delivers a single JSON message, and tears the connection down.
 */
export async function nativeHostRequest(
  timeoutMs: number,
  action: string,
  payload: Record<string, unknown>,
): Promise<{ ok: true; data: unknown } | { ok: false; error: string }> {
  const id =
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `mcs-${Date.now()}-${Math.random().toString(16).slice(2)}`;

  const port = chrome.runtime.connectNative(MEETING_CAPTURE_NATIVE_HOST);

  return await new Promise((resolve) => {
    let settled = false;

    const finish = (result: { ok: true; data: unknown } | { ok: false; error: string }) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      try {
        port.disconnect();
      } catch {
        /* ignore */
      }
      resolve(result);
    };

    const timer = setTimeout(() => {
      finish({ ok: false, error: "Native messaging timed out" });
    }, timeoutMs);

    port.onMessage.addListener((msg: unknown) => {
      const m = msg as { success?: boolean; payload?: unknown; error?: string };
      if (m.success === true) {
        finish({ ok: true, data: m.payload });
      } else {
        finish({
          ok: false,
          error: typeof m.error === "string" && m.error.length > 0 ? m.error : "native_host_rejected",
        });
      }
    });

    port.onDisconnect.addListener(() => {
      if (settled) {
        return;
      }
      const err = chrome.runtime.lastError?.message;
      finish({
        ok: false,
        error: err ?? "Native host disconnected before sending a response (is the host installed?)",
      });
    });

    try {
      port.postMessage({ id, action, payload });
    } catch (e) {
      finish({ ok: false, error: e instanceof Error ? e.message : String(e) });
    }
  });
}
