import Accordion from "@mui/material/Accordion";
import AccordionSummary from "@mui/material/AccordionSummary";
import AccordionDetails from "@mui/material/AccordionDetails";
import Typography from "@mui/material/Typography";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import Grid from "@mui/material/Grid";
import TextField from "@mui/material/TextField";
import Divider from "@mui/material/Divider";
import FormControl from "@mui/material/FormControl";
import InputLabel from "@mui/material/InputLabel";
import Select from "@mui/material/Select";
import MenuItem from "@mui/material/MenuItem";
import Box from "@mui/material/Box";
import Stack from "@mui/material/Stack";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import SettingRow from "../components/SettingRow.js";
import type { StatusView } from "../statusPresentation.js";
import type { MeetingCaptureSettings } from "../../shared/types.js";

interface AdvancedSectionProps {
  settings: MeetingCaptureSettings;
  engineStatus: StatusView;
  codexStatus: StatusView;
  onUpdateField: <K extends keyof MeetingCaptureSettings>(
    key: K,
    value: MeetingCaptureSettings[K],
  ) => void;
}

export default function AdvancedSection({
  settings,
  engineStatus,
  codexStatus,
  onUpdateField,
}: AdvancedSectionProps) {
  return (
    <Accordion
      variant="outlined"
      sx={{ borderRadius: "12px !important", "&:before": { display: "none" } }}
    >
      <AccordionSummary expandIcon={<ExpandMoreIcon />}>
        <Box>
          <Typography variant="overline" color="primary">
            Advanced and diagnostics
          </Typography>
          <Typography variant="h2">Rarely changed controls</Typography>
          <Typography variant="body1" color="text.secondary">
            Lower-frequency options tucked away so the important health state
            stays visible above.
          </Typography>
        </Box>
      </AccordionSummary>
      <AccordionDetails>
        <Grid container spacing={2}>
          {/* Service and cleanup */}
          <Grid size={{ xs: 12, md: 4 }}>
            <Card sx={{ height: "100%" }}>
              <CardContent>
                <Typography variant="h3" sx={{ mb: 2 }}>
                  Service and cleanup
                </Typography>
                <TextField
                  label="Request timeout (ms)"
                  type="number"
                  value={settings.localServiceTimeoutMs}
                  onChange={(e) => {
                    const v = Number.parseInt(e.target.value, 10);
                    if (Number.isFinite(v)) {
                      onUpdateField(
                        "localServiceTimeoutMs",
                        Math.min(120_000, Math.max(500, v)),
                      );
                    }
                  }}
                  slotProps={{
                    htmlInput: { min: 500, max: 120000, step: 100 },
                  }}
                  sx={{ mb: 2 }}
                />
                <Stack divider={<Divider />}>
                  <SettingRow
                    title="Keep raw files after processing"
                    description="Useful for debugging or rerunning the pipeline later."
                    checked={settings.keepRawFilesAfterProcessing}
                    onChange={(v) =>
                      onUpdateField("keepRawFilesAfterProcessing", v)
                    }
                  />
                  <SettingRow
                    title="Open final output folder after completion"
                    description="Convenient if you immediately review generated files after each session."
                    checked={settings.autoOpenFinalOutputFolder}
                    onChange={(v) =>
                      onUpdateField("autoOpenFinalOutputFolder", v)
                    }
                  />
                </Stack>
              </CardContent>
            </Card>
          </Grid>

          {/* Whisper tuning */}
          <Grid size={{ xs: 12, md: 4 }}>
            <Card sx={{ height: "100%" }}>
              <CardContent>
                <Typography variant="h3" sx={{ mb: 1 }}>
                  Whisper tuning
                </Typography>
                <Typography
                  variant="body2"
                  color="text.secondary"
                  sx={{ mb: 2 }}
                >
                  Device and compute preferences are mostly power-user choices.
                </Typography>
                <Stack spacing={2}>
                  <FormControl fullWidth size="small">
                    <InputLabel>Device preference</InputLabel>
                    <Select
                      value={settings.whisperDevicePreference}
                      label="Device preference"
                      onChange={(e) =>
                        onUpdateField(
                          "whisperDevicePreference",
                          e.target.value as MeetingCaptureSettings["whisperDevicePreference"],
                        )
                      }
                    >
                      <MenuItem value="auto">Auto</MenuItem>
                      <MenuItem value="cpu">CPU</MenuItem>
                      <MenuItem value="cuda">CUDA</MenuItem>
                    </Select>
                  </FormControl>
                  <FormControl fullWidth size="small">
                    <InputLabel>Compute type</InputLabel>
                    <Select
                      value={settings.whisperComputeType}
                      label="Compute type"
                      onChange={(e) =>
                        onUpdateField(
                          "whisperComputeType",
                          e.target.value as MeetingCaptureSettings["whisperComputeType"],
                        )
                      }
                    >
                      <MenuItem value="auto">Auto</MenuItem>
                      <MenuItem value="int8">int8</MenuItem>
                      <MenuItem value="float16">float16</MenuItem>
                      <MenuItem value="float32">float32</MenuItem>
                    </Select>
                  </FormControl>
                </Stack>
              </CardContent>
            </Card>
          </Grid>

          {/* Diarization */}
          <Grid size={{ xs: 12, md: 4 }}>
            <Card sx={{ height: "100%" }}>
              <CardContent>
                <Typography variant="h3" sx={{ mb: 1 }}>
                  Diarization
                </Typography>
                <Typography
                  variant="body2"
                  color="text.secondary"
                  sx={{ mb: 1 }}
                >
                  Leave this alone unless you need speaker separation behavior
                  tuned for a specific meeting format.
                </Typography>
                <SettingRow
                  title="Enable diarization"
                  description="Lets the local pipeline attempt speaker segmentation."
                  checked={settings.diarizationEnabled}
                  onChange={(v) => onUpdateField("diarizationEnabled", v)}
                />
                <TextField
                  label="Speaker count hint"
                  type="number"
                  helperText="Optional. Only fill this if you know roughly how many speakers participated."
                  value={
                    settings.diarizationSpeakerCountHint === null
                      ? ""
                      : settings.diarizationSpeakerCountHint
                  }
                  onChange={(e) => {
                    const raw = e.target.value.trim();
                    if (raw === "") {
                      onUpdateField("diarizationSpeakerCountHint", null);
                    } else {
                      const n = Number.parseInt(raw, 10);
                      if (Number.isFinite(n)) {
                        onUpdateField("diarizationSpeakerCountHint", n);
                      }
                    }
                  }}
                  slotProps={{ htmlInput: { min: 1, max: 32, step: 1 } }}
                  sx={{ mt: 1 }}
                />
              </CardContent>
            </Card>
          </Grid>
        </Grid>

        {/* Diagnostics */}
        <Grid container spacing={2} sx={{ mt: 1 }}>
          <Grid size={{ xs: 12, md: 6 }}>
            <Card>
              <CardContent>
                <Typography variant="h3" sx={{ mb: 1 }}>
                  Engine diagnostics
                </Typography>
                <Typography
                  variant="body2"
                  color="text.secondary"
                  sx={{ mb: 1 }}
                >
                  Raw local service response for troubleshooting.
                </Typography>
                <Box
                  component="pre"
                  sx={{
                    minHeight: 160,
                    p: 2,
                    borderRadius: 2,
                    bgcolor: "#1e1e2e",
                    color: "#cdd6f4",
                    fontFamily: "monospace",
                    fontSize: "11.5px",
                    lineHeight: 1.6,
                    whiteSpace: "pre-wrap",
                    wordBreak: "break-word",
                    overflow: "auto",
                    m: 0,
                  }}
                >
                  {engineStatus.details ?? "No diagnostics yet."}
                </Box>
              </CardContent>
            </Card>
          </Grid>
          <Grid size={{ xs: 12, md: 6 }}>
            <Card>
              <CardContent>
                <Typography variant="h3" sx={{ mb: 1 }}>
                  Codex diagnostics
                </Typography>
                <Typography
                  variant="body2"
                  color="text.secondary"
                  sx={{ mb: 1 }}
                >
                  Latest raw status payload returned by the local service.
                </Typography>
                <Box
                  component="pre"
                  sx={{
                    minHeight: 160,
                    p: 2,
                    borderRadius: 2,
                    bgcolor: "#1e1e2e",
                    color: "#cdd6f4",
                    fontFamily: "monospace",
                    fontSize: "11.5px",
                    lineHeight: 1.6,
                    whiteSpace: "pre-wrap",
                    wordBreak: "break-word",
                    overflow: "auto",
                    m: 0,
                  }}
                >
                  {codexStatus.details ?? "No diagnostics yet."}
                </Box>
              </CardContent>
            </Card>
          </Grid>
        </Grid>
      </AccordionDetails>
    </Accordion>
  );
}
