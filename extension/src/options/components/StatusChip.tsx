import Chip from "@mui/material/Chip";
import type { StatusTone } from "../statusPresentation.js";

const TONE_COLOR_MAP: Record<StatusTone, "success" | "warning" | "error" | "default"> = {
  success: "success",
  warning: "warning",
  error: "error",
  neutral: "default",
};

interface StatusChipProps {
  label: string;
  tone: StatusTone;
}

export default function StatusChip({ label, tone }: StatusChipProps) {
  return (
    <Chip
      label={label}
      color={TONE_COLOR_MAP[tone]}
      size="small"
      variant="outlined"
      sx={{ fontWeight: 700, letterSpacing: "0.04em", fontSize: "0.6875rem" }}
    />
  );
}
