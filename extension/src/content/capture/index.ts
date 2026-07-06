import { MeetCaptureCoordinator } from "./coordinator.js";

const GLOBAL_KEY = "__mcsMeetCaptureCoordinator";

/** Meet UI (separate content bundle) invokes this when the in-call toolbar disappears or SPA leaves a room URL. */
const CAPTURE_TEARDOWN_BRIDGE = "__mcsNotifyCaptureTeardown";

type GlobalWindow = Window & typeof globalThis & {
  [GLOBAL_KEY]?: MeetCaptureCoordinator;
  [CAPTURE_TEARDOWN_BRIDGE]?: (reason: string) => Promise<void>;
};

function bootCapture(): void {
  const win = window as GlobalWindow;
  if (win[GLOBAL_KEY]) {
    return;
  }
  const coordinator = new MeetCaptureCoordinator(document);
  win[GLOBAL_KEY] = coordinator;
  win[CAPTURE_TEARDOWN_BRIDGE] = (reason: string) => coordinator.teardown(reason);
  void coordinator.start();
}

bootCapture();
