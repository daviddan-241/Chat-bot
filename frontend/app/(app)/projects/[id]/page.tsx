"use client";
import { use } from "react";
import { useQuery } from "@tanstack/react-query";
import { Menu } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { FileTree } from "@/components/files/file-tree";
import { FileEditor } from "@/components/files/file-editor";
import { ProjectHeaderActions } from "@/components/files/project-header-actions";
import { projectsApi } from "@/lib/api";
import { useUIStore } from "@/stores/ui-store";
import { useIsMobile } from "@/hooks/use-media-query";

export default function ProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { data: project, isLoading } = useQuery({ queryKey: ["project", id], queryFn: () => projectsApi.get(id) });
  const isMobile = useIsMobile();
  const { setMobileView } = useUIStore();

  if (isLoading) return <div className="flex-1 grid place-items-center"><Spinner /></div>;
  if (!project) return <div className="flex-1 grid place-items-center text-ink-faint">Project not found.</div>;

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      <header className="shrink-0 px-4 md:px-6 py-2.5 border-b hairline flex items-center gap-2">
        {isMobile && (
          <Button variant="ghost" size="icon-sm" onClick={() => setMobileView("sidebar")}>
            <Menu size={16} />
          </Button>
        )}
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium text-ink truncate">{project.name}</div>
          <div className="text-[10px] text-ink-faint">Project</div>
        </div>
        <ProjectHeaderActions project={project} />
      </header>
      <div className="flex-1 min-h-0 grid grid-cols-1 md:grid-cols-[260px_minmax(0,1fr)]">
        <aside className="border-r hairline glass-soft hidden md:block">
          <FileTree projectId={id} />
        </aside>
        <section className="min-w-0 min-h-0 flex flex-col">
          <FileEditor />
        </section>
      </div>
      <div className="md:hidden border-t hairline max-h-[40vh] overflow-y-auto glass-soft">
        <FileTree projectId={id} />
      </div>
    </div>
  );
}
