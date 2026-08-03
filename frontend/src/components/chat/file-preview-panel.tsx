"use client";

import { useCallback, useEffect, useState } from "react";
import { Download, ExternalLink, X } from "lucide-react";

import { useFilePreviewStore } from "@/stores";
import { getFileUrl } from "@/lib/file-api";
import { cn } from "@/lib/utils";
import { FilePreviewCard, extOf, iconFor, previewKind } from "./file-preview-card";

const DEFAULT_WIDTH = 480;
const MIN_WIDTH = 320;
const MAX_WIDTH = 1100;
const STORAGE_KEY = "filePreviewPanelWidth";

/**
 * Right-hand sidebar that previews the file currently selected in the chat.
 * Switches viewer based on MIME type / extension; the user can drag the left
 * edge to resize, and the chosen width persists across sessions.
 */
export function FilePreviewPanel() {
  const file = useFilePreviewStore((s) => s.file);
  const close = useFilePreviewStore((s) => s.close);

  const [width, setWidth] = useState<number>(DEFAULT_WIDTH);
  const [isDragging, setIsDragging] = useState(false);

  useEffect(() => {
    const stored = typeof window !== "undefined" ? localStorage.getItem(STORAGE_KEY) : null;
    if (stored) {
      const n = parseInt(stored, 10);
      if (Number.isFinite(n)) setWidth(clamp(n, MIN_WIDTH, MAX_WIDTH));
    }
  }, []);

  const onMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  useEffect(() => {
    if (!isDragging) return;
    const onMove = (e: MouseEvent) => {
      // Width = distance from cursor to right edge of viewport.
      const next = clamp(window.innerWidth - e.clientX, MIN_WIDTH, MAX_WIDTH);
      setWidth(next);
    };
    const onUp = () => {
      setIsDragging(false);
      try {
        localStorage.setItem(STORAGE_KEY, String(width));
      } catch {
        /* private mode / quota — drop persistence silently */
      }
    };
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [isDragging, width]);

  if (!file) return null;

  const inlineUrl = getFileUrl(file.id);
  const downloadUrl = `${inlineUrl}?disposition=attachment`;
  const ext = extOf(file.filename);
  const kind = previewKind(file.mime_type, ext);
  const KindIcon = iconFor(kind);

  const header = (
    <header className="border-foreground/10 flex shrink-0 items-center gap-2 border-b px-3 py-2.5 sm:py-2">
      <span className="bg-foreground/8 text-foreground/65 flex h-7 w-7 shrink-0 items-center justify-center rounded-md">
        <KindIcon className="h-3.5 w-3.5" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-foreground truncate text-sm font-medium" title={file.filename}>
          {file.filename}
        </p>
        <p className="text-foreground/50 truncate font-mono text-[10px] tracking-wider uppercase">
          {ext ?? file.mime_type ?? "file"}
        </p>
      </div>
      <a
        href={inlineUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="text-foreground/55 hover:bg-foreground/5 hover:text-foreground inline-flex h-8 w-8 items-center justify-center rounded-md transition-colors sm:h-7 sm:w-7"
        title="Open in new tab"
      >
        <ExternalLink className="h-3.5 w-3.5" />
      </a>
      <a
        href={downloadUrl}
        className="text-foreground/55 hover:bg-foreground/5 hover:text-foreground inline-flex h-8 w-8 items-center justify-center rounded-md transition-colors sm:h-7 sm:w-7"
        title="Download"
      >
        <Download className="h-3.5 w-3.5" />
      </a>
      <button
        type="button"
        onClick={close}
        className="text-foreground/55 hover:bg-foreground/5 hover:text-foreground inline-flex h-8 w-8 items-center justify-center rounded-md transition-colors sm:h-7 sm:w-7"
        aria-label="Close preview"
        title="Close"
      >
        <X className="h-4 w-4" />
      </button>
    </header>
  );

  const viewer = (
    <div className="flex min-h-0 flex-1 flex-col">
      <FilePreviewCard
        kind={kind}
        url={inlineUrl}
        downloadUrl={downloadUrl}
        filename={file.filename}
        ext={ext}
      />
    </div>
  );

  return (
    <>
      {/* Desktop: resizable side panel */}
      <aside
        className="border-foreground/10 bg-card relative hidden h-full max-w-full shrink-0 flex-col border-l lg:flex"
        style={{ width: `${width}px` }}
        aria-label="File preview"
      >
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize file preview"
          onMouseDown={onMouseDown}
          className={cn(
            "group absolute top-0 left-0 z-20 h-full w-1.5 -translate-x-1/2 cursor-col-resize",
            isDragging && "bg-foreground/20",
          )}
        >
          <div className="bg-foreground/0 group-hover:bg-foreground/15 absolute top-1/2 left-1/2 h-12 w-1 -translate-x-1/2 -translate-y-1/2 rounded-full transition-colors" />
        </div>
        {header}
        {viewer}
      </aside>

      {/* Mobile: bottom sheet */}
      <div className="fixed inset-0 z-50 lg:hidden">
        <div
          className="bg-background/60 absolute inset-0 backdrop-blur-sm"
          onClick={close}
          aria-hidden
        />
        <div className="bg-background border-border absolute inset-x-0 bottom-0 flex max-h-[75vh] flex-col rounded-t-2xl border-t shadow-2xl">
          <div className="flex justify-center pt-2 pb-1">
            <span aria-hidden className="bg-foreground/20 h-1 w-10 rounded-full" />
          </div>
          {header}
          {viewer}
        </div>
      </div>
    </>
  );
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}
