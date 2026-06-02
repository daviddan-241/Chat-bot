"use client";
import { useQuery } from "@tanstack/react-query";
import { Menu, FileCode2, Code2, FileText, Eye, FileJson } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { artifactsApi } from "@/lib/api";
import { useWorkspaceStore } from "@/stores/workspace-store";
import { useArtifactStore } from "@/stores/artifact-store";
import { useUIStore } from "@/stores/ui-store";
import { useIsMobile } from "@/hooks/use-media-query";
import { fmtTime } from "@/lib/utils";
import type { Artifact, ArtifactType } from "@/lib/types";

export default function ArtifactsPage() {
  const { current } = useWorkspaceStore();
  const { setActive } = useArtifactStore();
  const { setMobileView } = useUIStore();
  const isMobile = useIsMobile();

  const { data: artifacts, isLoading } = useQuery({
    queryKey: ["artifacts", current?.id],
    queryFn: () => artifactsApi.list(current!.id),
    enabled: !!current,
  });

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      <header className="shrink-0 px-4 md:px-6 py-2.5 border-b hairline flex items-center gap-2">
        {isMobile && (
          <Button variant="ghost" size="icon-sm" onClick={() => setMobileView("sidebar")}>
            <Menu size={16} />
          </Button>
        )}
        <FileCode2 size={14} className="text-ink-muted" />
        <span className="text-sm font-medium text-ink">Artifacts</span>
      </header>
      <div className="flex-1 overflow-y-auto p-4 md:p-6">
        {isLoading ? (
          <Spinner />
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {(artifacts ?? []).map((a) => (
              <button
                key={a.id}
                onClick={() => {
                  setActive(a);
                  if (isMobile) setMobileView("artifact");
                }}
                className="glass-soft rounded-xl p-4 text-left hover:bg-white/[0.05] transition group"
              >
                <div className="flex items-start gap-2">
                  <TypeIcon type={a.type} />
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium text-ink truncate">{a.title}</div>
                    <div className="text-[10px] text-ink-faint truncate">
                      {a.type}{a.language ? ` · ${a.language}` : ""} · v{a.version}
                    </div>
                  </div>
                </div>
                <div className="mt-3 text-[11px] text-ink-muted line-clamp-3 font-mono whitespace-pre-wrap break-all">
                  {a.content.slice(0, 240)}
                </div>
                <div className="mt-2 text-[10px] text-ink-faint">Updated {fmtTime(a.updated_at)}</div>
              </button>
            ))}
            {(artifacts ?? []).length === 0 && (
              <div className="col-span-full text-xs text-ink-faint">
                No artifacts yet. Ask the assistant to generate code or markdown.
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function TypeIcon({ type }: { type: ArtifactType }) {
  const map = {
    code: <Code2 size={16} className="text-accent-glow" />,
    html: <Eye size={16} className="text-sky-300" />,
    markdown: <FileText size={16} className="text-emerald-300" />,
    json: <FileJson size={16} className="text-amber-300" />,
    text: <FileText size={16} className="text-ink-muted" />,
  };
  return (
    <div className="h-9 w-9 rounded-lg bg-white/[0.04] border border-white/5 grid place-items-center shrink-0">
      {map[type]}
    </div>
  );
}
