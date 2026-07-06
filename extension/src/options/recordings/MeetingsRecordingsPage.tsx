import Alert from "@mui/material/Alert";
import Grid from "@mui/material/Grid";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import CurrentMeetingPanel from "./CurrentMeetingPanel.js";
import RecordingPlayer from "./RecordingPlayer.js";
import RecordingsList from "./RecordingsList.js";
import { useRecordings } from "./useRecordings.js";

export default function MeetingsRecordingsPage() {
  const recordings = useRecordings();

  return (
    <Stack spacing={3}>
      <CurrentMeetingPanel
        currentMeeting={recordings.currentMeeting}
        onRefresh={() => void recordings.refreshAll()}
      />

      <Grid container spacing={3}>
        <Grid size={{ xs: 12, lg: 5 }}>
          <RecordingsList
            items={recordings.items}
            selectedSessionId={recordings.detail.item?.session_id ?? null}
            total={recordings.total}
            page={recordings.page}
            pageCount={recordings.pageCount}
            query={recordings.query}
            stateFilter={recordings.stateFilter}
            loading={recordings.loadingList}
            error={recordings.listError}
            onQueryChange={recordings.setQuery}
            onStateFilterChange={recordings.setStateFilter}
            onPageChange={recordings.setPage}
            onRefresh={() => void recordings.refreshAll()}
            onSelect={(item) => void recordings.selectRecording(item)}
          />
        </Grid>
        <Grid size={{ xs: 12, lg: 7 }}>
          {recordings.detail.item ? (
            <RecordingPlayer
              transcript={recordings.detail.transcript}
              audioInfo={recordings.detail.audioInfo}
              audioUrl={recordings.detail.audioUrl}
              loadingTranscript={recordings.detail.loadingTranscript}
              loadingAudio={recordings.detail.loadingAudio}
              error={recordings.detail.error}
            />
          ) : (
            <Alert severity="info">
              <Typography variant="h3">Select a recording</Typography>
              <Typography variant="body2">
                Pick a meeting from the library to preview its transcript and load local playback audio.
              </Typography>
            </Alert>
          )}
        </Grid>
      </Grid>
    </Stack>
  );
}
