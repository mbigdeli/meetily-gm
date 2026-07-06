import type { LocalServiceJsonResult } from "../shared/localServiceClient.js";

export type StatusTone = "success" | "warning" | "error" | "neutral";

export interface StatusView {
  chipLabel: string;
  tone: StatusTone;
  summary: string;
  details?: string;
  userEmail?: string;
  isConnected?: boolean;
}

function formatJsonBlock(data: unknown): string {
  try {
    return JSON.stringify(data, null, 2);
  } catch {
    return String(data);
  }
}

function pickStringField(data: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const value = data[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return null;
}

function inferBooleanState(data: Record<string, unknown>): boolean | null {
  const truthyKeys = ["ready", "connected", "authenticated", "installed", "available", "ok"];
  const falsyKeys = ["ready", "connected", "authenticated", "installed", "available"];

  for (const key of truthyKeys) {
    if (data[key] === true) {
      return true;
    }
  }

  for (const key of falsyKeys) {
    if (data[key] === false) {
      return false;
    }
  }

  return null;
}

function normalizeSummary(label: string, text: string): string {
  const clean = text.trim().replace(/\s+/g, " ");
  if (!clean) {
    return `${label} status loaded successfully.`;
  }
  if (/^[A-Z]/.test(clean)) {
    return clean.endsWith(".") ? clean : `${clean}.`;
  }
  const sentence = `${label}: ${clean}`;
  return sentence.endsWith(".") ? sentence : `${sentence}.`;
}

export function describeServiceStatus(status: string): StatusView {
  switch (status) {
    case "connected":
      return {
        chipLabel: "Connected",
        tone: "success",
        summary: "Meeting Capture desktop app is reachable and ready for extension requests.",
      };
    case "tray_starting":
      return {
        chipLabel: "Starting",
        tone: "warning",
        summary: "Meeting Capture desktop tray was not running, so the extension is starting it now.",
      };
    case "tray_stopped":
      return {
        chipLabel: "Tray stopped",
        tone: "warning",
        summary: "Native host is installed, but the Meeting Capture tray app is not currently running.",
      };
    case "unhealthy":
      return {
        chipLabel: "Warning",
        tone: "warning",
        summary: "Meeting Capture desktop app responded, but its health check did not pass cleanly.",
      };
    case "unavailable":
      return {
        chipLabel: "Offline",
        tone: "error",
        summary: "Meeting Capture desktop app could not be reached. Re-run the installer or use Test connection.",
      };
    case "timeout":
      return {
        chipLabel: "Timed out",
        tone: "warning",
        summary: "Meeting Capture desktop app did not answer in time. You may need a longer timeout.",
      };
    case "error":
      return {
        chipLabel: "Error",
        tone: "error",
        summary: "The extension hit an error while checking the Meeting Capture desktop app.",
      };
    default:
      return {
        chipLabel: "Checking",
        tone: "neutral",
        summary: "Checking Meeting Capture desktop app status.",
      };
  }
}

export function describeMicPermission(state: PermissionState | "unsupported"): StatusView {
  switch (state) {
    case "granted":
      return {
        chipLabel: "Ready",
        tone: "success",
        summary: "Microphone access has been granted for extension recordings.",
      };
    case "denied":
      return {
        chipLabel: "Blocked",
        tone: "error",
        summary: "Microphone access is blocked. Update Chrome site permissions for this extension.",
      };
    case "prompt":
      return {
        chipLabel: "Required",
        tone: "warning",
        summary: "Microphone access has not been granted yet.",
      };
    default:
      return {
        chipLabel: "Unknown",
        tone: "neutral",
        summary: "Microphone permission status could not be checked in this context.",
      };
  }
}

export function describeCodexStatus(result: LocalServiceJsonResult | null): StatusView {
  if (!result) {
    return {
      chipLabel: "Not connected",
      tone: "neutral",
      summary: "Codex has not been checked yet. Click 'Login to Codex' to authenticate.",
      isConnected: false,
    };
  }

  if (!result.ok) {
    return {
      chipLabel: "Not connected",
      tone: "error",
      summary: `Codex: ${result.error}. Click 'Login to Codex' to authenticate.`,
      isConnected: false,
    };
  }

  if (result.data && typeof result.data === "object" && !Array.isArray(result.data)) {
    let record = result.data as Record<string, unknown>;
    const nested = record["payload"];
    if (nested && typeof nested === "object" && !Array.isArray(nested)) {
      record = nested as Record<string, unknown>;
    }

    const truthy = (v: unknown) => v === true || v === "true";
    const isConnected = truthy(record.connected) || truthy(record.authenticated);
    const userEmail = typeof record.user_email === "string" ? record.user_email : undefined;
    const expiresAt =
      typeof record.expires_at === "number"
        ? record.expires_at
        : typeof record.expires_at === "string" && /^\d+$/.test(record.expires_at)
          ? Number(record.expires_at)
          : undefined;

    if (isConnected) {
      const rollover =
        expiresAt !== undefined
          ? ` Current OpenAI access credential rolls over about ${new Date(expiresAt).toLocaleString()}; the host refreshes it automatically so you usually do not need to log in again until you disconnect or OpenAI revokes the session.`
          : "";
      const userInfo = userEmail ? ` as ${userEmail}` : "";
      const version = typeof record.cli_version === "string" ? ` (${record.cli_version})` : "";
      return {
        chipLabel: "Connected",
        tone: "success",
        summary: `Codex is connected${userInfo} via the Codex CLI${version}.${rollover} Sign-in lives in the Codex CLI on this computer, not in the browser.`,
        userEmail,
        isConnected: true,
      };
    }

    if (record.cli_installed === false) {
      return {
        chipLabel: "CLI not installed",
        tone: "warning",
        summary:
          "The OpenAI Codex CLI is not installed on this computer. Install Node.js, run \"npm i -g @openai/codex\" in a terminal, then click Refresh status.",
        isConnected: false,
        details: formatJsonBlock(record),
      };
    }

    return {
      chipLabel: "Not signed in",
      tone: "warning",
      summary:
        "The Codex CLI is installed but not signed in. Click 'Login to Codex' and approve the sign-in with your ChatGPT account in the browser window that opens.",
      isConnected: false,
      details: formatJsonBlock(record),
    };
  }

  return {
    chipLabel: "Not connected",
    tone: "warning",
    summary: "Codex is not connected. Click 'Login to Codex' to authenticate.",
    isConnected: false,
  };
}

export function describeRemoteStatus(label: string, result: LocalServiceJsonResult | null): StatusView {
  if (!result) {
    return {
      chipLabel: "Unknown",
      tone: "neutral",
      summary: `${label} status has not been checked yet.`,
      details: "No diagnostics yet.",
    };
  }

  const details = formatJsonBlock(result.data);

  if (!result.ok) {
    return {
      chipLabel: "Needs attention",
      tone: "error",
      summary: `${label}: ${result.error}${result.httpStatus !== undefined ? ` (HTTP ${result.httpStatus})` : ""}.`,
      details,
    };
  }

  if (result.data && typeof result.data === "object" && !Array.isArray(result.data)) {
    const record = result.data as Record<string, unknown>;
    const statusText = pickStringField(record, ["summary", "status", "state", "message", "detail"]);
    if (statusText) {
      const normalized = normalizeSummary(label, statusText);
      const booleanState = inferBooleanState(record);
      return {
        chipLabel: booleanState === false ? "Warning" : "Checked",
        tone: booleanState === false ? "warning" : "success",
        summary: normalized,
        details,
      };
    }

    const booleanState = inferBooleanState(record);
    if (booleanState === true) {
      return {
        chipLabel: "Ready",
        tone: "success",
        summary: `${label} looks ready based on the latest local service response.`,
        details,
      };
    }

    if (booleanState === false) {
      return {
        chipLabel: "Warning",
        tone: "warning",
        summary: `${label} responded, but it still needs attention before it is fully ready.`,
        details,
      };
    }
  }

  return {
    chipLabel: "Checked",
    tone: "success",
    summary: `${label} status loaded successfully.`,
    details,
  };
}
