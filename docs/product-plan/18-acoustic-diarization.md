# 18 — Acoustic Speaker Diarization (local, non-Meet)

## Goal
Answer "who spoke when?" for meetings **without** Google Meet captions
(in-person, phone, Zoom, plain mic recordings) from the **recorded audio
alone**. Google Meet keeps its own path (real speaker names via captions,
doc 15 + `gmeet_ingest`); this fills the gap everywhere else with generic
`Speaker 1 / Speaker 2 …` labels.

## Architecture decision
**ONNX-in-Rust on the app's existing `ort` runtime** (the same crate the
Parakeet engine already links — no Python, no second runtime, one clean
binary). We write the clustering ourselves rather than pull a bundled
pipeline (`sherpa-rs` ships its own ONNX runtime; `pyannote-rs` uses Burn +
`.bpk`, not `ort`). Chosen knowingly for a single-runtime binary and full
control over the speaker-grouping quality.

Pipeline (all local, post-recording):
```
audio.mp4 ──ffmpeg──▶ 16 kHz mono f32
   │
   ├─▶ pyannote segmentation (ONNX)  → per-frame speaker-activity, sliding window
   │        └─ binarize → speaker-active regions
   ├─▶ speaker embedding (ONNX, CAM++) per region → embedding vectors
   ├─▶ agglomerative clustering (cosine, average-linkage) → speaker labels
   ├─▶ merge windows → speaker turns
   └─▶ assign each Whisper transcript segment the max-overlap turn's speaker
            └─ write meeting_diarized_segments (same table gmeet fusion uses)
```

## Increments
1. **Pure core (this PR)** — clustering, turn building, transcript labelling.
   Model-independent, fully unit-tested. Plus the model catalog + design doc.
2. **ONNX inference** — `ort` sessions for segmentation + embedding; audio
   decode to 16 kHz mono; sliding-window + binarization. Model download on
   demand (mirror `parakeet_engine`). *Pins the exact sherpa-onnx asset URLs.*
3. **Wiring** — run on the `recording-saved` event for non-gmeet meetings
   (behind a settings flag until quality is validated); background job so it
   never blocks the UI; progress event.
4. **UI** — Settings toggle + model download card; per-turn speaker chips in
   the transcript; rename `Speaker N` inline.

## Why generic labels are the right scope
Acoustic diarization cannot know real names (no roster). Meet already gives
real names; everywhere else, `Speaker N` that the user renames once is the
honest, achievable target. Naming from a voice fingerprint library is
explicitly out of scope.

## Notes
- Reuses `meeting_diarized_segments` (doc `20260707000000`) — for non-Meet
  there is no caption text, so segments carry the Whisper text + the acoustic
  speaker label.
- 16 kHz mono is the models' native rate; recordings are 48 kHz → resample.
- Model files are ONNX from sherpa-onnx release assets (redistributed
  pyannote-segmentation-3.0 + 3D-Speaker CAM++), no PyTorch.
