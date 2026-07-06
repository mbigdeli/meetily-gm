import { useState } from "react";
import { ThemeProvider } from "@mui/material/styles";
import CssBaseline from "@mui/material/CssBaseline";
import Container from "@mui/material/Container";
import Stack from "@mui/material/Stack";
import CircularProgress from "@mui/material/CircularProgress";
import Box from "@mui/material/Box";
import Paper from "@mui/material/Paper";
import Tab from "@mui/material/Tab";
import Tabs from "@mui/material/Tabs";
import theme from "./theme.js";
import { useSettings } from "./hooks/useSettings.js";
import HeroSection from "./sections/HeroSection.js";
import QuickSetupSection from "./sections/QuickSetupSection.js";
import MeetilyConnectionSection from "./sections/MeetilyConnectionSection.js";
import DailyUseSection from "./sections/DailyUseSection.js";
import AIProcessingSection from "./sections/AIProcessingSection.js";
import AdvancedSection from "./sections/AdvancedSection.js";
import SaveBar from "./components/SaveBar.js";
import MeetingsRecordingsPage from "./recordings/MeetingsRecordingsPage.js";

type OptionsView = "settings" | "recordings";

export default function App() {
  const [view, setView] = useState<OptionsView>("settings");
  const {
    settings,
    captionLang,
    setCaptionLang,
    banner,
    setBanner,
    statuses,
    isBusy,
    runBusy,
    updateField,
    saveSettings,
    grantMic,
    testService,
    installEngine,
    downloadModel,
    loginCodex,
    logoutCodex,
    applyCaptionLanguage,
    browseFolder,
    refreshEngineStatus,
    refreshCodexStatus,
  } = useSettings();

  if (!settings) {
    return (
      <ThemeProvider theme={theme}>
        <CssBaseline />
        <Box
          sx={{
            display: "flex",
            justifyContent: "center",
            alignItems: "center",
            minHeight: "100vh",
          }}
        >
          <CircularProgress />
        </Box>
      </ThemeProvider>
    );
  }

  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <Container maxWidth="lg" sx={{ py: 3, pb: 14 }}>
        <HeroSection
          banner={banner}
          onBannerClose={() => setBanner(null)}
        />

        <Paper variant="outlined" sx={{ mb: 3 }}>
          <Tabs
            value={view}
            onChange={(_, next: OptionsView) => setView(next)}
            aria-label="Options sections"
            sx={{ px: 2 }}
          >
            <Tab label="Settings" value="settings" />
            <Tab label="Meetings & Recordings" value="recordings" />
          </Tabs>
        </Paper>

        {view === "settings" ? (
          <Stack spacing={3}>
            <MeetilyConnectionSection />

            <QuickSetupSection
              settings={settings}
              micStatus={statuses.mic}
              serviceStatus={statuses.service}
              onUpdateField={updateField}
              onGrantMic={() => runBusy("mic", grantMic)}
              onTestService={() => runBusy("service", testService)}
              onBrowseFolder={browseFolder}
              micBusy={isBusy("mic")}
              serviceBusy={isBusy("service")}
            />

            <DailyUseSection
              settings={settings}
              captionLang={captionLang}
              onCaptionLangChange={setCaptionLang}
              onApplyCaptionLanguage={(lang) =>
                runBusy("caption", () => applyCaptionLanguage(lang))
              }
              onUpdateField={updateField}
              captionBusy={isBusy("caption")}
            />

            <AIProcessingSection
              settings={settings}
              engineStatus={statuses.engine}
              codexStatus={statuses.codex}
              onUpdateField={updateField}
              onDownloadModel={() => runBusy("download", downloadModel)}
              onInstallEngine={() => runBusy("install", installEngine)}
              onRefreshEngine={() =>
                runBusy("refreshEngine", refreshEngineStatus)
              }
              onLoginCodex={() => runBusy("loginCodex", loginCodex)}
              onLogoutCodex={() => runBusy("logoutCodex", logoutCodex)}
              onRefreshCodex={() =>
                runBusy("refreshCodex", refreshCodexStatus)
              }
              downloadBusy={isBusy("download")}
              installBusy={isBusy("install")}
              refreshEngineBusy={isBusy("refreshEngine")}
              loginCodexBusy={isBusy("loginCodex")}
              logoutCodexBusy={isBusy("logoutCodex")}
              refreshCodexBusy={isBusy("refreshCodex")}
            />

            <AdvancedSection
              settings={settings}
              engineStatus={statuses.engine}
              codexStatus={statuses.codex}
              onUpdateField={updateField}
            />
          </Stack>
        ) : (
          <MeetingsRecordingsPage />
        )}

        {view === "settings" ? (
          <SaveBar
            onSave={() => runBusy("save", saveSettings)}
            busy={isBusy("save")}
          />
        ) : null}
      </Container>
    </ThemeProvider>
  );
}
