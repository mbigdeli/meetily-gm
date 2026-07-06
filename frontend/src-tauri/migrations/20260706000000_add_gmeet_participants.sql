-- Meetily-GM: Google Meet participant roster captured by the companion extension.
-- Captions are written straight into the `transcripts` table (speaker = real
-- participant name from Meet's live captions), so no separate captions table is
-- needed; this table stores the attendee list for display and summary context.
CREATE TABLE IF NOT EXISTS meeting_participants (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    meeting_id TEXT NOT NULL,
    name TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE(meeting_id, name),
    FOREIGN KEY (meeting_id) REFERENCES meetings(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_meeting_participants_meeting
    ON meeting_participants(meeting_id);
