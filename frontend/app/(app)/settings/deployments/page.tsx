"use client";
import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Rocket, ExternalLink, RefreshCw, Eye, EyeOff, Plus, Trash2, Loader2, ChevronRight, Triangle, Train,
} from "lucide-react";
import { motion } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Spinner } from "@/components/ui/spinner";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogTrigger, DialogClose,
} from "@/components/ui/dialog";
import { useToast } from "@/components/ui/toast";
import { deploymentsApi, projectsApi } from "@/lib/api";
import { useWorkspaceStore } from "@/stores/workspace-store";
import { cn, fmtTime } from "@/lib/utils";
import type { Deployment, DeploymentProvider, DeploymentStatus, EnvVar, Project } from "@/lib/types";

export default function DeploymentsPage() {
  const { current } = useWorkspaceStore();
  const { data: projects, isLoading } = useQuery({
    queryKey: ["projects", current?.id],
    queryFn: () => projectsApi.list(current!.id),
    enabled: !!current,
  });
  const [selectedId, setSelectedId] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!selectedId && projects && projects[0]) setSelectedId(projects[0].id);
  }, [projects, selectedId]);

  return (
    <div className="p-4 md:p-6 max-w-6xl mx-auto w-full">
      {isLoading ? (
        <Skeleton className="h-40 w-full rounded-2xl" />
      ) : !projects || projects.length === 0 ? (
        <div className="glass rounded-2xl p-8 text-center">
          <Rocket size={28} className="mx-auto text-ink-muted mb-2" />
          <h3 className="text-sm font-semibold">No projects yet</h3>
          <p className="text-xs text-ink-muted mt-1">Create a project before deploying.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-[220px_minmax(0,1fr)] gap-4">
          <aside className="glass rounded-2xl p-2 h-fit md:sticky md:top-2">
            <div className="text-[10px] uppercase tracking-wider text-ink-faint px-2 py-1.5">Projects</div>
            {projects.map((p) => (
              <button
                key={p.id}
                onClick={() => setSelectedId(p.id)}
                className={cn(
                  "w-full text-left px-2.5 py-1.5 rounded-md text-xs flex items-center justify-between transition",
                  selectedId === p.id
                    ? "bg-white/[0.07] text-ink"
                    : "text-ink-muted hover:text-ink hover:bg-white/[0.04]",
                )}
              >
                <span className="truncate">{p.name}</span>
                <ChevronRight size={10} className="text-ink-faint" />
              </button>
            ))}
          </aside>
          {selectedId && <ProjectDeployments project={projects.find((p) => p.id === selectedId)!} />}
        </div>
      )}
    </div>
  );
}

function ProjectDeployments({ project }: { project: Project }) {
  return (
    <div className="space-y-4">
      <EnvVarsSection project={project} />
      <DeploymentsSection project={project} />
    </div>
  );
}

function EnvVarsSection({ project }: { project: Project }) {
  const qc = useQueryClient();
  const { push } = useToast();
  const [reveal, setReveal] = React.useState(false);

  const { data: envs, isLoading } = useQuery({
    queryKey: ["env-vars", project.id, reveal],
    queryFn: () => deploymentsApi.listEnv(project.id, reveal),
  });

  const del = useMutation({
    mutationFn: (id: string) => deploymentsApi.deleteEnv(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["env-vars", project.id] }),
  });

  return (
    <section className="glass rounded-2xl p-5">
      <div className="flex items-center gap-2 mb-3">
        <h3 className="text-sm font-semibold">Environment variables</h3>
        <span className="text-[10px] text-ink-faint">· {project.name}</span>
        <div className="flex-1" />
        <Button variant="ghost" size="sm" onClick={() => setReveal((r) => !r)}>
          {reveal ? <EyeOff size={12} /> : <Eye size={12} />}
          {reveal ? "Hide" : "Reveal"}
        </Button>
        <AddEnvVarDialog
          projectId={project.id}
          onAdded={() => qc.invalidateQueries({ queryKey: ["env-vars", project.id] })}
        />
      </div>
      {isLoading ? (
        <div className="space-y-2">
          {[0, 1].map((i) => <Skeleton key={i} className="h-9 w-full rounded-lg" />)}
        </div>
      ) : (envs?.length ?? 0) === 0 ? (
        <div className="text-xs text-ink-faint py-2">No env vars. Add one to inject it into deployments.</div>
      ) : (
        <div className="rounded-xl border border-white/5 overflow-hidden">
          <div className="grid grid-cols-[1fr_2fr_auto_auto_auto] text-[10px] uppercase tracking-wider text-ink-faint bg-white/[0.02] px-3 py-2 border-b border-white/5">
            <span>Key</span><span>Value</span><span>Env</span><span></span><span></span>
          </div>
          {envs!.map((ev) => (
            <EnvVarRow key={ev.id} ev={ev} reveal={reveal} onDelete={() => del.mutate(ev.id)} onSaved={() => qc.invalidateQueries({ queryKey: ["env-vars", project.id] })} />
          ))}
        </div>
      )}
    </section>
  );
}

