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

// Module-level audio singleton + request guard: only one message reads aloud
// at a time, and a stale in-flight fetch can never start playback.
let requestId = 0;
let audio: HTMLAudioElement | null = null;
let audioUrl: string | null = null;
let abortController: AbortController | null = null;

function release() {
  requestId += 1; // invalidates any in-flight fetch
  abortController?.abort();
  abortController = null;
  if (audio) {
    audio.pause();
    audio.src = "";
    audio = null;
  }
  if (audioUrl) {
    URL.revokeObjectURL(audioUrl);
    audioUrl = null;
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
    try {
      const response = await fetch("/api/tts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
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

      const blob = await response.blob();
      if (id !== requestId) return;

      const url = URL.createObjectURL(blob);
      const nextAudio = new Audio(url);
      audio = nextAudio;
      audioUrl = url;

      nextAudio.onended = () => {
        if (id === requestId) {
          release();
          set({ status: "idle", activeMessageId: null });
        }
      };
      nextAudio.onerror = () => {
        if (id === requestId) {
          release();
          set({ status: "idle", activeMessageId: null });
          toast.error(errorMessage);
        }
      };

      await nextAudio.play();
      if (id === requestId) set({ status: "playing" });
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
      await audio.play(); // resumes from the current position
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
