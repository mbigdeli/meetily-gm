import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { LocalServiceJsonResult } from "../../shared/localServiceClient.js";
import type {
  CurrentMeetingSnapshot,
  RecordingAudioChunk,
  RecordingAudioInfo,
  RecordingListItem,
  RecordingReadiness,
  RecordingTranscript,
  RecordingsListResponse,
} from "../../shared/recordingsTypes.js";
import { sendChromeMessage } from "../hooks/useChromeMessage.js";
import { AUDIO_CHUNK_BYTES, base64ToBytes } from "./helpers.js";

type ResultResponse<T> =
  | { ok: true; result: LocalServiceJsonResult<T> }
  | { ok: false; error?: string; result?: LocalServiceJsonResult<T> };

type CurrentMeetingResponse =
  | { ok: true; currentMeeting: CurrentMeetingSnapshot }
  | { ok: false; error?: string };

export interface RecordingDetailState {
  item: RecordingListItem | null;
  transcript: RecordingTranscript | null;
  audioInfo: RecordingAudioInfo | null;
  audioUrl: string | null;
  loadingTranscript: boolean;
  loadingAudio: boolean;
  error: string | null;
}

const DEFAULT_DETAIL: RecordingDetailState = {
  item: null,
  transcript: null,
  audioInfo: null,
  audioUrl: null,
  loadingTranscript: false,
  loadingAudio: false,
  error: null,
};

function resultError<T>(response: ResultResponse<T>, fallback: string): string {
  if (!response.ok) {
    if (response.result && !response.result.ok) {
      return response.error ?? response.result.error;
    }
    return response.error ?? fallback;
  }
  if (!response.result.ok) {
    return response.result.error;
  }
  return fallback;
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(copy).set(bytes);
  return copy;
}

