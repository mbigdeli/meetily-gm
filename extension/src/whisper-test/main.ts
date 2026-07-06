import { LocalServiceClient } from "../shared/localServiceClient.js";
import { getSettings } from "../shared/storage.js";
import { buildWhisperTestSessionStart, WHISPER_TEST_REFERENCES } from "./testSession.js";
import "./style.css";

interface JobStatus {
  stage: string;
  state: string;
  started_at?: string | null;
  completed_at?: string | null;
  error_message?: string | null;
}

interface JobEvent {
  event_type: string;
  payload: unknown;
  created_at: string;
}

interface OutputFiles {
  raw?: string[];
  processed?: string[];
  final?: string[];
}

interface SessionStatusData {
  session_id?: string;
  current_stage?: string;
  overall_state?: string;
  last_error?: string | null;
  filesystem_session_path?: string;
  jobs?: JobStatus[];
  job_events?: JobEvent[];
  output_files?: OutputFiles;
}

interface ActiveSession {
  sessionId: string;
  startedAtIso: string;
  filesystemSessionPath: string | null;
}

const serviceClient = new LocalServiceClient(getSettings);

let activeSession: ActiveSession | null = null;
let mediaRecorder: MediaRecorder | null = null;
let mediaStream: MediaStream | null = null;
let recordedChunks: Blob[] = [];
let pollTimer: ReturnType<typeof setInterval> | null = null;
let busy = false;
let pipelineTerminal = false;
let codexConnected = false;

function el<T extends HTMLElement>(id: string): T {
  const found = document.getElementById(id);
  if (!found) {
    throw new Error(`missing element: ${id}`);
  }
  return found as T;
}

const ui = {
  status: el<HTMLDivElement>("status"),
  service: el<HTMLDivElement>("service-status"),
  settings: el<HTMLDivElement>("settings-summary"),
  session: el<HTMLDivElement>("session-summary"),
  jobs: el<HTMLDivElement>("job-list"),
  events: el<HTMLDivElement>("event-list"),
  codexStatus: el<HTMLDivElement>("codex-status"),
  codexResult: el<HTMLDivElement>("codex-result"),
  files: el<HTMLDivElement>("file-list"),
  log: el<HTMLPreElement>("log"),
  title: el<HTMLInputElement>("meeting-title"),
  skipCodex: el<HTMLInputElement>("skip-codex"),
  checkService: el<HTMLButtonElement>("check-service"),
  requestMic: el<HTMLButtonElement>("request-mic"),
  start: el<HTMLButtonElement>("start-recording"),
  stop: el<HTMLButtonElement>("stop-recording"),
  refreshStatus: el<HTMLButtonElement>("refresh-status"),
  runCodexMerge: el<HTMLButtonElement>("run-codex-merge"),
  refreshCodex: el<HTMLButtonElement>("refresh-codex"),
  openOptions: el<HTMLButtonElement>("open-options"),
  references: el<HTMLDivElement>("references"),
};

function setBusy(next: boolean): void {
  busy = next;
  ui.checkService.disabled = next;
  ui.requestMic.disabled = next;
  ui.start.disabled = next || mediaRecorder !== null;
  ui.stop.disabled = next || mediaRecorder === null;
  ui.refreshStatus.disabled = next || activeSession === null;
  ui.refreshCodex.disabled = next;
  ui.runCodexMerge.disabled = next || activeSession === null || !pipelineTerminal || !codexConnected;
}

function setStatus(text: string, tone: "idle" | "ok" | "warn" | "error" = "idle"): void {
  ui.status.textContent = text;
  ui.status.dataset.tone = tone;
}

function appendLog(line: string): void {
  const stamp = new Date().toLocaleTimeString();
  ui.log.textContent = `${ui.log.textContent}${stamp}  ${line}\n`;
  ui.log.scrollTop = ui.log.scrollHeight;
}

function getRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? value as Record<string, unknown> : {};
}

function pickAudioMimeType(): string | undefined {
  for (const candidate of ["audio/webm;codecs=opus", "audio/webm"]) {
    if (typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(candidate)) {
      return candidate;
    }
  }
  return undefined;
}

