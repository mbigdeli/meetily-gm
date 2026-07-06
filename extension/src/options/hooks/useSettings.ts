import { useState, useEffect, useCallback, useRef } from "react";
import type { MeetingCaptureSettings, LiveCaptionLanguage } from "../../shared/types.js";
import type { SettingsAndSessionResponse } from "../../shared/messages.js";
import type { LocalServiceJsonResult } from "../../shared/localServiceClient.js";
import { meetingCaptureSettingsSchema } from "../../shared/schemas.js";
import { validateSettingsForSave } from "../settingsValidation.js";
import {
  describeCodexStatus,
  describeMicPermission,
  describeRemoteStatus,
  describeServiceStatus,
  type StatusView,
} from "../statusPresentation.js";
import { useBusyState } from "./useBusyState.js";
import { sendChromeMessage } from "./useChromeMessage.js";

type SettingsResponse = { ok: true } & SettingsAndSessionResponse;
type ServiceHealthResponse = { ok: true; session: SettingsAndSessionResponse["session"] };
type ActionResponse =
  | { ok: true; result: LocalServiceJsonResult }
  | { ok: false; error?: string };

export type BannerState = {
  severity: "error" | "success" | "info" | "warning";
  message: string;
  listItems?: string[];
} | null;

export type StatusStates = {
  mic: StatusView;
  service: StatusView;
  engine: StatusView;
  codex: StatusView;
};

const NEUTRAL_STATUS: StatusView = {
  chipLabel: "Checking",
  tone: "neutral",
  summary: "Checking status.",
};

