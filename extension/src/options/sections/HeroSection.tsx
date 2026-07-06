import Paper from "@mui/material/Paper";
import Typography from "@mui/material/Typography";
import Chip from "@mui/material/Chip";
import Stack from "@mui/material/Stack";
import Box from "@mui/material/Box";
import Banner from "../components/Banner.js";
import type { BannerState } from "../hooks/useSettings.js";

interface HeroSectionProps {
  banner: BannerState;
  onBannerClose: () => void;
}

export default function HeroSection({ banner, onBannerClose }: HeroSectionProps) {
  return (
    <Paper variant="outlined" sx={{ p: 3, mb: 3 }}>
      <Stack direction="row" spacing={2} alignItems="center" sx={{ mb: 1 }}>
        <Box
          component="img"
          src="./logo.png"
          alt=""
          sx={{ width: 56, height: 56, objectFit: "contain" }}
        />
        <Box>
          <Typography variant="overline" color="primary">
            Meeting Capture
          </Typography>
          <Typography variant="h1">Extension settings</Typography>
        </Box>
      </Stack>
      <Typography variant="body1" color="text.secondary" sx={{ maxWidth: 680 }}>
        Set up local folders, capture defaults, and processing tools in one
        place. Everything here stays in this browser unless the local service
        uses it.
      </Typography>
      <Stack direction="row" spacing={1} sx={{ mt: 2, flexWrap: "wrap" }}>
        <Chip label="Browser local" color="primary" variant="filled" size="small" />
        <Chip label="Windows first" color="primary" variant="filled" size="small" />
        <Chip label="Local service aware" color="primary" variant="filled" size="small" />
      </Stack>
      <Banner banner={banner} onClose={onBannerClose} />
    </Paper>
  );
}