function makeSessionId(): string {
  const stamp = new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14);
  const suffix =
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID().slice(0, 8)
      : Math.random().toString(16).slice(2, 10);
  return `whisper-test-${stamp}-${suffix}`;
}

function stopMediaStream(): void {
  if (mediaStream) {
    for (const track of mediaStream.getTracks()) {
      track.stop();
    }
    mediaStream = null;
  }
}

function stopPolling(): void {
  if (pollTimer !== null) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}

async function refreshSettingsSummary(): Promise<void> {
  const settings = await getSettings();
  ui.settings.innerHTML = "";
  for (const [label, value] of [
    ["Raw root", settings.rawStorageRoot],
    ["Final root", settings.finalOutputRoot],
    ["Whisper model", settings.whisperPreferredModel],
  ]) {
    const row = document.createElement("div");
    row.className = "kv-row";
    row.innerHTML = `<span>${label}</span><code></code>`;
    const code = row.querySelector("code");
    if (code) {
      code.textContent = String(value);
    }
    ui.settings.appendChild(row);
  }
}

function renderReferences(): void {
  ui.references.innerHTML = "";
  for (const ref of WHISPER_TEST_REFERENCES) {
    const item = document.createElement("article");
    item.className = "reference-card";
    const path = document.createElement("code");
    path.textContent = ref.path;
    const funcs = document.createElement("p");
    funcs.textContent = ref.symbols.join(", ");
    const note = document.createElement("small");
    note.textContent = ref.note;
    item.append(path, funcs, note);
    ui.references.appendChild(item);
  }
}

/// Every artifact the pipeline can produce, in pipeline order.
const KNOWN_ARTIFACTS: Array<{ dir: keyof OutputFiles; name: string; note: string }> = [
  { dir: "raw", name: "session_meta.json", note: "session settings incl. codex_merge_enabled" },
  { dir: "raw", name: "audio_raw.webm", note: "recorded audio as uploaded" },
  { dir: "raw", name: "audio_meta.json", note: "upload chunk bookkeeping" },
  { dir: "processed", name: "audio.wav", note: "FFmpeg 16 kHz mono for Whisper" },
  { dir: "processed", name: "transcript.json", note: "Whisper output with word timings" },
  { dir: "processed", name: "diarization.json", note: "caption-overlap speaker timing" },
  { dir: "processed", name: "normalized_meeting_package.json", note: "merged evidence sent to Codex" },
  { dir: "processed", name: "codex_request.json", note: "exact prompt given to codex exec" },
  { dir: "processed", name: "codex_response.json", note: "codex exit code, duration, stderr tail" },
  { dir: "processed", name: "codex_merge_result.json", note: "final merged segments + summary" },
  { dir: "final", name: "final_transcript.json", note: "published transcript" },
  { dir: "final", name: "final_transcript.md", note: "human-readable transcript" },
];

function renderArtifactChecklist(files: OutputFiles | undefined): void {
  const observed = new Set<string>();
  for (const dir of ["raw", "processed", "final"] as const) {
    for (const name of files?.[dir] ?? []) {
      observed.add(`${dir}/${name}`);
    }
  }

  ui.files.innerHTML = "";
  const known = new Set<string>();
  for (const artifact of KNOWN_ARTIFACTS) {
    const rel = `${artifact.dir}/${artifact.name}`;
    known.add(rel);
    const row = document.createElement("div");
    row.className = "artifact-row";
    const exists = observed.has(rel);
    row.dataset.exists = String(exists);
    const mark = document.createElement("span");
    mark.textContent = exists ? "✓" : "–";
    const code = document.createElement("code");
    code.textContent = rel;
    code.title = artifact.note;
    row.append(mark, code);
    ui.files.appendChild(row);
  }
  for (const rel of [...observed].sort()) {
    if (known.has(rel)) continue;
    const row = document.createElement("div");
    row.className = "artifact-row";
    row.dataset.exists = "true";
    const mark = document.createElement("span");
    mark.textContent = "✓";
    const code = document.createElement("code");
    code.textContent = rel;
    code.title = "additional artifact";
    row.append(mark, code);
    ui.files.appendChild(row);
  }
}

