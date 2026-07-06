-- Meetily-GM: Google Meet live-recording + AI diarization.
--
-- During a Meet, the extension streams Meet's live captions (which carry real
-- speaker names) here, keyed by a gmeet_session_id (the SQLite meeting_id does
-- not exist until stop+save). After recording stops and the Whisper transcript
-- is saved, the backend AI-merges the Whisper words with these named captions
-- into meeting_diarized_segments (text + real speaker name).

CREATE TABLE IF NOT EXISTS gmeet_captions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    gmeet_session_id TEXT NOT NULL,
    speaker TEXT,
    text TEXT NOT NULL,
    ts_ms INTEGER,
    created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_gmeet_captions_session
    ON gmeet_captions(gmeet_session_id);

CREATE TABLE IF NOT EXISTS meeting_diarized_segments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    meeting_id TEXT NOT NULL,
    seq INTEGER NOT NULL,
    start_sec REAL,
    end_sec REAL,
    speaker_name TEXT,
    language TEXT,
    confidence REAL,
    text TEXT NOT NULL,
    FOREIGN KEY (meeting_id) REFERENCES meetings(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_meeting_diarized_meeting
    ON meeting_diarized_segments(meeting_id);