function EnvVarRow({ ev, reveal, onDelete, onSaved }: { ev: EnvVar; reveal: boolean; onDelete: () => void; onSaved: () => void }) {
  const [editing, setEditing] = React.useState(false);
  const [value, setValue] = React.useState("");
  const { push } = useToast();
  const save = useMutation({
    mutationFn: () => deploymentsApi.updateEnv(ev.id, { value }),
    onSuccess: () => { setEditing(false); onSaved(); push({ kind: "success", message: `Updated ${ev.key}` }); },
    onError: (e) => push({ kind: "error", message: (e as Error).message }),
  });
  return (
    <div className="grid grid-cols-[1fr_2fr_auto_auto_auto] items-center gap-2 px-3 py-2 border-b border-white/5 last:border-b-0 text-xs">
      <span className="font-mono text-ink truncate">{ev.key}</span>
      {editing ? (
        <Input value={value} onChange={(e) => setValue(e.target.value)} className="h-7 text-xs font-mono" autoFocus />
      ) : (
        <span className={cn("font-mono truncate", reveal ? "text-ink" : "text-ink-muted")}>{ev.value}</span>
      )}
      <span className="text-[10px] text-ink-faint">{ev.environment}</span>
      {editing ? (
        <Button size="sm" onClick={() => save.mutate()} disabled={save.isPending}>Save</Button>
      ) : (
        <Button size="sm" variant="ghost" onClick={() => { setEditing(true); setValue(""); }}>Edit</Button>
      )}
      <Button size="sm" variant="ghost" onClick={onDelete} className="text-danger hover:text-danger"><Trash2 size={11} /></Button>
    </div>
  );
}