export function useSettings() {
  const [settings, setSettings] = useState<MeetingCaptureSettings | null>(null);
  const [captionLang, setCaptionLang] = useState<LiveCaptionLanguage>("en");
  const [banner, setBanner] = useState<BannerState>(null);
  const { busyButtons, isBusy, runBusy } = useBusyState();
  const [statuses, setStatuses] = useState<StatusStates>({
    mic: NEUTRAL_STATUS,
    service: NEUTRAL_STATUS,
    engine: NEUTRAL_STATUS,
    codex: NEUTRAL_STATUS,
  });

  const settingsRef = useRef(settings);
  settingsRef.current = settings;

  const setStatus = useCallback((key: keyof StatusStates, view: StatusView) => {
    setStatuses((prev) => ({ ...prev, [key]: view }));
  }, []);

  const refreshServiceHealth = useCallback(async (ensureTray = false) => {
    try {
      const res = await sendChromeMessage<ServiceHealthResponse>({
        type: "REQUEST_SERVICE_HEALTH",
        payload: ensureTray ? { ensureTray: true } : {},
      });
      if (!res.ok) {
        setStatus("service", {
          chipLabel: "Error",
          tone: "error",
          summary: "Meeting Capture desktop app status could not be refreshed.",
        });
        return;
      }
      setStatus("service", describeServiceStatus(res.session.localServiceStatus));
    } catch {
      setStatus("service", {
        chipLabel: "Error",
        tone: "error",
        summary: "The extension hit an error while checking the Meeting Capture desktop app.",
      });
    }
  }, [setStatus]);

  const refreshEngineStatus = useCallback(async () => {
    try {
      const res = await sendChromeMessage<ActionResponse>({
        type: "REQUEST_ENGINE_STATUS",
        payload: {},
      });
      if (!res.ok || !("result" in res)) {
        setStatus("engine", {
          chipLabel: "Error",
          tone: "error",
          summary: "Engine request failed.",
        });
        return;
      }
      setStatus("engine", describeRemoteStatus("Engine", res.result));
    } catch (e) {
      setStatus("engine", {
        chipLabel: "Error",
        tone: "error",
        summary: `Engine: ${e instanceof Error ? e.message : "error"}.`,
      });
    }
  }, [setStatus]);

  const refreshCodexStatus = useCallback(async () => {
    try {
      const res = await sendChromeMessage<ActionResponse>({
        type: "REQUEST_CODEX_STATUS",
        payload: {},
      });
      if (!res.ok || !("result" in res)) {
        setStatus("codex", {
          chipLabel: "Error",
          tone: "error",
          summary: "Codex request failed.",
        });
        return;
      }
      setStatus("codex", describeCodexStatus(res.result));
    } catch (e) {
      setStatus("codex", {
        chipLabel: "Error",
        tone: "error",
        summary: `Codex: ${e instanceof Error ? e.message : "error"}.`,
      });
    }
  }, [setStatus]);

  const refreshMicStatus = useCallback(async () => {
    try {
      const result = await navigator.permissions.query({
        name: "microphone" as PermissionName,
      });
      if (result.state === "granted") {
        setStatus("mic", describeMicPermission("granted"));
        await chrome.storage.local.set({ mcs_mic_permission_granted: true });
      } else if (result.state === "denied") {
        setStatus("mic", describeMicPermission("denied"));
        await chrome.storage.local.set({ mcs_mic_permission_granted: false });
      } else {
        setStatus("mic", describeMicPermission("prompt"));
        await chrome.storage.local.set({ mcs_mic_permission_granted: false });
      }
    } catch {
      setStatus("mic", describeMicPermission("unsupported"));
      await chrome.storage.local.set({ mcs_mic_permission_granted: false });
    }
  }, [setStatus]);

  const loadInitial = useCallback(async () => {
    setBanner(null);
    try {
      const data = await sendChromeMessage<SettingsResponse>({
        type: "REQUEST_SETTINGS",
        payload: {},
      });
      if (!data.ok) {
        setBanner({
          severity: "error",
          message: "Could not load settings from the extension.",
        });
        return;
      }
      setSettings(data.settings);
      setCaptionLang(data.lastCaptionLanguage ?? "en");
      setStatus("service", describeServiceStatus(data.session.localServiceStatus));
      await refreshEngineStatus();
      await refreshCodexStatus();
      await refreshMicStatus();
    } catch (e) {
      setBanner({
        severity: "error",
        message: e instanceof Error ? e.message : "Failed to load.",
      });
    }
  }, [setStatus, refreshEngineStatus, refreshCodexStatus, refreshMicStatus]);

  useEffect(() => {
    void loadInitial();
  }, [loadInitial]);

  const saveSettings = useCallback(async () => {
    const current = settingsRef.current;
    if (!current) return;

    setBanner(null);
    let draft: MeetingCaptureSettings;
    try {
      draft = meetingCaptureSettingsSchema.parse(current);
    } catch (e) {
      setBanner({
        severity: "error",
        message: e instanceof Error ? e.message : "Invalid field values.",
      });
      return;
    }

    const checked = validateSettingsForSave(draft);
    if (!checked.ok) {
      setBanner({
        severity: "error",
        message: "Fix the following before saving:",
        listItems: checked.errors,
      });
      return;
    }

    try {
      await sendChromeMessage({
        type: "SETTINGS_UPDATED",
        payload: checked.settings,
      });
      setBanner({ severity: "success", message: "Settings saved." });
      await refreshServiceHealth();
    } catch (e) {
      setBanner({
        severity: "error",
        message: e instanceof Error ? e.message : "Save failed.",
      });
    }
  }, [refreshServiceHealth]);

  const grantMic = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      for (const t of stream.getTracks()) t.stop();
      setStatus("mic", describeMicPermission("granted"));
      await chrome.storage.local.set({ mcs_mic_permission_granted: true });
      setBanner({
        severity: "success",
        message:
          "Microphone access granted. You can close this page and start recording.",
      });
    } catch (e) {
      const reason = e instanceof Error ? e.name : "blocked";
      setStatus("mic", {
        chipLabel: "Blocked",
        tone: "error",
        summary: `Microphone permission was not granted (${reason}). Check Chrome and OS settings.`,
      });
      await chrome.storage.local.set({ mcs_mic_permission_granted: false });
      setBanner({
        severity: "error",
        message: `Microphone permission was not granted (${reason}).`,
      });
    }
  }, [setStatus]);

  const testService = useCallback(async () => {
    setBanner(null);
    try {
      await sendChromeMessage<ServiceHealthResponse>({
        type: "REQUEST_SERVICE_HEALTH",
        payload: { ensureTray: true },
      });
      setBanner({
        severity: "info",
        message: "Connection test finished. See the desktop app summary below.",
      });
      await refreshServiceHealth(true);
    } catch (e) {
      setBanner({
        severity: "error",
        message: e instanceof Error ? e.message : "Test failed.",
      });
    }
  }, [refreshServiceHealth]);

  const installEngine = useCallback(async () => {
    setBanner(null);
    try {
      const res = await sendChromeMessage<ActionResponse>({
        type: "ENGINE_INSTALL",
        payload: {},
      });
      if (res.ok && "result" in res) {
        const r = res.result;
        setBanner({
          severity: r.ok ? "info" : "error",
          message: r.ok
            ? `Install accepted (HTTP ${r.httpStatus}).`
            : `Install: ${r.error}`,
        });
      }
      await refreshEngineStatus();
    } catch (e) {
      setBanner({
        severity: "error",
        message: e instanceof Error ? e.message : "Install request failed.",
      });
    }
  }, [refreshEngineStatus]);

  const downloadModel = useCallback(async () => {
    const current = settingsRef.current;
    if (!current) return;

    setBanner(null);
    let draft: MeetingCaptureSettings;
    try {
      draft = meetingCaptureSettingsSchema.parse(current);
    } catch {
      setBanner({
        severity: "error",
        message: "Fix form values before downloading a model.",
      });
      return;
    }

    const modelName = draft.whisperPreferredModel.trim();
    if (!modelName) {
      setBanner({ severity: "error", message: "Choose a preferred model first." });
      return;
    }

    try {
      const res = await sendChromeMessage<ActionResponse>({
        type: "ENGINE_MODEL_DOWNLOAD",
        payload: { modelName },
      });
      if (res.ok && "result" in res) {
        const r = res.result;
        setBanner({
          severity: r.ok ? "info" : "error",
          message: r.ok
            ? `Download request returned HTTP ${r.httpStatus}.`
            : `Download: ${r.error}`,
        });
      }
      await refreshEngineStatus();
    } catch (e) {
      setBanner({
        severity: "error",
        message: e instanceof Error ? e.message : "Download request failed.",
      });
    }
  }, [refreshEngineStatus]);

  const loginCodex = useCallback(async () => {
    setBanner(null);
    try {
      const res = await sendChromeMessage<{ ok: boolean; error?: string; polling?: boolean }>({
        type: "CODEX_LOGIN",
        payload: {},
      });

      if (!res.ok) {
        if (res.error === "codex_cli_not_installed") {
          setBanner({
            severity: "error",
            message:
              'The OpenAI Codex CLI is not installed. Install Node.js, run "npm i -g @openai/codex" in a terminal, then try again.',
          });
        } else if (res.error === "login_start_failed") {
          setBanner({ severity: "error", message: "Desktop app could not start login. Is it running?" });
        } else {
          setBanner({ severity: "error", message: `Login failed: ${res.error}` });
        }
        return;
      }

      setBanner({
        severity: "info",
        message: "Complete sign-in in the browser window Codex just opened, then come back here...",
      });

      const maxPolls = 150;
      for (let i = 0; i < maxPolls; i++) {
        await new Promise((r) => setTimeout(r, 2000));
        const statusRes = await sendChromeMessage<ActionResponse>({
          type: "REQUEST_CODEX_STATUS",
          payload: {},
        });
        if (statusRes.ok && "result" in statusRes && statusRes.result.ok) {
          const data = statusRes.result.data as Record<string, unknown> | undefined;
          // Match `describeCodexStatus`: host may set `authenticated` while access token is in refresh window.
          const codexReady =
            data?.connected === true || data?.authenticated === true;
          if (codexReady) {
            const email = typeof data.user_email === "string" ? data.user_email : null;
            setBanner({
              severity: "success",
              message: email
                ? `Successfully connected to Codex as ${email}!`
                : "Successfully connected to Codex!",
            });
            await refreshCodexStatus();
            return;
          }
        }
      }

      setBanner({ severity: "warning", message: "Login timed out. Try again." });
    } catch (e) {
      setBanner({
        severity: "error",
        message: e instanceof Error ? e.message : "Codex login failed.",
      });
    }
  }, [refreshCodexStatus]);

  const logoutCodex = useCallback(async () => {
    setBanner(null);
    try {
      await sendChromeMessage({ type: "CODEX_DISCONNECT", payload: {} });
      setBanner({ severity: "info", message: "Disconnected from Codex." });
      await refreshCodexStatus();
    } catch (e) {
      setBanner({
        severity: "error",
        message: e instanceof Error ? e.message : "Codex disconnect failed.",
      });
    }
  }, [refreshCodexStatus]);

  const applyCaptionLanguage = useCallback(
    async (language: LiveCaptionLanguage) => {
      setBanner(null);
      try {
        const res = await sendChromeMessage<{ ok: boolean; error?: string }>({
          type: "CAPTION_LANGUAGE_CHANGED",
          payload: { language },
        });
        if (!res.ok) {
          setBanner({
            severity: "error",
            message: res.error ?? "Could not save language.",
          });
          return;
        }
        setBanner({
          severity: "success",
          message: "Remembered live caption language updated.",
        });
      } catch (e) {
        setBanner({
          severity: "error",
          message: e instanceof Error ? e.message : "Failed to save language.",
        });
      }
    },
    [],
  );

  const browseFolder = useCallback(
    async (field: "rawStorageRoot" | "finalOutputRoot") => {
      try {
        const dirHandle = await (window as unknown as { showDirectoryPicker: (opts: { mode: string }) => Promise<{ name: string }> }).showDirectoryPicker({ mode: "read" });
        const folderName = dirHandle.name;

        setSettings((prev) => {
          if (!prev) return prev;
          const current = prev[field].trim();
          if (current) return prev;
          return { ...prev, [field]: folderName };
        });

        setBanner({
          severity: "info",
          message:
            `Folder "${folderName}" selected. ` +
            `Browsers cannot read the full path for security reasons — ` +
            `please type the complete Windows path in the field ` +
            `(e.g. C:\\MeetingCapture\\${folderName}).`,
        });
      } catch (err) {
        if (err instanceof Error && err.name === "AbortError") return;
        setBanner({
          severity: "error",
          message: "Could not open the folder picker. Please type the path manually.",
        });
      }
    },
    [],
  );

  const updateField = useCallback(
    <K extends keyof MeetingCaptureSettings>(
      key: K,
      value: MeetingCaptureSettings[K],
    ) => {
      setSettings((prev) => (prev ? { ...prev, [key]: value } : prev));
    },
    [],
  );

  return {
    settings,
    setSettings,
    captionLang,
    setCaptionLang,
    banner,
    setBanner,
    statuses,
    busyButtons,
    isBusy,
    runBusy,
    updateField,
    saveSettings,
    grantMic,
    testService,
    installEngine,
    downloadModel,
    loginCodex,
    logoutCodex,
    applyCaptionLanguage,
    browseFolder,
    refreshEngineStatus,
    refreshCodexStatus,
  };
}
