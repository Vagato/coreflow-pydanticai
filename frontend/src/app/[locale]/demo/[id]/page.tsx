import Link from "next/link";
import { ArrowLeft, MessageSquare } from "lucide-react";
import { DemoReplay } from "@/components/demo/demo-replay";
import type { RawMessage } from "@/lib/conversation-to-chat";

interface DemoConversation {
  id: string;
  title: string | null;
  messages: RawMessage[];
}

async function fetchDemo(id: string): Promise<DemoConversation | null> {
  if (!/^[0-9a-fA-F-]{36}$/.test(id)) return null;
  const baseUrl = process.env.BACKEND_URL || "http://localhost:8000";
  try {
    const res = await fetch(`${baseUrl}/api/v1/demos/${id}`, { cache: "no-store" });
    if (!res.ok) return null;
    return res.json();
  } catch {
    return null;
  }
}

export default async function DemoDetailPage({
  params,
}: {
  params: Promise<{ id: string; locale: string }>;
}) {
  const { id, locale } = await params;
  const demo = await fetchDemo(id);

  if (!demo) {
    return (
      <div className="bg-background flex min-h-screen items-center justify-center px-4">
        <div className="text-center">
          <MessageSquare className="text-muted-foreground mx-auto h-12 w-12" />
          <h1 className="text-foreground mt-4 text-xl font-semibold">Demo not found</h1>
          <p className="text-muted-foreground mt-2 text-sm">
            This demo may have been removed or is no longer public.
          </p>
          <Link
            href={`/${locale}/demo`}
            className="text-brand mt-6 inline-flex items-center gap-1.5 text-sm font-medium hover:underline"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to all demos
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-background flex h-screen flex-col overflow-hidden">
      <header className="bg-background/90 border-border sticky top-0 z-20 border-b backdrop-blur">
        <div className="flex h-14 items-center gap-4 px-6">
          <Link
            href={`/${locale}/demo`}
            className="text-muted-foreground hover:text-foreground inline-flex shrink-0 items-center gap-1.5 text-sm font-medium transition-colors"
          >
            <ArrowLeft className="h-4 w-4" />
            Demos
          </Link>
          <span className="text-border select-none">·</span>
          <h1 className="text-foreground/70 truncate text-sm font-medium">
            {demo.title || "Agent session"}
          </h1>
        </div>
      </header>

      <DemoReplay rawMessages={demo.messages || []} />
    </div>
  );
}
