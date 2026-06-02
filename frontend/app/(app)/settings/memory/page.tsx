"use client";
import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Brain, Search, Plus, Trash2, Pencil, FolderOpen, User as UserIcon, Sparkles, Loader2,
} from "lucide-react";
import { motion } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogClose,
} from "@/components/ui/dialog";
import { useToast } from "@/components/ui/toast";
import { semanticApi, projectMemoryApi, projectsApi } from "@/lib/api";
import { useDebouncedCallback } from "@/hooks/use-debounce";
import { useWorkspaceStore } from "@/stores/workspace-store";
import { cn, fmtTime } from "@/lib/utils";
import type { SemanticHit } from "@/lib/types";

export default function MemoryPage() {
  const { current } = useWorkspaceStore();
  const qc = useQueryClient();
  const { push } = useToast();

  const { data: all, isLoading } = useQuery({
    queryKey: ["memory-all"],
    queryFn: semanticApi.all,
  });
  const { data: projects } = useQuery({
    queryKey: ["projects", current?.id],
    queryFn: () => projectsApi.list(current!.id),
    enabled: !!current,
  });

  const reindex = useMutation({
    mutationFn: semanticApi.reindex,
    onSuccess: (d) => { push({ kind: "success", message: `Reindexed ${d.reindexed} item(s)` }); qc.invalidateQueries({ queryKey: ["memory-all"] }); },
    onError: (e) => push({ kind: "error", message: (e as Error).message }),
  });

  return (
    <div className="p-4 md:p-6 max-w-5xl mx-auto w-full space-y-4">
      <section className="glass rounded-2xl p-5">
        <div className="flex items-center gap-2 mb-1">
          <Brain size={14} className="text-accent-glow" />
          <h3 className="text-sm font-semibold">AI memory</h3>
          <div className="flex-1" />
          <Button size="sm" variant="outline" onClick={() => reindex.mutate()} disabled={reindex.isPending}>
            {reindex.isPending ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />}
            Rebuild embeddings
          </Button>
        </div>
        <p className="text-xs text-ink-muted">
          What the assistant remembers about you and your projects. Embeddings power semantic recall.
        </p>
      </section>

      <SemanticSearchCard />

      <Tabs defaultValue="user" className="space-y-3">
        <TabsList>
          <TabsTrigger value="user"><UserIcon size={12} /> User memory</TabsTrigger>
          <TabsTrigger value="project"><FolderOpen size={12} /> Project memory</TabsTrigger>
        </TabsList>

        <TabsContent value="user">
          <section className="glass rounded-2xl p-5">
            <h4 className="text-xs font-semibold uppercase tracking-wider text-ink-muted mb-3">User-level</h4>
            {isLoading ? (
              <Skeleton className="h-24 w-full" />
            ) : (all?.user_memory.length ?? 0) === 0 ? (
              <p className="text-xs text-ink-faint">No user memory yet. The assistant will add things over time.</p>
            ) : (
              <div className="space-y-2">
                {all!.user_memory.map((m) => (
                  <MemoryRow key={m.id} keyName={m.key} value={m.value} importance={m.importance} kind={m.kind} updated={m.updated_at} />
                ))}
              </div>
            )}
          </section>
        </TabsContent>

        <TabsContent value="project">
          <section className="glass rounded-2xl p-5">
            <div className="flex items-center gap-2 mb-3">
              <h4 className="text-xs font-semibold uppercase tracking-wider text-ink-muted">Project-scoped</h4>
              <div className="flex-1" />
              <AddProjectMemoryDialog
                projects={projects ?? []}
                onAdded={() => qc.invalidateQueries({ queryKey: ["memory-all"] })}
              />
            </div>
            {isLoading ? (
              <Skeleton className="h-24 w-full" />
            ) : (all?.project_memory.length ?? 0) === 0 ? (
              <p className="text-xs text-ink-faint">No project memory yet.</p>
            ) : (
              <div className="space-y-2">
                {all!.project_memory.map((m) => {
                  const project = projects?.find((p) => p.id === m.project_id);
                  return (
                    <MemoryRow
                      key={m.id}
                      keyName={m.key}
                      value={m.value}
                      importance={m.importance}
                      kind="project"
                      hint={project?.name}
                      updated={m.updated_at}
                      onDelete={async () => {
                        await projectMemoryApi.delete(m.id);
                        qc.invalidateQueries({ queryKey: ["memory-all"] });
                      }}
                    />
                  );
                })}
              </div>
            )}
            <div className="text-[10px] text-ink-faint mt-3">{all?.embedding_count ?? 0} embeddings indexed.</div>
          </section>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function MemoryRow({
  keyName, value, importance, kind, updated, hint, onDelete,
}: {
  keyName: string; value: string; importance: number; kind: string; updated: string; hint?: string;
  onDelete?: () => Promise<void> | void;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 2 }}
      animate={{ opacity: 1, y: 0 }}
      className="glass-soft rounded-lg p-3 flex items-start gap-3"
    >
      <div className="h-8 w-8 rounded-md bg-accent/10 border border-accent/20 grid place-items-center shrink-0">
        <Brain size={14} className="text-accent-glow" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium font-mono text-ink truncate">{keyName}</span>
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-white/[0.05] text-ink-faint">{kind}</span>
          {hint && <span className="text-[10px] text-ink-faint truncate">· {hint}</span>}
          <span className="text-[10px] text-ink-faint ml-auto">{fmtTime(updated)}</span>
        </div>
        <div className="text-xs text-ink-muted mt-1 break-words">{value}</div>
        <div className="mt-1 h-1 rounded-full bg-white/[0.05] overflow-hidden w-32">
          <div className="h-full bg-accent" style={{ width: `${Math.round(importance * 100)}%` }} />
        </div>
      </div>
      {onDelete && (
        <Button variant="ghost" size="icon-sm" onClick={() => onDelete()} className="text-danger hover:text-danger">
          <Trash2 size={12} />
        </Button>
      )}
    </motion.div>
  );
}

