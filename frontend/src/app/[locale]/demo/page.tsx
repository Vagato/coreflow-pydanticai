import Link from "next/link";
import { Play } from "lucide-react";

interface DemoListItem {
  id: string;
  title: string | null;
  message_count: number;
  preview: string | null;
  created_at: string;
}

async function fetchDemos(): Promise<DemoListItem[]> {
  const baseUrl = process.env.BACKEND_URL || "http://localhost:8000";
  try {
    const res = await fetch(`${baseUrl}/api/v1/demos`, { cache: "no-store" });
    if (!res.ok) return [];
    const data = await res.json();
    return Array.isArray(data?.items) ? data.items : [];
  } catch {
    return [];
  }
}

function WaveTrace({ seed, count }: { seed: string; count: number }) {
  const n = Math.min(count, 22);
  const stripped = seed.replace(/-/g, "") || "abcdef";
  return (
    <div className="flex h-7 items-end gap-[2px]">
      {Array.from({ length: n }, (_, i) => {
        const c = stripped.charCodeAt(i % stripped.length) || 65;
        const h = 20 + ((c * 17 + i * 31) % 65);
        const barStyle = {
          height: `${h}%`,
          width: "3px",
          borderRadius: "9999px",
          background: "var(--color-brand)",
          opacity: i % 2 === 0 ? 0.72 : 0.28,
        };
        return <div key={i} style={barStyle} />;
      })}
    </div>
  );
}

const glowRight = {
  background: "radial-gradient(circle, oklch(65% 0.2 250 / 0.11) 0%, transparent 70%)",
};
const glowLeft = {
  background: "radial-gradient(circle, oklch(65% 0.2 250 / 0.06) 0%, transparent 70%)",
};
const cardHoverGradient = {
  background: "radial-gradient(ellipse at top left, oklch(65% 0.2 250 / 0.07) 0%, transparent 55%)",
};

export default async function DemoGalleryPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const demos = await fetchDemos();

  return (
    <div className="theme-dark bg-background min-h-screen">
      {/* Hero */}
      <div className="relative overflow-hidden px-4 pt-24 pb-20 sm:pt-32">
        {/* Ambient glow blobs */}
        <div
          aria-hidden
          className="pointer-events-none absolute -top-40 -right-40 h-[560px] w-[560px] rounded-full"
          style={glowRight}
        />
        <div
          aria-hidden
          className="pointer-events-none absolute top-1/2 -left-24 h-[380px] w-[380px] rounded-full"
          style={glowLeft}
        />

        <div className="relative mx-auto max-w-5xl">
          {/* Live indicator */}
          <div className="text-brand mb-6 inline-flex items-center gap-2 font-mono text-xs font-medium tracking-[0.18em] uppercase">
            <span className="relative flex h-1.5 w-1.5">
              <span className="bg-brand absolute inline-flex h-full w-full animate-ping rounded-full opacity-60" />
              <span className="bg-brand relative inline-flex h-1.5 w-1.5 rounded-full" />
            </span>
            Live sessions · {demos.length} available
          </div>

          <h1 className="font-display text-foreground mb-6 max-w-3xl text-5xl leading-[1.06] font-bold tracking-tight sm:text-6xl">
            Watch the AI
            <br />
            work in real time.
          </h1>
          <p className="text-muted-foreground max-w-xl text-lg leading-relaxed">
            Every tool call, every decision — replayed frame by frame, exactly as it happened.
          </p>
        </div>
      </div>

      {/* Cards */}
      <div className="mx-auto max-w-5xl px-4 pb-24">
        {demos.length === 0 ? (
          <div className="border-border rounded-2xl border border-dashed py-20 text-center">
            <p className="text-muted-foreground text-sm">
              No demos available yet. Check back soon.
            </p>
          </div>
        ) : (
          <div className="grid gap-5 sm:grid-cols-2">
            {demos.map((demo) => (
              <Link
                key={demo.id}
                href={`/${locale}/demo/${demo.id}`}
                className="group border-border bg-card hover:border-brand/30 relative flex flex-col overflow-hidden rounded-2xl border p-6 transition-all duration-300"
              >
                {/* Hover gradient reveal */}
                <div
                  className="pointer-events-none absolute inset-0 rounded-2xl opacity-0 transition-opacity duration-300 group-hover:opacity-100"
                  style={cardHoverGradient}
                />

                {/* Wave trace + turn count */}
                <div className="relative mb-5 flex items-end justify-between">
                  <WaveTrace seed={demo.id} count={demo.message_count} />
                  <span className="text-muted-foreground font-mono text-[10px] tabular-nums">
                    {demo.message_count} turns
                  </span>
                </div>

                {/* Title */}
                <h2 className="font-display text-foreground relative mb-3 text-xl leading-tight font-bold">
                  {demo.title || "Agent session"}
                </h2>

                {/* Preview */}
                {demo.preview && (
                  <p className="text-muted-foreground relative line-clamp-2 text-sm leading-relaxed">
                    &ldquo;{demo.preview}&rdquo;
                  </p>
                )}

                {/* CTA */}
                <div className="relative mt-auto flex items-center justify-end pt-6">
                  <span className="text-brand inline-flex items-center gap-1.5 text-sm font-medium transition-transform duration-200 group-hover:translate-x-0.5">
                    Watch replay
                    <Play className="h-3.5 w-3.5 fill-current" />
                  </span>
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
