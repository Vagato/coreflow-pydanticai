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

const SAMPLE_RATE = 24000;
// Schedule incoming PCM in ~0.5s slices so playback starts as soon as the
// first bytes arrive instead of waiting for a whole chunk.
const SCHEDULE_SLICE = SAMPLE_RATE / 2;

// Module-level playback state: only one message reads aloud at a time, and a
// stale in-flight fetch can never start playback. Audio runs on an
// AudioContext timeline — suspend()/resume() give pause/resume for free,
// since the timeline freezes while suspended.
let requestId = 0;
let abortController: AbortController | null = null;
let audioContext: AudioContext | null = null;
let nextStartTime = 0;
let scheduledCount = 0;
let playedCount = 0;
let fetchDone = false;

function release() {
  requestId += 1; // invalidates any in-flight fetch
  abortController?.abort();
  abortController = null;
  if (audioContext) {
    void audioContext.close().catch(() => {});
    audioContext = null;
  }
  nextStartTime = 0;
  scheduledCount = 0;
  playedCount = 0;
  fetchDone = false;
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

    // Create the AudioContext synchronously inside the click gesture so the
    // autoplay policy lets us resume it even after awaiting the fetch.
    const Ctx =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext;
    const ctx = new Ctx({ sampleRate: SAMPLE_RATE });
    audioContext = ctx;
    void ctx.resume();

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

      const finishIfComplete = () => {
        if (fetchDone && scheduledCount > 0 && playedCount >= scheduledCount) {
          release();
          set({ status: "idle", activeMessageId: null });
        }
      };

      const schedulePcm = (pcm: Int16Array) => {
        if (id !== requestId || pcm.length === 0) return;
        const buffer = ctx.createBuffer(1, pcm.length, SAMPLE_RATE);
        const channel = buffer.getChannelData(0);
        for (let i = 0; i < pcm.length; i += 1) {
          channel[i] = (pcm[i] ?? 0) / 32768;
        }
        const source = ctx.createBufferSource();
        source.buffer = buffer;
        source.connect(ctx.destination);
        const start = Math.max(nextStartTime, ctx.currentTime + 0.05);
        source.start(start);
        nextStartTime = start + buffer.duration;
        scheduledCount += 1;
        source.onended = () => {
          if (id !== requestId) return;
          playedCount += 1;
          finishIfComplete();
        };
        if (useTtsStore.getState().status === "loading") {
          set({ status: "playing" });
        }
      };

      const reader = response.body.getReader();
      let carry = new Uint8Array(0);
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        if (!value) continue;
        if (id !== requestId) return;

        const bytes = new Uint8Array(carry.length + value.length);
        bytes.set(carry, 0);
        bytes.set(value, carry.length);
        const usable = bytes.length - (bytes.length % 2);
        const pcm16 = new Int16Array(bytes.buffer.slice(0, usable));
        carry = bytes.slice(usable);

        for (let offset = 0; offset < pcm16.length; offset += SCHEDULE_SLICE) {
          schedulePcm(pcm16.subarray(offset, Math.min(offset + SCHEDULE_SLICE, pcm16.length)));
        }
      }

      fetchDone = true;
      if (id !== requestId) return;
      if (scheduledCount === 0) throw new Error(errorMessage); // empty stream
      finishIfComplete();
    } catch (error) {
      if (id !== requestId) return;
      release();
      set({ status: "idle", activeMessageId: null });
      toast.error(error instanceof Error ? error.message : errorMessage);
    }
  },

  pause: () => {
    if (!audioContext) return;
    void audioContext.suspend(); // freezes the timeline — resume continues here
    set({ status: "paused" });
  },

  resume: async (errorMessage) => {
    if (!audioContext) return;
    try {
      await audioContext.resume();
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
