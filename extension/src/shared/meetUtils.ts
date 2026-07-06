/**
 * Google Meet URL helpers shared by meet-ui and capture content scripts.
 */
export function extractMeetingCode(href: string): string | null {
  try {
    const path = new URL(href).pathname;
    const m = path.match(/\/([a-z]{3}-[a-z]{4}-[a-z]{3})\b/i);
    return m?.[1] ?? null;
  } catch {
    return null;
  }
}
