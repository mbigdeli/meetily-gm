import { useEffect, useState } from "react";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Button from "@mui/material/Button";
import Typography from "@mui/material/Typography";
import Alert from "@mui/material/Alert";
import {
  getGmeetPairing,
  setGmeetPairing,
  checkGmeetHealth,
} from "../../shared/gmeetClient.js";

const DEFAULT_BASE_URL = "http://127.0.0.1:5167";

type TestState =
  | { kind: "idle" }
  | { kind: "testing" }
  | { kind: "ok" }
  | { kind: "error"; message: string };

/**
 * Meetily-GM: pair the companion extension with the desktop app's Google Meet
 * ingest server. The user copies the token from Meetily → Settings → Codex/
 * Google Meet pairing (gmeet_pairing_info) and pastes it here.
 */
export default function MeetilyConnectionSection() {
  const [baseUrl, setBaseUrl] = useState(DEFAULT_BASE_URL);
  const [token, setToken] = useState("");
  const [saved, setSaved] = useState(false);
  const [test, setTest] = useState<TestState>({ kind: "idle" });

  useEffect(() => {
    void (async () => {
      const pairing = await getGmeetPairing();
      if (pairing) {
        setBaseUrl(pairing.baseUrl);
        setToken(pairing.token);
      }
    })();
  }, []);

  const onSave = async () => {
    await setGmeetPairing({ baseUrl: baseUrl.trim() || DEFAULT_BASE_URL, token: token.trim() });
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
  };

  const onTest = async () => {
    setTest({ kind: "testing" });
    // Save first so the health probe uses the current values.
    await setGmeetPairing({ baseUrl: baseUrl.trim() || DEFAULT_BASE_URL, token: token.trim() });
    const res = await checkGmeetHealth();
    setTest(res.ok ? { kind: "ok" } : { kind: "error", message: res.error ?? "unreachable" });
  };

  return (
    <Card variant="outlined">
      <CardContent>
        <Stack spacing={2}>
          <div>
            <Typography variant="h6">Meetily Desktop Connection</Typography>
            <Typography variant="body2" color="text.secondary">
              Connect this extension to the Meetily desktop app so Google Meet captions,
              speaker names, and participants flow into your meetings. In Meetily open
              Settings and copy the Google Meet pairing token, then paste it here.
            </Typography>
          </div>

          <TextField
            label="Meetily address"
            size="small"
            value={baseUrl}
            onChange={(e) => setBaseUrl(e.target.value)}
            helperText="Default is fine unless you changed the port."
            fullWidth
          />
          <TextField
            label="Pairing token"
            size="small"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            placeholder="Paste the token from Meetily Settings"
            fullWidth
          />

          <Stack direction="row" spacing={1} alignItems="center">
            <Button variant="contained" onClick={() => void onSave()} disabled={!token.trim()}>
              Save
            </Button>
            <Button
              variant="outlined"
              onClick={() => void onTest()}
              disabled={!token.trim() || test.kind === "testing"}
            >
              {test.kind === "testing" ? "Testing…" : "Test connection"}
            </Button>
            {saved && (
              <Typography variant="body2" color="success.main">
                Saved
              </Typography>
            )}
          </Stack>

          {test.kind === "ok" && (
            <Alert severity="success">Connected to Meetily — Google Meet capture is ready.</Alert>
          )}
          {test.kind === "error" && (
            <Alert severity="error">
              Could not reach Meetily ({test.message}). Make sure the desktop app is running and
              the token matches.
            </Alert>
          )}
        </Stack>
      </CardContent>
    </Card>
  );
}
