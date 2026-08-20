import { create } from "zustand";
import { toast } from "sonner";

export type TtsStatus = "idle" | "loading" | "playing" | "paused";

interface TtsPlaybackState {
  status: TtsStatus;
  activeMessageId: string | null;
  play: (messageId: string, text: string, errorMessage: string) => Promise<void>;
  pause: () => void;
  resume: (errorMessage: string) => Promise<void>;
  stop: () => void;
}

const MIME = "audio/mpeg";

// Module-level playback state: only one message reads aloud at a time, and a
// stale in-flight fetch can never start playback. The audio runs through a
// single HTMLAudioElement; for streaming we append MP3 to a MediaSource so it
// plays as it arrives, and fall back to buffering the whole response when
// MediaSource is unavailable.
let requestId = 0;
let abortController: AbortController | null = null;
let audio: HTMLAudioElement | null = null;
let mediaSource: MediaSource | null = null;
let sourceBuffer: SourceBuffer | null = null;
let pending: Uint8Array<ArrayBuffer>[] = [];
let fetchDone = false;
let objectUrl: string | null = null;

function supportsMse(): boolean {
  return typeof MediaSource !== "undefined" && MediaSource.isTypeSupported(MIME);
}

function release() {
  requestId += 1; // invalidates any in-flight fetch
  abortController?.abort();
  abortController = null;
  if (audio) {
    audio.pause();
    audio.onplaying = null;
    audio.onended = null;
    audio.src = "";
    audio = null;
  }
  mediaSource = null;
  sourceBuffer = null;
  pending = [];
  fetchDone = false;
  if (objectUrl) {
    URL.revokeObjectURL(objectUrl);
    objectUrl = null;
  }
}

function appendPending(id: number) {
  if (!sourceBuffer || sourceBuffer.updating) return;
  const chunk = pending.shift();
  if (chunk) {
    try {
      sourceBuffer.appendBuffer(chunk);
    } catch {
      // A quota/append error — the audio just ends early.
    }
    return;
  }
  if (fetchDone && mediaSource && mediaSource.readyState === "open") {
    try {
      mediaSource.endOfStream();
    } catch {
      // Already ended.
    }
  }
}

export const useTtsStore = create<TtsPlaybackState>((set) => ({
  status: "idle",
  activeMessageId: null,

  play: async (messageId, text, errorMessage) => {
    release();
    const controller = new AbortController();
    abortController = controller;
    const id = requestId;
    set({ status: "loading", activeMessageId: messageId });

    // Build the player synchronously inside the click gesture so autoplay
    // policy lets playback start even after awaiting the fetch.
    const el = new Audio();
    audio = el;
    el.preload = "auto";
    el.onplaying = () => {
      if (id === requestId) set({ status: "playing" });
    };
    el.onended = () => {
      if (id !== requestId) return;
      release();
      set({ status: "idle", activeMessageId: null });
    };

    const useMse = supportsMse();
    if (useMse) {
      const ms = new MediaSource();
      mediaSource = ms;
      objectUrl = URL.createObjectURL(ms);
      el.src = objectUrl;
      ms.addEventListener(
        "sourceopen",
        () => {
          if (id !== requestId) return;
          sourceBuffer = ms.addSourceBuffer(MIME);
          sourceBuffer.addEventListener("updateend", () => {
            if (id === requestId) appendPending(id);
          });
          appendPending(id);
        },
        { once: true },
      );
    }
    void el.play().catch(() => {}); // capture the user gesture

    try {
      const response = await fetch("/api/tts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, stream: true }),
        signal: controller.signal,
      });
      if (id !== requestId) return; // superseded by another play

      if (!response.ok) {
        let detail: string | null = null;
        try {
          const data = await response.json();
          if (typeof data?.detail === "string") detail = data.detail;
        } catch {
          // Non-JSON error body.
        }
        throw new Error(detail || errorMessage);
      }
      if (!response.body) throw new Error(errorMessage);

      const reader = response.body.getReader();
      const parts: Uint8Array<ArrayBuffer>[] = [];
      let received = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        if (!value) continue;
        if (id !== requestId) return;
        const chunk = value as Uint8Array<ArrayBuffer>;
        received += chunk.length;
        if (useMse) {
          pending.push(chunk);
          appendPending(id);
        } else {
          parts.push(chunk);
        }
      }

      fetchDone = true;
      if (id !== requestId) return;
      if (received === 0) throw new Error(errorMessage); // empty stream

      if (useMse) {
        appendPending(id);
      } else {
        const blob = new Blob(parts, { type: MIME });
        objectUrl = URL.createObjectURL(blob);
        el.src = objectUrl;
        await el.play();
      }
    } catch (error) {
      if (id !== requestId) return;
      release();
      set({ status: "idle", activeMessageId: null });
      toast.error(error instanceof Error ? error.message : errorMessage);
    }
  },

  pause: () => {
    if (!audio) return;
    audio.pause();
    set({ status: "paused" });
  },

  resume: async (errorMessage) => {
    if (!audio) return;
    try {
      await audio.play();
      set({ status: "playing" });
    } catch {
      release();
      set({ status: "idle", activeMessageId: null });
      toast.error(errorMessage);
    }
  },

  stop: () => {
    release();
    set({ status: "idle", activeMessageId: null });
  },
}));
