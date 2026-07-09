-- Meetings library page (doc 09 §3). Additive-only: star marker + duration.
-- No `priority` column (dropped per product decision). Backfill duration from
-- the transcript segments' max end time where available.
ALTER TABLE meetings ADD COLUMN starred INTEGER NOT NULL DEFAULT 0;
ALTER TABLE meetings ADD COLUMN duration_sec REAL;

CREATE INDEX IF NOT EXISTS idx_meetings_starred ON meetings(starred);

UPDATE meetings
SET duration_sec = (
    SELECT MAX(t.audio_end_time) FROM transcripts t WHERE t.meeting_id = meetings.id
)
WHERE duration_sec IS NULL;
