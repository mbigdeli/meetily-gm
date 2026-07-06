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
import Stack from "@mui/material/Stack";
import SettingRow from "../components/SettingRow.js";
import type { LiveCaptionLanguage, MeetingCaptureSettings } from "../../shared/types.js";

interface DailyUseSectionProps {
  settings: MeetingCaptureSettings;
  captionLang: LiveCaptionLanguage;
  onCaptionLangChange: (lang: LiveCaptionLanguage) => void;
  onApplyCaptionLanguage: (lang: LiveCaptionLanguage) => void;
  onUpdateField: <K extends keyof MeetingCaptureSettings>(
    key: K,
    value: MeetingCaptureSettings[K],
  ) => void;
  captionBusy: boolean;
}

export default function DailyUseSection({
  settings,
  captionLang,
  onCaptionLangChange,
  onApplyCaptionLanguage,
  onUpdateField,
  captionBusy,
}: DailyUseSectionProps) {
  return (
    <Paper variant="outlined" sx={{ p: 3 }}>
      <Typography variant="overline" color="primary">
        Daily use
      </Typography>
      <Typography variant="h2" sx={{ mb: 0.5 }}>
        Defaults you will touch most
      </Typography>
      <Typography variant="body1" color="text.secondary" sx={{ mb: 3 }}>
        Keep the common recording behavior close to the top so you can adjust it
        quickly.
      </Typography>

      <Grid container spacing={2}>
        {/* Caption language */}
        <Grid size={{ xs: 12, md: 6 }}>
          <Card sx={{ height: "100%" }}>
            <CardContent>
              <Typography variant="h3" sx={{ mb: 1 }}>
                Remembered caption language
              </Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                Choose the default language that should be remembered for Google
                Meet live captions.
              </Typography>
              <FormControl fullWidth size="small" sx={{ mb: 2 }}>
                <InputLabel>Default language</InputLabel>
                <Select
                  value={captionLang}
                  label="Default language"
                  onChange={(e) =>
                    onCaptionLangChange(e.target.value as LiveCaptionLanguage)
                  }
                >
                  <MenuItem value="fa">Persian (fa)</MenuItem>
                  <MenuItem value="en">English (en)</MenuItem>
                </Select>
              </FormControl>
              <Button
                variant="outlined"
                onClick={() => onApplyCaptionLanguage(captionLang)}
                disabled={captionBusy}
              >
                Apply language
              </Button>
            </CardContent>
          </Card>
        </Grid>

        {/* Capture defaults */}
        <Grid size={{ xs: 12, md: 6 }}>
          <Card sx={{ height: "100%" }}>
            <CardContent>
              <Typography variant="h3" sx={{ mb: 1 }}>
                Capture defaults
              </Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                Behavior switches that matter most during day-to-day meeting
                capture.
              </Typography>
              <Stack divider={<Divider />}>
                <SettingRow
                  title="Auto-enable live captions"
                  description="Turns captions on automatically when capture starts."
                  checked={settings.autoEnableLiveCaptions}
                  onChange={(v) => onUpdateField("autoEnableLiveCaptions", v)}
                />
                <SettingRow
                  title="Auto-record tab audio"
                  description="Captures meeting audio from the current Google Meet tab."
                  checked={settings.autoRecordTabAudio}
                  onChange={(v) => onUpdateField("autoRecordTabAudio", v)}
                />
                <SettingRow
                  title="Auto-start when Meet is detected"
                  description="Stored now for the pipeline. Full Meet auto-start arrives in a later build."
                  checked={settings.autoStartCaptureWhenMeetDetected}
                  onChange={(v) =>
                    onUpdateField("autoStartCaptureWhenMeetDetected", v)
                  }
                />
                <SettingRow
                  title="Hide caption overlay while reading"
                  description="Useful if you want a cleaner UI without losing caption parsing."
                  checked={settings.hideCaptionOverlayWhileParsing}
                  onChange={(v) =>
                    onUpdateField("hideCaptionOverlayWhileParsing", v)
                  }
                />
              </Stack>
            </CardContent>
          </Card>
        </Grid>
      </Grid>
    </Paper>
  );
}