export function useRecordings() {
  const [currentMeeting, setCurrentMeeting] = useState<CurrentMeetingSnapshot | null>(null);
  const [items, setItems] = useState<RecordingListItem[]>([]);
  const [total, setTotal] = useState(0);
  const [query, setQuery] = useState("");
  const [stateFilter, setStateFilter] = useState<RecordingReadiness | "all">("all");
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(10);
  const [loadingList, setLoadingList] = useState(false);
  const [listError, setListError] = useState<string | null>(null);
  const [detail, setDetail] = useState<RecordingDetailState>(DEFAULT_DETAIL);
  const audioUrlRef = useRef<string | null>(null);

  const revokeAudioUrl = useCallback(() => {
    if (audioUrlRef.current) {
      URL.revokeObjectURL(audioUrlRef.current);
      audioUrlRef.current = null;
    }
  }, []);

  useEffect(() => revokeAudioUrl, [revokeAudioUrl]);

  const refreshCurrentMeeting = useCallback(async () => {
    const res = await sendChromeMessage<CurrentMeetingResponse>({
      type: "REQUEST_CURRENT_MEETING",
      payload: {},
    });
    if (res.ok) {
      setCurrentMeeting(res.currentMeeting);
    }
  }, []);

  const refreshList = useCallback(async () => {
    setLoadingList(true);
    setListError(null);
    try {
      const res = await sendChromeMessage<ResultResponse<RecordingsListResponse>>({
        type: "REQUEST_RECORDINGS_LIST",
        payload: {
          limit: pageSize,
          offset: page * pageSize,
          ...(query.trim() ? { query: query.trim() } : {}),
          ...(stateFilter !== "all" ? { state: stateFilter } : {}),
        },
      });
      if (!res.ok || !res.result?.ok) {
        setListError(resultError(res, "Could not load recordings."));
        return;
      }
      setItems(res.result.data.items);
      setTotal(res.result.data.total);
    } catch (e) {
      setListError(e instanceof Error ? e.message : "Could not load recordings.");
    } finally {
      setLoadingList(false);
    }
  }, [page, pageSize, query, stateFilter]);

  const refreshAll = useCallback(async () => {
    await Promise.all([refreshCurrentMeeting(), refreshList()]);
  }, [refreshCurrentMeeting, refreshList]);

  useEffect(() => {
    void refreshAll();
  }, [refreshAll]);

  const loadTranscript = useCallback(async (sessionId: string): Promise<RecordingTranscript | null> => {
    const res = await sendChromeMessage<ResultResponse<RecordingTranscript>>({
      type: "REQUEST_RECORDING_TRANSCRIPT",
      payload: { sessionId },
    });
    if (!res.ok || !res.result?.ok) {
      throw new Error(resultError(res, "Transcript is not available yet."));
    }
    return res.result.data;
  }, []);

  const loadAudio = useCallback(async (sessionId: string): Promise<{ info: RecordingAudioInfo; url: string | null }> => {
    const infoRes = await sendChromeMessage<ResultResponse<RecordingAudioInfo>>({
      type: "REQUEST_RECORDING_AUDIO_INFO",
      payload: { sessionId },
    });
    if (!infoRes.ok || !infoRes.result?.ok) {
      throw new Error(resultError(infoRes, "Audio is not available."));
    }
    const info = infoRes.result.data;
    if (!info.available || info.byte_length <= 0 || !info.mime_type) {
      return { info, url: null };
    }

    const chunks: Uint8Array[] = [];
    let offset = 0;
    while (offset < info.byte_length) {
      const length = Math.min(AUDIO_CHUNK_BYTES, info.byte_length - offset);
      const chunkRes = await sendChromeMessage<ResultResponse<RecordingAudioChunk>>({
        type: "REQUEST_RECORDING_AUDIO_CHUNK",
        payload: { sessionId, offset, length },
      });
      if (!chunkRes.ok || !chunkRes.result?.ok) {
        throw new Error(resultError(chunkRes, "Audio chunk load failed."));
      }
      const chunk = chunkRes.result.data;
      chunks.push(base64ToBytes(chunk.data_base64));
      offset += chunk.length;
      if (chunk.is_eof || chunk.length === 0) {
        break;
      }
    }

    const blob = new Blob(chunks.map(toArrayBuffer), {
      type: info.mime_type,
    });
    const url = URL.createObjectURL(blob);
    return { info, url };
  }, []);

  const selectRecording = useCallback(async (item: RecordingListItem) => {
    revokeAudioUrl();
    setDetail({
      ...DEFAULT_DETAIL,
      item,
      loadingTranscript: true,
      loadingAudio: true,
    });

    try {
      const [transcriptResult, audioResult] = await Promise.allSettled([
        loadTranscript(item.session_id),
        loadAudio(item.session_id),
      ]);

      let error: string | null = null;
      const transcript =
        transcriptResult.status === "fulfilled" ? transcriptResult.value : null;
      if (transcriptResult.status === "rejected") {
        error = transcriptResult.reason instanceof Error
          ? transcriptResult.reason.message
          : "Transcript is not available yet.";
      }

      let audioInfo: RecordingAudioInfo | null = null;
      let audioUrl: string | null = null;
      if (audioResult.status === "fulfilled") {
        audioInfo = audioResult.value.info;
        audioUrl = audioResult.value.url;
        audioUrlRef.current = audioUrl;
      } else if (!error) {
        error = audioResult.reason instanceof Error
          ? audioResult.reason.message
          : "Audio is not available yet.";
      }

      setDetail({
        item,
        transcript,
        audioInfo,
        audioUrl,
        loadingTranscript: false,
        loadingAudio: false,
        error,
      });
    } catch (e) {
      setDetail({
        ...DEFAULT_DETAIL,
        item,
        error: e instanceof Error ? e.message : "Recording load failed.",
      });
    }
  }, [loadAudio, loadTranscript, revokeAudioUrl]);

  const pageCount = useMemo(() => Math.max(1, Math.ceil(total / pageSize)), [pageSize, total]);

  return {
    currentMeeting,
    items,
    total,
    query,
    setQuery,
    stateFilter,
    setStateFilter,
    page,
    setPage,
    pageSize,
    setPageSize,
    pageCount,
    loadingList,
    listError,
    detail,
    refreshAll,
    selectRecording,
  };
}