function AddEnvVarDialog({ projectId, onAdded }: { projectId: string; onAdded: () => void }) {
  const [open, setOpen] = React.useState(false);
  const [key, setKey] = React.useState("");
  const [value, setValue] = React.useState("");
  const [environment, setEnvironment] = React.useState("production");
  const { push } = useToast();
  const create = useMutation({
    mutationFn: () => deploymentsApi.createEnv(projectId, { key, value, environment, secret: true }),
    onSuccess: () => { setOpen(false); setKey(""); setValue(""); onAdded(); push({ kind: "success", message: "Env var added" }); },
    onError: (e) => push({ kind: "error", message: (e as Error).message }),
  });
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline"><Plus size={12} /> Add</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader><DialogTitle>Add env var</DialogTitle></DialogHeader>
        <form
          onSubmit={(e) => { e.preventDefault(); if (key.trim() && value) create.mutate(); }}
          className="space-y-3"
        >
          <div>
            <label className="text-xs text-ink-muted">Key</label>
            <Input value={key} onChange={(e) => setKey(e.target.value)} className="mt-1 font-mono text-xs" placeholder="API_KEY" autoFocus />
          </div>
          <div>
            <label className="text-xs text-ink-muted">Value</label>
            <Textarea value={value} onChange={(e) => setValue(e.target.value)} className="mt-1 font-mono text-xs" rows={3} />
          </div>
          <div>
            <label className="text-xs text-ink-muted">Environment</label>
            <select value={environment} onChange={(e) => setEnvironment(e.target.value)} className="mt-1 h-9 w-full rounded-lg border border-white/10 bg-white/[0.03] px-3 text-sm text-ink">
              <option value="production">production</option>
              <option value="preview">preview</option>
              <option value="development">development</option>
            </select>
          </div>
          <div className="flex justify-end gap-2 pt-1">
            <DialogClose asChild><Button variant="ghost">Cancel</Button></DialogClose>
            <Button type="submit" disabled={!key.trim() || !value || create.isPending}>
              {create.isPending ? <Spinner size={13} /> : "Add"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function DeploymentsSection({ project }: { project: Project }) {
  const qc = useQueryClient();
  const { push } = useToast();
  const { data: deployments, isLoading } = useQuery({
    queryKey: ["deployments", project.id],
    queryFn: () => deploymentsApi.list(project.id),
    refetchInterval: 10_000,
  });

  const create = useMutation({
    mutationFn: (provider: DeploymentProvider) =>
      deploymentsApi.create({ project_id: project.id, provider, target: "production" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["deployments", project.id] });
      push({ kind: "success", message: "Deployment triggered" });
    },
    onError: (e) => push({ kind: "error", title: "Deploy failed", message: (e as Error).message }),
  });

  return (
    <section className="glass rounded-2xl p-5">
      <div className="flex items-center gap-2 mb-3">
        <h3 className="text-sm font-semibold">Deployments</h3>
        <div className="flex-1" />
        <Button size="sm" variant="secondary" disabled={create.isPending} onClick={() => create.mutate("vercel")}>
          {create.isPending ? <Loader2 size={12} className="animate-spin" /> : <Triangle size={12} />}
          Deploy to Vercel
        </Button>
        <Button size="sm" variant="secondary" disabled={create.isPending} onClick={() => create.mutate("railway")}>
          <Train size={12} /> Railway
        </Button>
      </div>
      {isLoading ? (
        <Skeleton className="h-20 w-full rounded-lg" />
      ) : (deployments?.length ?? 0) === 0 ? (
        <div className="text-xs text-ink-faint py-4">
          No deployments yet. Add a <span className="font-mono">VERCEL_API_TOKEN</span> on the backend, then click "Deploy to Vercel".
        </div>
      ) : (
        <div className="space-y-2">
          {deployments!.map((d) => (
            <DeploymentRow key={d.id} d={d} onRefresh={() => qc.invalidateQueries({ queryKey: ["deployments", project.id] })} />
          ))}
        </div>
      )}
    </section>
  );
}

function DeploymentRow({ d, onRefresh }: { d: Deployment; onRefresh: () => void }) {
  const [open, setOpen] = React.useState(false);
  const { push } = useToast();
  const refresh = useMutation({
    mutationFn: () => deploymentsApi.refresh(d.id),
    onSuccess: () => { onRefresh(); push({ kind: "info", message: "Refreshed" }); },
    onError: (e) => push({ kind: "error", message: (e as Error).message }),
  });
  const { data: live } = useQuery({
    queryKey: ["deploy-logs", d.id],
    queryFn: () => deploymentsApi.logs(d.id),
    enabled: open,
    refetchInterval: open && d.status !== "ready" ? 5000 : false,
  });

  return (
    <motion.div
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      className="glass-soft rounded-lg overflow-hidden"
    >
      <button onClick={() => setOpen((o) => !o)} className="w-full px-3.5 py-2.5 flex items-center gap-3 text-left hover:bg-white/[0.03] transition">
        <ProviderIcon provider={d.provider} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <StatusPill status={d.status} />
            <span className="text-xs text-ink-muted">{fmtTime(d.created_at)}</span>
            {d.branch && <span className="text-[10px] text-ink-faint">branch: {d.branch}</span>}
          </div>
          {d.url ? (
            <a href={d.url} target="_blank" rel="noopener noreferrer" className="text-xs text-accent-glow hover:underline inline-flex items-center gap-1 mt-0.5" onClick={(e) => e.stopPropagation()}>
              {d.url.replace(/^https?:\/\//, "")} <ExternalLink size={10} />
            </a>
          ) : (
            <div className="text-xs text-ink-faint mt-0.5">No URL yet</div>
          )}
        </div>
        <Button size="sm" variant="ghost" onClick={(e) => { e.stopPropagation(); refresh.mutate(); }}>
          {refresh.isPending ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
        </Button>
        <ChevronRight size={12} className={cn("text-ink-faint transition", open && "rotate-90")} />
      </button>
      {open && (
        <div className="border-t hairline bg-black/30 p-3">
          <div className="text-[10px] uppercase tracking-wider text-ink-faint mb-1">Logs</div>
          <pre className="text-[11px] font-mono whitespace-pre-wrap text-ink-muted max-h-72 overflow-y-auto">
            {live?.logs || "(no logs yet — click refresh)"}
          </pre>
        </div>
      )}
    </motion.div>
  );
}

function ProviderIcon({ provider }: { provider: DeploymentProvider }) {
  return (
    <div className="h-7 w-7 rounded-md bg-white/[0.04] border border-white/5 grid place-items-center shrink-0">
      {provider === "vercel" ? <Triangle size={12} className="text-ink" /> : <Train size={12} className="text-emerald-300" />}
    </div>
  );
}

function StatusPill({ status }: { status: DeploymentStatus }) {
  const map: Record<DeploymentStatus, string> = {
    ready: "bg-success/15 text-success",
    building: "bg-accent/15 text-accent-glow",
    pending: "bg-white/[0.05] text-ink-muted",
    error: "bg-danger/15 text-danger",
    canceled: "bg-warning/15 text-warning",
  };
  return (
    <span className={cn("inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded", map[status])}>
      {status === "building" && <Loader2 size={9} className="animate-spin" />}
      {status}
    </span>
  );
}
