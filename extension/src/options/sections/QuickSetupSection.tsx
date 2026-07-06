import Paper from "@mui/material/Paper";
import Typography from "@mui/material/Typography";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import Grid from "@mui/material/Grid";
import Button from "@mui/material/Button";
import TextField from "@mui/material/TextField";
import InputAdornment from "@mui/material/InputAdornment";
import IconButton from "@mui/material/IconButton";
import FolderOpenIcon from "@mui/icons-material/FolderOpen";
import Box from "@mui/material/Box";
import Stack from "@mui/material/Stack";
import StatusChip from "../components/StatusChip.js";
import type { StatusView } from "../statusPresentation.js";
import type { MeetingCaptureSettings } from "../../shared/types.js";

interface QuickSetupSectionProps {
  settings: MeetingCaptureSettings;
  micStatus: StatusView;
  serviceStatus: StatusView;
  onUpdateField: <K extends keyof MeetingCaptureSettings>(
    key: K,
    value: MeetingCaptureSettings[K],
  ) => void;
  onGrantMic: () => void;
  onTestService: () => void;
  onBrowseFolder: (field: "rawStorageRoot" | "finalOutputRoot") => void;
  micBusy: boolean;
  serviceBusy: boolean;
}

export default function QuickSetupSection({
  settings,
  micStatus,
  serviceStatus,
  onUpdateField,
  onGrantMic,
  onTestService,
  onBrowseFolder,
  micBusy,
  serviceBusy,
}: QuickSetupSectionProps) {
  return (
    <Paper variant="outlined" sx={{ p: 3 }}>
      <Typography variant="overline" color="primary">
        Quick setup
      </Typography>
      <Typography variant="h2" sx={{ mb: 0.5 }}>
        Get recording ready
      </Typography>
      <Typography variant="body1" color="text.secondary" sx={{ mb: 3 }}>
        Do these once: grant mic access, choose storage folders, and confirm the
        desktop app is reachable.
      </Typography>

      <Grid container spacing={2}>
        {/* Microphone */}
        <Grid size={{ xs: 12, md: 4 }}>
          <Card
            sx={{
              height: "100%",
              bgcolor: "primary.light",
              borderColor: "rgba(11, 87, 208, 0.18)",
            }}
          >
            <CardContent>
              <Box
                sx={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "flex-start",
                  mb: 1,
                }}
              >
                <Typography variant="h3">Microphone access</Typography>
                <StatusChip label={micStatus.chipLabel} tone={micStatus.tone} />
              </Box>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                Grant one-time microphone access so your own voice can be
                included in meeting recordings.
              </Typography>
              <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 1 }}>
                When prompted, select <strong>&quot;Always allow&quot;</strong> so
                the permission persists across recording sessions.
              </Typography>
              <Typography variant="body2" sx={{ mb: 2, minHeight: 36 }}>
                {micStatus.summary}
              </Typography>
              <Button
                variant="contained"
                onClick={onGrantMic}
                disabled={micBusy || micStatus.tone === "success"}
              >
                Grant microphone access
              </Button>
            </CardContent>
          </Card>
        </Grid>

        {/* Storage roots */}
        <Grid size={{ xs: 12, md: 4 }}>
          <Card sx={{ height: "100%" }}>
            <CardContent>
              <Typography variant="h3" sx={{ mb: 1 }}>
                Storage roots
              </Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                These folders are required before the extension can save raw
                artifacts and final outputs.
              </Typography>
              <Stack spacing={2}>
                <TextField
                  label="Raw Storage Root"
                  helperText="Required — full Windows path, e.g. C:\MeetingCapture\raw"
                  value={settings.rawStorageRoot}
                  onChange={(e) => onUpdateField("rawStorageRoot", e.target.value)}
                  slotProps={{
                    input: {
                      endAdornment: (
                        <InputAdornment position="end">
                          <IconButton
                            onClick={() => onBrowseFolder("rawStorageRoot")}
                            edge="end"
                            aria-label="Choose folder"
                          >
                            <FolderOpenIcon />
                          </IconButton>
                        </InputAdornment>
                      ),
                    },
                  }}
                />
                <TextField
                  label="Final Output Root"
                  helperText="Required — full Windows path, e.g. C:\MeetingCapture\final"
                  value={settings.finalOutputRoot}
                  onChange={(e) =>
                    onUpdateField("finalOutputRoot", e.target.value)
                  }
                  slotProps={{
                    input: {
                      endAdornment: (
                        <InputAdornment position="end">
                          <IconButton
                            onClick={() => onBrowseFolder("finalOutputRoot")}
                            edge="end"
                            aria-label="Choose folder"
                          >
                            <FolderOpenIcon />
                          </IconButton>
                        </InputAdornment>
                      ),
                    },
                  }}
                />
              </Stack>
            </CardContent>
          </Card>
        </Grid>

        {/* Desktop app */}
        <Grid size={{ xs: 12, md: 4 }}>
          <Card sx={{ height: "100%" }}>
            <CardContent>
              <Box
                sx={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "flex-start",
                  mb: 1,
                }}
              >
                <Typography variant="h3">Desktop app</Typography>
                <StatusChip
                  label={serviceStatus.chipLabel}
                  tone={serviceStatus.tone}
                />
              </Box>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                The extension uses Chrome Native Messaging to run{" "}
                <code>meeting-capture.exe</code> (install via <code>install.ps1</code>)
                for tray status, engine status, capture ingest, and Codex.
              </Typography>
              <Typography variant="body2" sx={{ mb: 2, minHeight: 36 }}>
                {serviceStatus.summary}
              </Typography>
              <Button
                variant="outlined"
                onClick={onTestService}
                disabled={serviceBusy}
              >
                Test connection
              </Button>
            </CardContent>
          </Card>
        </Grid>
      </Grid>
    </Paper>
  );
}
