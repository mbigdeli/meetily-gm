import { useEffect, useRef } from "react";
import Box from "@mui/material/Box";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import type { TranscriptSegment } from "../../shared/recordingsTypes.js";
import { textDirection } from "./helpers.js";

interface TranscriptTimelineProps {
  segments: TranscriptSegment[];
  activeIndex: number;
  syncEnabled: boolean;
}

export default function TranscriptTimeline({ segments, activeIndex, syncEnabled }: TranscriptTimelineProps) {
  const activeRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (syncEnabled && activeRef.current) {
      activeRef.current.scrollIntoView({ block: "center", behavior: "smooth" });
    }
  }, [activeIndex, syncEnabled]);

  if (segments.length === 0) {
    return (
      <Typography color="text.secondary">
        Transcript preview will appear here when transcription is ready.
      </Typography>
    );
  }

  return (
    <Stack spacing={1} sx={{ maxHeight: 420, overflow: "auto", pr: 1 }}>
      {segments.map((segment, index) => {
        const active = index === activeIndex;
        return (
          <Card
            key={`${segment.start_sec}-${index}`}
            ref={active ? activeRef : undefined}
            variant="outlined"
            sx={{
              bgcolor: active ? "primary.light" : "background.paper",
              borderColor: active ? "primary.main" : "divider",
            }}
          >
            <CardContent sx={{ py: 1.5, "&:last-child": { pb: 1.5 } }}>
              <Stack direction="row" spacing={1.5} alignItems="flex-start">
                <Typography variant="body2" color="text.secondary" sx={{ minWidth: 52 }}>
                  {formatSeconds(segment.start_sec)}
                </Typography>
                <Box sx={{ flex: 1 }}>
                  <Typography variant="body2" color="text.secondary">
                    {segment.speaker_name ?? segment.speaker_id ?? "Speaker"}
                  </Typography>
                  <Typography dir={textDirection(segment.language, segment.text)} sx={{ whiteSpace: "pre-wrap" }}>
                    {segment.text}
                  </Typography>
                </Box>
              </Stack>
            </CardContent>
          </Card>
        );
      })}
    </Stack>
  );
}

function formatSeconds(value: number): string {
  const seconds = Math.max(0, Math.floor(value));
  const min = Math.floor(seconds / 60);
  const sec = seconds % 60;
  return `${min}:${sec.toString().padStart(2, "0")}`;
}
