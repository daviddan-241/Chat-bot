"use client";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { Menu, Folder, FileText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { projectsApi } from "@/lib/api";
import { useWorkspaceStore } from "@/stores/workspace-store";
import { useUIStore } from "@/stores/ui-store";
import { useIsMobile } from "@/hooks/use-media-query";

export default function FilesIndexPage() {
  const { current } = useWorkspaceStore();
  const { data: projects, isLoading } = useQuery({
    queryKey: ["projects", current?.id],
    queryFn: () => projectsApi.list(current!.id),
    enabled: !!current,
  });
  const isMobile = useIsMobile();
  const { setMobileView } = useUIStore();

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      <header className="shrink-0 px-4 md:px-6 py-2.5 border-b hairline flex items-center gap-2">
        {isMobile && (
          <Button variant="ghost" size="icon-sm" onClick={() => setMobileView("sidebar")}>
            <Menu size={16} />
          </Button>
        )}
        <FileText size={14} className="text-ink-muted" />
        <span className="text-sm font-medium text-ink">Files</span>
      </header>
      <div className="flex-1 overflow-y-auto p-4 md:p-6">
        {isLoading ? (
          <Spinner />
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {(projects ?? []).map((p) => (
              <Link
                key={p.id}
                href={`/projects/${p.id}`}
                className="glass-soft rounded-xl p-4 hover:bg-white/[0.05] transition group"
              >
                <div className="flex items-center gap-2">
                  <div className="h-9 w-9 rounded-lg bg-amber-500/15 border border-amber-500/20 grid place-items-center">
                    <Folder size={16} className="text-amber-300" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium text-ink truncate">{p.name}</div>
                    <div className="text-[10px] text-ink-faint truncate">
                      {p.description || "No description"}
                    </div>
                  </div>
                </div>
              </Link>
            ))}
            {(projects ?? []).length === 0 && (
              <div className="col-span-full text-xs text-ink-faint">
                No projects yet. Create one from the sidebar.
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
