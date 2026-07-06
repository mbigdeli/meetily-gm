import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import StatusChip from "../components/StatusChip.js";
import type { CurrentMeetingSnapshot } from "../../shared/recordingsTypes.js";
import { formatDurationMs, readinessLabel, readinessTone } from "./helpers.js";

interface CurrentMeetingPanelProps {
  currentMeeting: CurrentMeetingSnapshot | null;
  onRefresh: () => void;
}

export default function CurrentMeetingPanel({ currentMeeting, onRefresh }: CurrentMeetingPanelProps) {
  const hasCurrent = Boolean(currentMeeting?.currentSessionId ?? currentMeeting?.activeCapture?.sessionId);
  const recordingMs = currentMeeting
    ? currentMeeting.captureRecordingAccumMs +
      (currentMeeting.captureRecordingSegmentStartedAt
        ? Date.now() - currentMeeting.captureRecordingSegmentStartedAt
        : 0)
    : 0;

  return (
    <Card>
      <CardContent>
        <Stack direction={{ xs: "column", md: "row" }} spacing={2} justifyContent="space-between">
          <Box>
            <Typography variant="overline" color="primary">
              Current meeting
            </Typography>
            <Typography variant="h2">
              {currentMeeting?.currentMeetingTitle ?? (hasCurrent ? "Active meeting" : "No active meeting")}
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mt: 0.75 }}>
              {hasCurrent
                ? `Session ${currentMeeting?.currentSessionId ?? currentMeeting?.activeCapture?.sessionId}`
                : currentMeeting?.isMeetPageActive
                  ? "Meet is open, but capture has not started."
                  : "Open Google Meet and start capture to see live status here."}
            </Typography>
          </Box>
          <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap">
            <StatusChip
              label={currentMeeting?.isCaptureRunning ? "Recording" : currentMeeting?.isSessionPaused ? "Paused" : "Idle"}
              tone={currentMeeting?.isCaptureRunning ? "success" : currentMeeting?.isSessionPaused ? "warning" : "neutral"}
            />
            <StatusChip
              label={readinessLabel(currentMeeting?.transcriptReadiness ?? "none")}
              tone={readinessTone(currentMeeting?.transcriptReadiness ?? "none")}
            />
            <Button variant="outlined" size="small" onClick={onRefresh}>
              Refresh
            </Button>
          </Stack>
        </Stack>

        <Stack direction={{ xs: "column", sm: "row" }} spacing={2} sx={{ mt: 2 }}>
          <Box>
            <Typography variant="body2" color="text.secondary">
              Recorded time
            </Typography>
            <Typography variant="h3">{formatDurationMs(recordingMs)}</Typography>
          </Box>
          <Box>
            <Typography variant="body2" color="text.secondary">
              Desktop service
            </Typography>
            <Typography variant="h3">{currentMeeting?.localServiceStatus ?? "unknown"}</Typography>
          </Box>
          <Box>
            <Typography variant="body2" color="text.secondary">
              Transcript
            </Typography>
            <Typography variant="h3">
              {currentMeeting?.transcriptReadiness === "ready"
                ? "Ready to preview"
                : "Will appear when processing is ready"}
            </Typography>
          </Box>
        </Stack>
      </CardContent>
    </Card>
  );
}
