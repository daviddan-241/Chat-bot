"use client";
import * as React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Github, Link2, Plug, Trash2, ExternalLink, GitBranch, Star, Lock, Globe, Search, Loader2, Plus, Download,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogTrigger, DialogClose,
} from "@/components/ui/dialog";
import { useToast } from "@/components/ui/toast";
import { integrationsApi, projectsApi } from "@/lib/api";
import { useWorkspaceStore } from "@/stores/workspace-store";
import { cn, fmtTime } from "@/lib/utils";
import type { GitHubRepo } from "@/lib/types";

export default function IntegrationsPage() {
  const qc = useQueryClient();
  const { push } = useToast();
  const search = useSearchParams();
  const router = useRouter();

  React.useEffect(() => {
    if (search.get("connected") === "github") {
      push({ kind: "success", title: "Connected", message: `GitHub linked as @${search.get("login") || "user"}` });
      qc.invalidateQueries({ queryKey: ["integrations"] });
      // strip query
      router.replace("/settings/integrations");
    }
  }, [search, qc, push, router]);

  const { data: integrations, isLoading } = useQuery({
    queryKey: ["integrations"],
    queryFn: integrationsApi.list,
  });

  const gh = integrations?.find((i) => i.provider === "github");
  const google = integrations?.find((i) => i.provider === "google");

  const startGithub = useMutation({
    mutationFn: integrationsApi.githubStart,
    onSuccess: (d) => {
      window.location.href = d.authorize_url;
    },
    onError: (e) => push({ kind: "error", title: "GitHub not configured", message: (e as Error).message }),
  });

  const disconnect = useMutation({
    mutationFn: integrationsApi.disconnect,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["integrations"] });
      push({ kind: "success", message: "Disconnected" });
    },
    onError: (e) => push({ kind: "error", message: (e as Error).message }),
  });

  return (
    <div className="p-4 md:p-6 max-w-4xl mx-auto w-full space-y-4">
      {isLoading ? (
        <div className="space-y-3">
          <Skeleton className="h-24 w-full rounded-2xl" />
          <Skeleton className="h-24 w-full rounded-2xl" />
        </div>
      ) : (
        <>
          {/* GitHub */}
          <section className="glass rounded-2xl p-5">
            <div className="flex items-start gap-3">
              <div className="h-11 w-11 rounded-xl bg-white/[0.05] border border-white/5 grid place-items-center shrink-0">
                <Github size={20} className="text-ink" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <h3 className="text-sm font-semibold">GitHub</h3>
                  {gh && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-success/15 text-success">
                      Connected
                    </span>
                  )}
                </div>
                <p className="text-xs text-ink-muted mt-0.5">
                  Import repositories, commit changes, and manage branches from Nova.
                </p>
                {gh && (
                  <div className="mt-2 flex items-center gap-2 text-xs text-ink-muted">
                    {gh.avatar_url && (
                      <img src={gh.avatar_url} alt="" className="h-5 w-5 rounded-full" />
                    )}
                    <span>@{gh.account_login}</span>
                    {gh.account_email && <span className="text-ink-faint">· {gh.account_email}</span>}
                  </div>
                )}
              </div>
              <div className="flex items-center gap-2">
                {gh ? (
                  <>
                    <Button variant="outline" size="sm" onClick={() => disconnect.mutate("github")}>
                      <Trash2 size={12} /> Disconnect
                    </Button>
                  </>
                ) : (
                  <>
                    <Button onClick={() => startGithub.mutate()} disabled={startGithub.isPending}>
                      {startGithub.isPending ? <Spinner size={13} /> : <Plug size={13} />} Connect with OAuth
                    </Button>
                    <LinkWithTokenButton onLinked={() => qc.invalidateQueries({ queryKey: ["integrations"] })} />
                  </>
                )}
              </div>
            </div>

            {gh && <GitHubRepoList />}
          </section>

          {/* Google */}
          <section className="glass rounded-2xl p-5">
            <div className="flex items-start gap-3">
              <div className="h-11 w-11 rounded-xl bg-white/[0.05] border border-white/5 grid place-items-center shrink-0">
                <GoogleIcon className="h-5 w-5" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <h3 className="text-sm font-semibold">Google</h3>
                  {google && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-success/15 text-success">
                      Connected
                    </span>
                  )}
                </div>
                <p className="text-xs text-ink-muted mt-0.5">
                  Sign in with Google and link your account. Future: Google Drive imports.
                </p>
                {google && (
                  <div className="mt-2 flex items-center gap-2 text-xs text-ink-muted">
                    {google.avatar_url && (
                      <img src={google.avatar_url} alt="" className="h-5 w-5 rounded-full" />
                    )}
                    <span>{google.account_email}</span>
                  </div>
                )}
              </div>
              <div className="flex items-center gap-2">
                {google ? (
                  <Button variant="outline" size="sm" onClick={() => disconnect.mutate("google")}>
                    <Trash2 size={12} /> Disconnect
                  </Button>
                ) : (
                  <LinkGoogleButton />
                )}
              </div>
            </div>
          </section>

          {/* Vercel / Railway hints */}
          <section className="glass rounded-2xl p-5">
            <h3 className="text-sm font-semibold mb-1">Deployment providers</h3>
            <p className="text-xs text-ink-muted">
              Set <span className="font-mono text-ink">VERCEL_API_TOKEN</span> and{" "}
              <span className="font-mono text-ink">RAILWAY_API_TOKEN</span> in the backend
              environment to enable deployments. Manage them per project under{" "}
              <a className="text-accent-glow hover:underline" href="/settings/deployments">
                Deployments
              </a>.
            </p>
          </section>
        </>
      )}
    </div>
  );
}

function GoogleIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
      <path fill="#EA4335" d="M12 10.2v3.84h5.43c-.24 1.26-.96 2.34-2.04 3.06l3.3 2.55c1.92-1.77 3.03-4.38 3.03-7.5 0-.69-.06-1.35-.18-1.95H12z"/>
      <path fill="#34A853" d="M5.97 14.28l-.74.57-2.62 2.04C4.35 19.65 7.92 22 12 22c2.7 0 4.95-.9 6.6-2.43l-3.3-2.55c-.93.63-2.13 1-3.3 1-2.55 0-4.71-1.71-5.49-4.02z"/>
      <path fill="#FBBC05" d="M2.61 7.11A9.97 9.97 0 0 0 2 12c0 1.77.42 3.45 1.17 4.89l3.36-2.61c-.18-.54-.27-1.11-.27-1.71 0-.6.09-1.17.27-1.71L2.61 7.11z"/>
      <path fill="#4285F4" d="M12 5.4c1.47 0 2.79.51 3.84 1.5l2.88-2.88C16.95 2.4 14.7 1.5 12 1.5 7.92 1.5 4.35 3.84 2.61 7.11l3.36 2.61C6.78 7.11 8.94 5.4 12 5.4z"/>
    </svg>
  );
}

function LinkWithTokenButton({ onLinked }: { onLinked: () => void }) {
  const [open, setOpen] = React.useState(false);
  const [token, setToken] = React.useState("");
  const { push } = useToast();
  const link = useMutation({
    mutationFn: () => integrationsApi.githubLinkToken(token),
    onSuccess: () => {
      setOpen(false);
      setToken("");
      onLinked();
      push({ kind: "success", message: "GitHub linked via token" });
    },
    onError: (e) => push({ kind: "error", message: (e as Error).message }),
  });
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm"><Link2 size={12} /> Use token</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Link with a personal access token</DialogTitle>
          <DialogDescription>
            Create one at github.com/settings/tokens with <span className="font-mono">repo</span> +{" "}
            <span className="font-mono">read:user</span> scopes.
          </DialogDescription>
        </DialogHeader>
        <form
          onSubmit={(e) => { e.preventDefault(); if (token.trim()) link.mutate(); }}
          className="space-y-3"
        >
          <Input
            type="password"
            autoFocus
            placeholder="ghp_..."
            value={token}
            onChange={(e) => setToken(e.target.value)}
            className="font-mono text-xs"
          />
          <div className="flex justify-end gap-2 pt-1">
            <DialogClose asChild><Button variant="ghost">Cancel</Button></DialogClose>
            <Button type="submit" disabled={!token.trim() || link.isPending}>
              {link.isPending ? <Spinner size={13} /> : "Link"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function LinkGoogleButton() {
  const { push } = useToast();
  const start = useMutation({
    mutationFn: () => import("@/lib/api").then((m) => m.googleOAuthApi.start("link")),
    onSuccess: (d) => { window.location.href = d.authorize_url; },
    onError: (e) => push({ kind: "error", title: "Google not configured", message: (e as Error).message }),
  });
  return (
    <Button onClick={() => start.mutate()} disabled={start.isPending}>
      {start.isPending ? <Spinner size={13} /> : <Plug size={13} />} Connect Google
    </Button>
  );
}

function GitHubRepoList() {
  const { current } = useWorkspaceStore();
  const { push } = useToast();
  const qc = useQueryClient();
  const [filter, setFilter] = React.useState("");

  const { data: repos, isLoading } = useQuery({
    queryKey: ["github-repos"],
    queryFn: () => integrationsApi.githubRepos(1, 100),
  });
  const { data: projects } = useQuery({
    queryKey: ["projects", current?.id],
    queryFn: () => projectsApi.list(current!.id),
    enabled: !!current,
  });

  const filtered = React.useMemo(() => {
    const q = filter.toLowerCase().trim();
    return (repos ?? []).filter((r) =>
      !q || r.full_name.toLowerCase().includes(q) || (r.description || "").toLowerCase().includes(q),
    );
  }, [repos, filter]);

  return (
    <div className="mt-5 border-t hairline pt-4">
      <div className="flex items-center gap-2 mb-3">
        <Github size={14} className="text-ink-muted" />
        <h4 className="text-xs font-semibold uppercase tracking-wider text-ink-muted">Your repositories</h4>
        <div className="flex-1" />
        <div className="relative">
          <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-faint" />
          <Input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filter..."
            className="h-8 pl-7 text-xs w-48"
          />
        </div>
      </div>
      {isLoading ? (
        <div className="space-y-2">
          {[0, 1, 2].map((i) => <Skeleton key={i} className="h-14 w-full rounded-lg" />)}
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-xs text-ink-faint py-4">No repositories.</div>
      ) : (
        <div className="space-y-1.5 max-h-[400px] overflow-y-auto pr-1">
          {filtered.map((r) => (
            <RepoRow
              key={r.id}
              repo={r}
              projects={projects ?? []}
              workspaceId={current?.id || ""}
              onDone={() => { qc.invalidateQueries({ queryKey: ["projects", current?.id] }); push({ kind: "success", message: "Repo imported" }); }}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function RepoRow({
  repo, projects, workspaceId, onDone,
}: {
  repo: GitHubRepo;
  projects: { id: string; name: string }[];
  workspaceId: string;
  onDone: () => void;
}) {
  const { push } = useToast();
  const [open, setOpen] = React.useState(false);
  const [branch, setBranch] = React.useState(repo.default_branch);
  const [projectId, setProjectId] = React.useState<string>("__new__");
  const [newName, setNewName] = React.useState(repo.name);

  const { data: branches } = useQuery({
    queryKey: ["github-branches", repo.full_name],
    queryFn: () => integrationsApi.githubBranches(repo.full_name.split("/")[0], repo.full_name.split("/")[1]),
    enabled: open,
  });

  const imp = useMutation({
    mutationFn: () =>
      integrationsApi.githubImport({
        repo_full_name: repo.full_name,
        branch,
        workspace_id: workspaceId,
        project_id: projectId !== "__new__" ? projectId : undefined,
        new_project_name: projectId === "__new__" ? newName : undefined,
        max_files: 400,
      }),
    onSuccess: (r) => {
      setOpen(false);
      onDone();
      push({ kind: "success", title: "Import complete", message: `${r.files_count} files from ${r.repo_full_name}` });
    },
    onError: (e) => push({ kind: "error", title: "Import failed", message: (e as Error).message }),
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <div className="glass-soft rounded-lg p-3 flex items-center gap-3 hover:bg-white/[0.05] transition">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 text-sm font-medium text-ink truncate">
            {repo.private ? <Lock size={11} className="text-ink-faint" /> : <Globe size={11} className="text-ink-faint" />}
            {repo.full_name}
          </div>
          {repo.description && (
            <div className="text-[11px] text-ink-muted truncate mt-0.5">{repo.description}</div>
          )}
          <div className="text-[10px] text-ink-faint mt-1 flex items-center gap-3">
            {repo.language && <span>{repo.language}</span>}
            <span className="inline-flex items-center gap-0.5"><Star size={10} /> {repo.stargazers_count}</span>
            <span className="inline-flex items-center gap-0.5"><GitBranch size={10} /> {repo.default_branch}</span>
            {repo.updated_at && <span>updated {fmtTime(repo.updated_at)}</span>}
          </div>
        </div>
        <a
          href={repo.html_url}
          target="_blank"
          rel="noopener noreferrer"
          className="text-ink-faint hover:text-ink p-1 rounded"
          title="Open on GitHub"
        >
          <ExternalLink size={12} />
        </a>
        <DialogTrigger asChild>
          <Button size="sm" variant="secondary">
            <Download size={11} /> Import
          </Button>
        </DialogTrigger>
      </div>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Import {repo.name}</DialogTitle>
          <DialogDescription>Pull files into a Nova project.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <label className="text-xs text-ink-muted">Branch</label>
            <select
              value={branch}
              onChange={(e) => setBranch(e.target.value)}
              className="mt-1 h-9 w-full rounded-lg border border-white/10 bg-white/[0.03] px-3 text-sm text-ink"
            >
              {(branches ?? [{ name: repo.default_branch, sha: "", protected: false }]).map((b) => (
                <option key={b.name} value={b.name}>{b.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-xs text-ink-muted">Destination</label>
            <select
              value={projectId}
              onChange={(e) => setProjectId(e.target.value)}
              className="mt-1 h-9 w-full rounded-lg border border-white/10 bg-white/[0.03] px-3 text-sm text-ink"
            >
              <option value="__new__">+ Create new project</option>
              {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>
          {projectId === "__new__" && (
            <div>
              <label className="text-xs text-ink-muted">New project name</label>
              <Input value={newName} onChange={(e) => setNewName(e.target.value)} className="mt-1" />
            </div>
          )}
          <div className="flex justify-end gap-2 pt-2">
            <DialogClose asChild><Button variant="ghost">Cancel</Button></DialogClose>
            <Button onClick={() => imp.mutate()} disabled={imp.isPending || (projectId === "__new__" && !newName.trim())}>
              {imp.isPending ? <Loader2 size={13} className="animate-spin" /> : <Download size={13} />} Import
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
