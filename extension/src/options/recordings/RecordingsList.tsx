import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Card from "@mui/material/Card";
import CardActionArea from "@mui/material/CardActionArea";
import CardContent from "@mui/material/CardContent";
import CircularProgress from "@mui/material/CircularProgress";
import FormControl from "@mui/material/FormControl";
import InputLabel from "@mui/material/InputLabel";
import MenuItem from "@mui/material/MenuItem";
import Pagination from "@mui/material/Pagination";
import Select from "@mui/material/Select";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import StatusChip from "../components/StatusChip.js";
import type { RecordingListItem, RecordingReadiness } from "../../shared/recordingsTypes.js";
import { formatDateTime, readinessLabel, readinessTone } from "./helpers.js";

interface RecordingsListProps {
  items: RecordingListItem[];
  selectedSessionId: string | null;
  total: number;
  page: number;
  pageCount: number;
  query: string;
  stateFilter: RecordingReadiness | "all";
  loading: boolean;
  error: string | null;
  onQueryChange: (query: string) => void;
  onStateFilterChange: (state: RecordingReadiness | "all") => void;
  onPageChange: (page: number) => void;
  onRefresh: () => void;
  onSelect: (item: RecordingListItem) => void;
}

const FILTERS: Array<{ value: RecordingReadiness | "all"; label: string }> = [
  { value: "all", label: "All statuses" },
  { value: "recording", label: "Recording" },
  { value: "paused", label: "Paused" },
  { value: "finalizing", label: "Processing" },
  { value: "ready", label: "Ready" },
  { value: "audio_only", label: "Audio only" },
  { value: "transcript_only", label: "Transcript only" },
  { value: "failed", label: "Failed" },
  { value: "missing", label: "Missing" },
];

export default function RecordingsList({
  items,
  selectedSessionId,
  total,
  page,
  pageCount,
  query,
  stateFilter,
  loading,
  error,
  onQueryChange,
  onStateFilterChange,
  onPageChange,
  onRefresh,
  onSelect,
}: RecordingsListProps) {
  return (
    <Card>
      <CardContent>
        <Stack spacing={2}>
          <Stack direction={{ xs: "column", md: "row" }} spacing={2} alignItems={{ md: "center" }}>
            <Box sx={{ flex: 1 }}>
              <Typography variant="overline" color="primary">
                Recordings library
              </Typography>
              <Typography variant="h2">Meetings and recordings</Typography>
              <Typography variant="body2" color="text.secondary">
                {total} saved session{total === 1 ? "" : "s"}
              </Typography>
            </Box>
            <Button variant="outlined" onClick={onRefresh} disabled={loading}>
              Refresh
            </Button>
          </Stack>

          <Stack direction={{ xs: "column", md: "row" }} spacing={2}>
            <TextField
              label="Search title, code, URL, or session id"
              value={query}
              onChange={(e) => {
                onPageChange(0);
                onQueryChange(e.target.value);
              }}
            />
            <FormControl size="small" sx={{ minWidth: 180 }}>
              <InputLabel id="recording-state-filter-label">Status</InputLabel>
              <Select
                labelId="recording-state-filter-label"
                label="Status"
                value={stateFilter}
                onChange={(e) => {
                  onPageChange(0);
                  onStateFilterChange(e.target.value as RecordingReadiness | "all");
                }}
              >
                {FILTERS.map((filter) => (
                  <MenuItem key={filter.value} value={filter.value}>
                    {filter.label}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
          </Stack>

          {loading ? (
            <Stack alignItems="center" sx={{ py: 4 }}>
              <CircularProgress size={28} />
            </Stack>
          ) : error ? (
            <Typography color="error">{error}</Typography>
          ) : items.length === 0 ? (
            <Typography color="text.secondary" sx={{ py: 3 }}>
              No recordings match this view yet.
            </Typography>
          ) : (
            <Stack spacing={1.5}>
              {items.map((item) => (
                <Card
                  key={item.session_id}
                  variant="outlined"
                  sx={{
                    borderColor: item.session_id === selectedSessionId ? "primary.main" : "divider",
                    bgcolor: item.session_id === selectedSessionId ? "action.hover" : "background.paper",
                  }}
                >
                  <CardActionArea onClick={() => onSelect(item)}>
                    <CardContent>
                      <Stack direction={{ xs: "column", md: "row" }} spacing={1.5} justifyContent="space-between">
                        <Box>
                          <Typography variant="h3">
                            {item.meeting_title || item.meeting_code || "Untitled meeting"}
                          </Typography>
                          <Typography variant="body2" color="text.secondary">
                            {formatDateTime(item.started_at)}
                          </Typography>
                          <Typography variant="body2" color="text.secondary">
                            {item.current_stage} · {item.overall_state}
                          </Typography>
                        </Box>
                        <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap">
                          <StatusChip label={readinessLabel(item.readiness)} tone={readinessTone(item.readiness)} />
                          {item.last_error ? <StatusChip label="Needs attention" tone="error" /> : null}
                        </Stack>
                      </Stack>
                    </CardContent>
                  </CardActionArea>
                </Card>
              ))}
            </Stack>
          )}

          <Pagination
            count={pageCount}
            page={page + 1}
            onChange={(_, value) => onPageChange(value - 1)}
            disabled={loading}
          />
        </Stack>
      </CardContent>
    </Card>
  );
}
