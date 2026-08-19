"use client";

import { useTranslations } from "next-intl";
import { Loader2, Pause, Play, Square, Volume2 } from "lucide-react";

import { cn } from "@/lib/utils";
import { useTtsStore } from "@/stores";

const actionButtonClasses =
  "bg-muted hover:bg-muted/80 text-foreground/70 hover:text-foreground inline-flex h-6 w-6 items-center justify-center rounded-md transition-colors";

interface ReadAloudButtonProps {
  messageId: string;
  text: string;
  className?: string;
}

/**
 * Read-aloud control for an assistant message.
 * Idle: a single speaker icon (revealed on hover). While this message owns the
 * playback it expands into pause/play + stop controls that stay visible.
 */
export function ReadAloudButton({ messageId, text, className }: ReadAloudButtonProps) {
  const t = useTranslations("chat");
  const status = useTtsStore((s) => s.status);
  const isActive = useTtsStore((s) => s.activeMessageId === messageId);
  const play = useTtsStore((s) => s.play);
  const pause = useTtsStore((s) => s.pause);
  const resume = useTtsStore((s) => s.resume);
  const stop = useTtsStore((s) => s.stop);

  if (isActive && (status === "playing" || status === "paused")) {
    return (
      <span className="flex items-center gap-2">
        {status === "playing" ? (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              pause();
            }}
            title={t("pauseReading")}
            aria-label={t("pauseReading")}
            className={cn(actionButtonClasses, "sm:opacity-100")}
          >
            <Pause className="h-3 w-3" aria-hidden />
          </button>
        ) : (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              void resume(t("ttsFailed"));
            }}
            title={t("resumeReading")}
            aria-label={t("resumeReading")}
            className={cn(actionButtonClasses, "sm:opacity-100")}
          >
            <Play className="h-3 w-3" aria-hidden />
          </button>
        )}
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            stop();
          }}
          title={t("stopReading")}
          aria-label={t("stopReading")}
          className={cn(actionButtonClasses, "sm:opacity-100")}
        >
          <Square className="h-3 w-3" aria-hidden />
        </button>
      </span>
    );
  }

  const loading = isActive && status === "loading";

  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        if (loading) return;
        void play(messageId, text, t("ttsFailed"));
      }}
      title={t("readAloud")}
      aria-label={t("readAloud")}
      className={cn(
        actionButtonClasses,
        "sm:opacity-0 sm:group-hover:opacity-100",
        loading && "sm:opacity-100",
        className,
      )}
    >
      {loading ? (
        <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
      ) : (
        <Volume2 className="h-3 w-3" aria-hidden />
      )}
    </button>
  );
}
