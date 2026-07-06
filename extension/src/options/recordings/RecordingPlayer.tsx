import { useCallback, useState } from "react";
import type { SyntheticEvent } from "react";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import CircularProgress from "@mui/material/CircularProgress";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import type { RecordingAudioInfo, RecordingTranscript } from "../../shared/recordingsTypes.js";
import { activeTranscriptIndex, readinessLabel, transcriptPreview } from "./helpers.js";
import TranscriptTimeline from "./TranscriptTimeline.js";

interface RecordingPlayerProps {
  transcript: RecordingTranscript | null;
  audioInfo: RecordingAudioInfo | null;
  audioUrl: string | null;
  loadingTranscript: boolean;
  loadingAudio: boolean;
  error: string | null;
}

export default function RecordingPlayer({
  transcript,
  audioInfo,
  audioUrl,
  loadingTranscript,
  loadingAudio,
  error,
}: RecordingPlayerProps) {
  const [currentTime, setCurrentTime] = useState(0);
  const segments = transcript?.segments ?? [];
  const activeIndex = activeTranscriptIndex(segments, currentTime);
  const syncEnabled = Boolean(audioInfo?.timeline_safe && audioUrl && segments.length > 0);

  const onTimeUpdate = useCallback((event: SyntheticEvent<HTMLAudioElement>) => {
    setCurrentTime(event.currentTarget.currentTime);
  }, []);

  return (
    <Card>
      <CardContent>
        <Stack spacing={2}>
          <Box>
            <Typography variant="overline" color="primary">
              Playback and transcript
            </Typography>
            <Typography variant="h2">Recording preview</Typography>
            {transcript ? (
              <Typography variant="body2" color="text.secondary">
                Transcript source: {transcript.source}. Status: {readinessLabel(transcript.readiness)}.
              </Typography>
            ) : null}
          </Box>

          {error ? <Alert severity="warning">{error}</Alert> : null}

          {loadingAudio ? (
            <Stack direction="row" spacing={1} alignItems="center">
              <CircularProgress size={18} />
              <Typography>Loading local audio...</Typography>
            </Stack>
          ) : audioUrl ? (
            <Box>
              <audio src={audioUrl} controls onTimeUpdate={onTimeUpdate} style={{ width: "100%" }} />
              {!audioInfo?.timeline_safe ? (
                <Alert severity="info" sx={{ mt: 1 }}>
                  Playback is available, but subtitle sync waits for processed stitched audio.
                </Alert>
              ) : null}
            </Box>
          ) : (
            <Alert severity="info">Audio will be available after the local service writes a playback artifact.</Alert>
          )}

          {loadingTranscript ? (
            <Stack direction="row" spacing={1} alignItems="center">
              <CircularProgress size={18} />
              <Typography>Loading transcript...</Typography>
            </Stack>
          ) : (
            <>
              {segments.length > 0 ? (
                <Typography variant="body2" color="text.secondary">
                  {transcriptPreview(segments)}
                </Typography>
              ) : null}
              <TranscriptTimeline segments={segments} activeIndex={activeIndex} syncEnabled={syncEnabled} />
            </>
          )}
        </Stack>
      </CardContent>
    </Card>
  );
}
