import Alert from "@mui/material/Alert";
import type { BannerState } from "../hooks/useSettings.js";

interface BannerProps {
  banner: BannerState;
  onClose: () => void;
}

export default function Banner({ banner, onClose }: BannerProps) {
  if (!banner) return null;

  return (
    <Alert
      severity={banner.severity}
      onClose={onClose}
      sx={{ mt: 2, borderRadius: 2 }}
    >
      {banner.message}
      {banner.listItems && banner.listItems.length > 0 && (
        <ul style={{ margin: "8px 0 0 20px", padding: 0 }}>
          {banner.listItems.map((item, i) => (
            <li key={i}>{item}</li>
          ))}
        </ul>
      )}
    </Alert>
  );
}
