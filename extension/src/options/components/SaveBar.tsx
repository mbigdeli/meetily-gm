import Box from "@mui/material/Box";
import Paper from "@mui/material/Paper";
import Button from "@mui/material/Button";
import Typography from "@mui/material/Typography";

interface SaveBarProps {
  onSave: () => void;
  busy: boolean;
}

export default function SaveBar({ onSave, busy }: SaveBarProps) {
  return (
    <Paper
      elevation={0}
      sx={{
        position: "sticky",
        bottom: 0,
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 3,
        mt: 3,
        p: 2,
        px: 3,
        borderTop: 1,
        borderColor: "divider",
        borderRadius: 0,
        zIndex: 10,
      }}
    >
      <Box>
        <Typography variant="body1" fontWeight={500}>
          Save settings to this browser
        </Typography>
        <Typography variant="body2" color="text.secondary">
          Storage roots, defaults, and AI preferences stay local until you change
          them again.
        </Typography>
      </Box>
      <Button
        variant="contained"
        onClick={onSave}
        disabled={busy}
        sx={{ whiteSpace: "nowrap" }}
      >
        Save settings
      </Button>
    </Paper>
  );
}
