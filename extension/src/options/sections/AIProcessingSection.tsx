import Paper from "@mui/material/Paper";
import Typography from "@mui/material/Typography";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import Grid from "@mui/material/Grid";
import Button from "@mui/material/Button";
import Divider from "@mui/material/Divider";
import FormControl from "@mui/material/FormControl";
import InputLabel from "@mui/material/InputLabel";
import Select from "@mui/material/Select";
import MenuItem from "@mui/material/MenuItem";
import Box from "@mui/material/Box";
import Stack from "@mui/material/Stack";
import Alert from "@mui/material/Alert";
import CircularProgress from "@mui/material/CircularProgress";
import LoginIcon from "@mui/icons-material/Login";
import LogoutIcon from "@mui/icons-material/Logout";
import StatusChip from "../components/StatusChip.js";
import SettingRow from "../components/SettingRow.js";
import type { StatusView } from "../statusPresentation.js";
import type { MeetingCaptureSettings } from "../../shared/types.js";

interface AIProcessingSectionProps {
  settings: MeetingCaptureSettings;
  engineStatus: StatusView;
  codexStatus: StatusView;
  onUpdateField: <K extends keyof MeetingCaptureSettings>(
    key: K,
    value: MeetingCaptureSettings[K],
  ) => void;
  onDownloadModel: () => void;
  onInstallEngine: () => void;
  onRefreshEngine: () => void;
  onLoginCodex: () => void;
  onLogoutCodex: () => void;
  onRefreshCodex: () => void;
  downloadBusy: boolean;
  installBusy: boolean;
  refreshEngineBusy: boolean;
  loginCodexBusy: boolean;
  logoutCodexBusy: boolean;
  refreshCodexBusy: boolean;
}

export default function AIProcessingSection({
  settings,
  engineStatus,
  codexStatus,
  onUpdateField,
  onDownloadModel,
  onInstallEngine,
  onRefreshEngine,
  onLoginCodex,
  onLogoutCodex,
  onRefreshCodex,
  downloadBusy,
  installBusy,
  refreshEngineBusy,
  loginCodexBusy,
  logoutCodexBusy,
  refreshCodexBusy,
}: AIProcessingSectionProps) {
  const codexConnected = codexStatus.isConnected === true;
  return (
    <Paper variant="outlined" sx={{ p: 3 }}>
      <Typography variant="overline" color="primary">
        AI processing
      </Typography>
      <Typography variant="h2" sx={{ mb: 0.5 }}>
        Whisper and Codex
      </Typography>
      <Typography variant="body1" color="text.secondary" sx={{ mb: 3 }}>
        Pick the transcription model you want and manage the higher-level
        outputs generated after capture.
      </Typography>

      <Grid container spacing={2}>
        {/* Whisper engine */}
        <Grid size={{ xs: 12, md: 6 }}>
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
                <Typography variant="h3">Whisper engine</Typography>
                <StatusChip
                  label={engineStatus.chipLabel}
                  tone={engineStatus.tone}
                />
              </Box>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                Choose your preferred model for local transcription and check
                whether the engine is ready.
              </Typography>
              <FormControl fullWidth size="small" sx={{ mb: 2 }}>
                <InputLabel>Preferred model</InputLabel>
                <Select
                  value={settings.whisperPreferredModel}
                  label="Preferred model"
                  onChange={(e) =>
                    onUpdateField("whisperPreferredModel", e.target.value)
                  }
                >
                  <MenuItem value="tiny">tiny</MenuItem>
                  <MenuItem value="base">base</MenuItem>
                  <MenuItem value="small">small</MenuItem>
                  <MenuItem value="medium">medium</MenuItem>
                  <MenuItem value="large-v3">large-v3</MenuItem>
                </Select>
              </FormControl>
              <Typography variant="body2" sx={{ mb: 2, minHeight: 36 }}>
                {engineStatus.summary}
              </Typography>
              <Stack direction="row" spacing={1} flexWrap="wrap">
                <Button
                  variant="contained"
                  onClick={onDownloadModel}
                  disabled={downloadBusy}
                >
                  Download model
                </Button>
                <Button
                  variant="outlined"
                  onClick={onInstallEngine}
                  disabled={installBusy}
                >
                  Install engine
                </Button>
                <Button
                  variant="text"
                  onClick={onRefreshEngine}
                  disabled={refreshEngineBusy}
                >
                  Refresh status
                </Button>
              </Stack>
            </CardContent>
          </Card>
        </Grid>

        {/* Codex outputs */}
        <Grid size={{ xs: 12, md: 6 }}>
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
                <Typography variant="h3">Codex outputs</Typography>
                <StatusChip
                  label={codexStatus.chipLabel}
                  tone={codexStatus.tone}
                />
              </Box>

              {codexConnected ? (
                <Alert severity="success" sx={{ mb: 1 }}>
                  Connected to Codex{codexStatus.userEmail ? ` as ${codexStatus.userEmail}` : ""}
                </Alert>
              ) : (
                <Alert severity="info" sx={{ mb: 1 }}>
                  Login to Codex to enable AI-powered summaries, action items, and decisions.
                </Alert>
              )}

              <Stack divider={<Divider />} sx={codexConnected ? undefined : { opacity: 0.5 }}>
                <SettingRow
                  title="Enable Codex merge"
                  description="Uses Codex as the final semantic merge layer."
                  checked={settings.codexMergeEnabled}
                  onChange={(v) => onUpdateField("codexMergeEnabled", v)}
                  disabled={!codexConnected}
                />
                <SettingRow
                  title="Generate summary"
                  description="Creates a short post-meeting summary when merge is enabled."
                  checked={settings.codexGenerateSummary}
                  onChange={(v) => onUpdateField("codexGenerateSummary", v)}
                  disabled={!codexConnected}
                />
                <SettingRow
                  title="Generate action items"
                  description="Creates a structured action-item list from the transcript."
                  checked={settings.codexGenerateActionItems}
                  onChange={(v) => onUpdateField("codexGenerateActionItems", v)}
                  disabled={!codexConnected}
                />
                <SettingRow
                  title="Generate decisions log"
                  description="Creates a lightweight log of decisions made during the meeting."
                  checked={settings.codexGenerateDecisions}
                  onChange={(v) => onUpdateField("codexGenerateDecisions", v)}
                  disabled={!codexConnected}
                />
              </Stack>
              <Typography variant="body2" sx={{ mt: 1, mb: 2, minHeight: 36 }}>
                {codexStatus.summary}
              </Typography>
              <Stack direction="row" spacing={1}>
                {codexConnected ? (
                  <Button
                    variant="outlined"
                    color="error"
                    startIcon={logoutCodexBusy ? <CircularProgress size={16} /> : <LogoutIcon />}
                    onClick={onLogoutCodex}
                    disabled={logoutCodexBusy}
                  >
                    Disconnect
                  </Button>
                ) : (
                  <Button
                    variant="contained"
                    startIcon={loginCodexBusy ? <CircularProgress size={16} /> : <LoginIcon />}
                    onClick={onLoginCodex}
                    disabled={loginCodexBusy}
                  >
                    Login to Codex
                  </Button>
                )}
                <Button
                  variant="text"
                  onClick={onRefreshCodex}
                  disabled={refreshCodexBusy}
                >
                  Refresh status
                </Button>
              </Stack>
            </CardContent>
          </Card>
        </Grid>
      </Grid>
    </Paper>
  );
}