function SemanticSearchCard() {
  const { current } = useWorkspaceStore();
  const [q, setQ] = React.useState("");
  const [hits, setHits] = React.useState<SemanticHit[]>([]);
  const [loading, setLoading] = React.useState(false);

  const run = useDebouncedCallback(async (query: string) => {
    if (!query.trim()) { setHits([]); return; }
    setLoading(true);
    try {
      const r = await semanticApi.search({ query, limit: 8 });
      setHits(r);
    } catch {
      setHits([]);
    } finally {
      setLoading(false);
    }
  }, 250);

  return (
    <section className="glass rounded-2xl p-5">
      <h3 className="text-sm font-semibold mb-2">Semantic search</h3>
      <div className="relative">
        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-faint" />
        <Input
          value={q}
          onChange={(e) => { setQ(e.target.value); run(e.target.value); }}
          placeholder="What does the assistant know about X?"
          className="pl-9"
        />
      </div>
      <div className="mt-3 space-y-1.5">
        {loading && <div className="text-[11px] text-ink-faint">Searching...</div>}
        {!loading && q && hits.length === 0 && <div className="text-[11px] text-ink-faint">No matches.</div>}
        {hits.map((h, i) => (
          <div key={i} className="glass-soft rounded-lg p-2.5 text-xs flex items-center gap-2">
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-white/[0.05] text-ink-faint">{h.scope}</span>
            <span className="text-ink truncate flex-1">{h.text}</span>
            <span className="text-[10px] text-ink-faint">{(h.score * 100).toFixed(0)}%</span>
          </div>
        ))}
      </div>
    </section>
  );
}

function AddProjectMemoryDialog({
  projects, onAdded,
}: {
  projects: { id: string; name: string }[];
  onAdded: () => void;
}) {
  const [open, setOpen] = React.useState(false);
  const [projectId, setProjectId] = React.useState(projects[0]?.id || "");
  const [key, setKey] = React.useState("");
  const [value, setValue] = React.useState("");
  const [importance, setImportance] = React.useState(0.6);
  const { push } = useToast();
  React.useEffect(() => { if (!projectId && projects[0]) setProjectId(projects[0].id); }, [projects, projectId]);

  const create = useMutation({
    mutationFn: () => projectMemoryApi.create(projectId, { key, value, importance }),
    onSuccess: () => {
      setOpen(false); setKey(""); setValue(""); onAdded();
      push({ kind: "success", message: "Memory added" });
    },
    onError: (e) => push({ kind: "error", message: (e as Error).message }),
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline" disabled={projects.length === 0}>
          <Plus size={12} /> Add
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader><DialogTitle>Add project memory</DialogTitle></DialogHeader>
        <form
          onSubmit={(e) => { e.preventDefault(); if (key.trim() && value.trim()) create.mutate(); }}
          className="space-y-3"
        >
          <div>
            <label className="text-xs text-ink-muted">Project</label>
            <select value={projectId} onChange={(e) => setProjectId(e.target.value)} className="mt-1 h-9 w-full rounded-lg border border-white/10 bg-white/[0.03] px-3 text-sm text-ink">
              {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>
          <div>
            <label className="text-xs text-ink-muted">Key</label>
            <Input value={key} onChange={(e) => setKey(e.target.value)} className="mt-1 font-mono text-xs" placeholder="tech_stack" autoFocus />
          </div>
          <div>
            <label className="text-xs text-ink-muted">Value</label>
            <Textarea value={value} onChange={(e) => setValue(e.target.value)} rows={3} className="mt-1" />
          </div>
          <div>
            <label className="text-xs text-ink-muted">Importance: {importance.toFixed(2)}</label>
            <input type="range" min={0} max={1} step={0.05} value={importance} onChange={(e) => setImportance(parseFloat(e.target.value))} className="mt-1 w-full" />
          </div>
          <div className="flex justify-end gap-2 pt-1">
            <DialogClose asChild><Button variant="ghost">Cancel</Button></DialogClose>
            <Button type="submit" disabled={!projectId || !key.trim() || !value.trim() || create.isPending}>Add</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