function formatDuration(job: JobStatus): string {
  if (!job.started_at || !job.completed_at) return "";
  const ms = Date.parse(job.completed_at) - Date.parse(job.started_at);
  if (!Number.isFinite(ms) || ms < 0) return "";
  return ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`;
}

/// Skip/error context per stage, derived from pipeline events.
function stageAnnotations(events: JobEvent[] | undefined): Map<string, string> {
  const notes = new Map<string, string>();
  for (const event of events ?? []) {
    const p = getRecord(event.payload);
    if (event.event_type === "codex_merge_skipped") {
      const reason = typeof p.reason === "string" ? p.reason : "skipped";
      notes.set("codex_merge_complete", `skipped — ${reason}`);
    } else if (event.event_type === "codex_merge_error") {
      notes.set("codex_merge_complete", `error — ${typeof p.error === "string" ? p.error : "unknown"}`);
    } else if (event.event_type === "pipeline_error") {
      const stage = typeof p.stage === "string" ? p.stage : "";
      if (stage) notes.set(stage, `error — ${typeof p.error === "string" ? p.error : "unknown"}`);
    } else if (event.event_type === "output_written") {
      const source = typeof p.source === "string" ? p.source : "";
      if (source) notes.set("output_written", `source: ${source}`);
    }
  }
  return notes;
}

function renderJobs(jobs: JobStatus[] | undefined, events: JobEvent[] | undefined): void {
  ui.jobs.innerHTML = "";
  if (!jobs || jobs.length === 0) {
    ui.jobs.textContent = "No jobs yet. Stop recording to start the pipeline.";
    return;
  }
  const notes = stageAnnotations(events);
  for (const job of jobs) {
    const row = document.createElement("div");
    row.className = "job-row";
    const note = notes.get(job.stage);
    const displayState =
      job.state === "pending" && note?.startsWith("skipped") ? "skipped" : job.state;
    row.dataset.state = displayState;
    const stage = document.createElement("span");
    stage.textContent = job.stage;
    const state = document.createElement("strong");
    const duration = formatDuration(job);
    state.textContent = duration ? `${displayState} (${duration})` : displayState;
    row.append(stage, state);
    const detail = job.error_message ?? note;
    if (detail) {
      const extra = document.createElement("small");
      extra.textContent = detail;
      row.appendChild(extra);
    }
    ui.jobs.appendChild(row);
  }
}

function renderEvents(events: JobEvent[] | undefined): void {
  ui.events.innerHTML = "";
  if (!events || events.length === 0) {
    ui.events.textContent = "No events yet.";
    return;
  }
  for (const event of events) {
    const row = document.createElement("div");
    row.className = "event-row";
    if (event.event_type.endsWith("_error") || event.event_type === "pipeline_error") {
      row.dataset.tone = "error";
    } else if (event.event_type.endsWith("_skipped")) {
      row.dataset.tone = "warn";
    }
    const time = document.createElement("code");
    time.textContent = event.created_at.slice(11, 19);
    const type = document.createElement("strong");
    type.textContent = event.event_type;
    row.append(time, type);
    const payload = getRecord(event.payload);
    const keys = Object.keys(payload);
    if (keys.length > 0) {
      const detail = document.createElement("small");
      const compact = JSON.stringify(payload);
      detail.textContent = compact.length > 220 ? `${compact.slice(0, 220)}…` : compact;
      row.appendChild(detail);
    }
    ui.events.appendChild(row);
  }
  ui.events.scrollTop = ui.events.scrollHeight;
}

function renderSessionStatus(data: SessionStatusData): void {
  const path = data.filesystem_session_path ?? activeSession?.filesystemSessionPath ?? "(pending)";
  ui.session.innerHTML = "";
  for (const [label, value] of [
    ["Session", data.session_id ?? activeSession?.sessionId ?? "(none)"],
    ["State", data.overall_state ?? "(unknown)"],
    ["Stage", data.current_stage ?? "(unknown)"],
    ["Path", path],
  ]) {
    const row = document.createElement("div");
    row.className = "kv-row";
    row.innerHTML = `<span>${label}</span><code></code>`;
    const code = row.querySelector("code");
    if (code) {
      code.textContent = value;
    }
    ui.session.appendChild(row);
  }
  renderJobs(data.jobs, data.job_events);
  renderEvents(data.job_events);
  renderArtifactChecklist(data.output_files);
}

function isPipelineTerminal(data: SessionStatusData): boolean {
  const outputJob = data.jobs?.find((job) => job.stage === "output_written");
  return outputJob?.state === "complete" || outputJob?.state === "failed";
}

function updateWhisperSignal(data: SessionStatusData): void {
  const transcription = data.jobs?.find((job) => job.stage === "transcription_complete");
  if (transcription?.state === "running") {
    setStatus("Whisper is running on the recorded voice.", "warn");
  } else if (transcription?.state === "complete") {
    setStatus("Whisper completed. Check processed/transcript.json.", "ok");
  } else if (transcription?.state === "failed") {
    setStatus(`Whisper failed: ${transcription.error_message ?? "unknown error"}`, "error");
  }
}

function updateCodexSignal(data: SessionStatusData): void {
  const merge = data.jobs?.find((job) => job.stage === "codex_merge_complete");
  const hasResult = data.output_files?.processed?.includes("codex_merge_result.json") ?? false;
  if (merge?.state === "running") {
    ui.codexResult.textContent = "Codex is merging the transcript (typically 1–3 minutes)...";
  } else if (merge?.state === "complete") {
    ui.codexResult.textContent =
      "Merge complete ✓ — open processed/codex_merge_result.json for segments + summary, final/ for published files.";
  } else if (merge?.state === "failed") {
    ui.codexResult.textContent = `Merge failed: ${merge.error_message ?? "unknown"} — see processed/codex_response.json (stderr tail).`;
  } else if (merge?.state === "pending" && hasResult) {
    ui.codexResult.textContent = "A previous merge result exists in processed/codex_merge_result.json.";
  }
}

export async function pollSessionStatus(): Promise<void> {
  if (!activeSession) {
    return;
  }
  const result = await serviceClient.getSessionStatus(activeSession.sessionId);
  if (!result.ok) {
    appendLog(`session.status failed: ${result.error}`);
    setStatus("Could not read session status.", "error");
    return;
  }
  const data = getRecord(result.data) as SessionStatusData;
  renderSessionStatus(data);
  updateWhisperSignal(data);
  updateCodexSignal(data);
  pipelineTerminal = isPipelineTerminal(data);
  if (pipelineTerminal) {
    stopPolling();
    appendLog("Pipeline finished (output_written is terminal).");
    setBusy(false);
  }
}

function startPolling(): void {
  stopPolling();
  void pollSessionStatus();
  pollTimer = setInterval(() => {
    void pollSessionStatus();
  }, 3000);
}

async function refreshCodexStatus(): Promise<void> {
  const result = await serviceClient.getCodexStatus();
  if (!result.ok) {
    codexConnected = false;
    ui.codexStatus.textContent = `codex.status failed: ${result.error}`;
    setBusy(busy);
    return;
  }
  const data = getRecord(result.data);
  const connected = data.connected === true;
  const installed = data.cli_installed === true;
  const version = typeof data.cli_version === "string" ? data.cli_version : "";
  const email = typeof data.user_email === "string" ? data.user_email : "";
  codexConnected = connected;
  if (connected) {
    ui.codexStatus.textContent = `Connected${email ? ` as ${email}` : ""}${version ? ` — ${version}` : ""}. Merge runs on your ChatGPT subscription via the local Codex CLI.`;
  } else if (installed) {
    ui.codexStatus.textContent =
      "Codex CLI installed but not signed in. Use 'Login to Codex' in Options, then Refresh.";
  } else {
    ui.codexStatus.textContent =
      typeof data.detail === "string"
        ? data.detail
        : "Codex CLI not installed. Run: npm i -g @openai/codex";
  }
  setBusy(busy);
}

async function runCodexMergeOnSession(): Promise<void> {
  if (!activeSession || !pipelineTerminal) {
    return;
  }
  setBusy(true);
  try {
    appendLog("Reprocessing from codex_merge_complete with codex_merge_enabled=true...");
    ui.codexResult.textContent = "Starting Codex merge...";
    const result = await serviceClient.postSessionReprocess(
      activeSession.sessionId,
      "codex_merge_complete",
      true,
    );
    if (!result.ok) {
      throw new Error(result.error);
    }
    setStatus("Codex merge re-run started. Watching pipeline...", "warn");
    pipelineTerminal = false;
    startPolling();
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    appendLog(`session.reprocess failed: ${message}`);
    ui.codexResult.textContent = `Could not start merge: ${message}`;
    setStatus("Codex merge could not start.", "error");
  } finally {
    setBusy(false);
  }
}

async function stopRecorderToBlob(): Promise<Blob> {
  const recorder = mediaRecorder;
  if (!recorder) {
    return new Blob([], { type: "audio/webm" });
  }
  const mimeType = recorder.mimeType || "audio/webm";
  return await new Promise<Blob>((resolve, reject) => {
    recorder.addEventListener(
      "stop",
      () => {
        resolve(new Blob(recordedChunks, { type: mimeType }));
        recordedChunks = [];
      },
      { once: true },
    );
    recorder.addEventListener(
      "error",
      () => reject(new Error("MediaRecorder failed while stopping")),
      { once: true },
    );
    try {
      recorder.requestData();
      recorder.stop();
    } catch (e) {
      reject(e instanceof Error ? e : new Error(String(e)));
    }
  });
}

export async function startVoiceTest(): Promise<void> {
  if (busy || mediaRecorder !== null) {
    return;
  }
  setBusy(true);
  try {
    const settings = await getSettings();
    if (!settings.rawStorageRoot.trim() || !settings.finalOutputRoot.trim()) {
      throw new Error("Configure raw and final folders in Options first.");
    }

    appendLog("Checking native service and starting tray if needed...");
    const health = await serviceClient.checkHealth({ ensureTray: true });
    ui.service.textContent = `${health.status}${health.detail ? ` - ${health.detail}` : ""}`;
    if (health.status === "unavailable" || health.status === "timeout" || health.status === "error") {
      throw new Error(`Native service is not ready: ${health.detail ?? health.status}`);
    }

    appendLog("Requesting microphone stream...");
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      video: false,
    });
    mediaStream = stream;

    const sessionId = makeSessionId();
    const startedAtIso = new Date().toISOString();
    const manifest = chrome.runtime.getManifest();
    const startBody = buildWhisperTestSessionStart({
      settings,
      sessionId,
      startedAtIso,
      extensionVersion: manifest.version ?? null,
      meetingTitle: ui.title.value,
      codexMergeEnabled: !ui.skipCodex.checked,
    });

    appendLog(`Starting session ${sessionId}...`);
    appendLog(
      ui.skipCodex.checked
        ? "Codex merge DISABLED for this run (checkbox). The codex stage will show 'skipped'; run it later with the button below."
        : "Codex merge ENABLED for this run — the pipeline will call the Codex CLI after Whisper.",
    );
    const startResult = await serviceClient.postSessionStart(startBody);
    if (!startResult.ok) {
      stopMediaStream();
      throw new Error(startResult.error);
    }

    const startData = getRecord(startResult.data);
    activeSession = {
      sessionId: typeof startData.session_id === "string" ? startData.session_id : sessionId,
      startedAtIso,
      filesystemSessionPath: typeof startData.filesystem_session_path === "string" ? startData.filesystem_session_path : null,
    };
    pipelineTerminal = false;

    const mimeType = pickAudioMimeType();
    mediaRecorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
    recordedChunks = [];
    mediaRecorder.ondataavailable = (event) => {
      if (event.data.size > 0) {
        recordedChunks.push(event.data);
      }
    };
    mediaRecorder.start(1000);
    appendLog("Recording microphone audio. Speak now, then click Stop and Run Whisper.");
    setStatus("Recording voice for Whisper test.", "warn");
    renderSessionStatus({
      session_id: activeSession.sessionId,
      current_stage: "recording",
      overall_state: "active",
      filesystem_session_path: activeSession.filesystemSessionPath ?? undefined,
      jobs: [],
    });
  } catch (e) {
    setStatus(e instanceof Error ? e.message : "Failed to start voice test.", "error");
    appendLog(e instanceof Error ? e.message : String(e));
  } finally {
    setBusy(false);
  }
}

export async function stopAndRunWhisperTest(): Promise<void> {
  if (busy || !activeSession || mediaRecorder === null) {
    return;
  }
  setBusy(true);
  try {
    appendLog("Stopping recorder and packaging WebM...");
    const blob = await stopRecorderToBlob();
    mediaRecorder = null;
    stopMediaStream();
    if (blob.size === 0) {
      throw new Error("Recording was empty. Try again and speak for a few seconds.");
    }

    appendLog(`Uploading ${blob.size} bytes to session.audio...`);
    const audioResult = await serviceClient.postSessionAudio(activeSession.sessionId, blob);
    if (!audioResult.ok) {
      throw new Error(audioResult.error);
    }

    appendLog("Ending session to start FFmpeg + Whisper pipeline...");
    const endResult = await serviceClient.postSessionEnd(activeSession.sessionId, new Date().toISOString());
    if (!endResult.ok) {
      throw new Error(endResult.error);
    }

    setStatus("Pipeline started. Waiting for Whisper status...", "warn");
    startPolling();
  } catch (e) {
    setStatus(e instanceof Error ? e.message : "Failed to finish voice test.", "error");
    appendLog(e instanceof Error ? e.message : String(e));
    mediaRecorder = null;
    stopMediaStream();
  } finally {
    setBusy(false);
  }
}

async function requestMicrophonePermission(): Promise<void> {
  setBusy(true);
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    for (const track of stream.getTracks()) {
      track.stop();
    }
    await chrome.storage.local.set({ mcs_mic_permission_granted: true });
    setStatus("Microphone permission granted.", "ok");
    appendLog("Microphone permission granted.");
  } catch (e) {
    setStatus(e instanceof Error ? e.message : "Microphone permission failed.", "error");
  } finally {
    setBusy(false);
  }
}

async function checkService(): Promise<void> {
  setBusy(true);
  try {
    const health = await serviceClient.checkHealth({ ensureTray: true });
    ui.service.textContent = `${health.status}${health.detail ? ` - ${health.detail}` : ""}`;
    setStatus("Native service checked.", health.status === "connected" ? "ok" : "warn");
    const engine = await serviceClient.getEngineStatus();
    appendLog(engine.ok ? `engine.status: ${JSON.stringify(engine.data)}` : `engine.status failed: ${engine.error}`);
    await refreshCodexStatus();
  } catch (e) {
    setStatus(e instanceof Error ? e.message : "Service check failed.", "error");
  } finally {
    setBusy(false);
  }
}

ui.checkService.addEventListener("click", () => void checkService());
ui.requestMic.addEventListener("click", () => void requestMicrophonePermission());
ui.start.addEventListener("click", () => void startVoiceTest());
ui.stop.addEventListener("click", () => void stopAndRunWhisperTest());
ui.refreshStatus.addEventListener("click", () => void pollSessionStatus());
ui.runCodexMerge.addEventListener("click", () => void runCodexMergeOnSession());
ui.refreshCodex.addEventListener("click", () => void refreshCodexStatus());
ui.openOptions.addEventListener("click", () => {
  void chrome.runtime.openOptionsPage();
});

void (async () => {
  renderArtifactChecklist(undefined);
  renderReferences();
  await refreshSettingsSummary();
  await checkService();
  setBusy(false);
})();
