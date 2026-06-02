"use client";
import * as React from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Github, GitCommit, Rocket, Loader2, MoreHorizontal, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Spinner } from "@/components/ui/spinner";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogTrigger, DialogClose,
} from "@/components/ui/dialog";
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuLabel, DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { useToast } from "@/components/ui/toast";
import { deploymentsApi, integrationsApi } from "@/lib/api";
import Link from "next/link";
import type { Project } from "@/lib/types";

export function ProjectHeaderActions({ project }: { project: Project }) {
  const { push } = useToast();

  const { data: integrations } = useQuery({
    queryKey: ["integrations"],
    queryFn: integrationsApi.list,
  });
  const ghConnected = !!integrations?.find((i) => i.provider === "github");

  const deploy = useMutation({
    mutationFn: () =>
      deploymentsApi.create({ project_id: project.id, provider: "vercel", target: "production" }),
    onSuccess: (d) => {
      push({
        kind: "success",
        title: "Deployment queued",
        message: d.url ? d.url.replace(/^https?:\/\//, "") : "Check the Deployments tab.",
      });
    },
    onError: (e) => push({ kind: "error", title: "Deploy failed", message: (e as Error).message }),
  });

  return (
    <div className="flex items-center gap-1.5">
      <CommitButton project={project} connected={ghConnected} />
      <Button size="sm" variant="secondary" onClick={() => deploy.mutate()} disabled={deploy.isPending}>
        {deploy.isPending ? <Loader2 size={12} className="animate-spin" /> : <Rocket size={12} />}
        Deploy
      </Button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button size="icon-sm" variant="ghost" title="More"><MoreHorizontal size={13} /></Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuLabel>{project.name}</DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem asChild>
            <Link href="/settings/deployments"><Rocket size={12} /> Deployments & env</Link>
          </DropdownMenuItem>
          <DropdownMenuItem asChild>
            <Link href="/settings/integrations"><Github size={12} /> Integrations</Link>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

function CommitButton({ project, connected }: { project: Project; connected: boolean }) {
  const { push } = useToast();
  const [open, setOpen] = React.useState(false);
  const meta = (project.metadata as Record<string, unknown>) || {};
  const [repo, setRepo] = React.useState(String(meta.github_repo || ""));
  const [branch, setBranch] = React.useState("main");
  const [message, setMessage] = React.useState(`Update ${project.name} from Nova`);
  const [baseBranch, setBaseBranch] = React.useState("main");

  const commit = useMutation({
    mutationFn: () =>
      integrationsApi.githubCommitProject({
        project_id: project.id,
        repo_full_name: repo,
        branch,
        message,
        base_branch: baseBranch || undefined,
      }),
    onSuccess: (r) => {
      setOpen(false);
      push({
        kind: "success",
        title: "Committed",
        message: `${r.files_committed} file(s) → ${r.branch}`,
      });
    },
    onError: (e) => push({ kind: "error", title: "Commit failed", message: (e as Error).message }),
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="ghost" title="Commit project to GitHub">
          <Github size={12} /> Commit
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Commit to GitHub</DialogTitle>
          <DialogDescription>
            {connected
              ? "Push every file in this project as a single commit."
              : "Connect GitHub from Settings → Integrations first."}
          </DialogDescription>
        </DialogHeader>
        <form
          onSubmit={(e) => { e.preventDefault(); if (repo.trim() && branch.trim() && message.trim()) commit.mutate(); }}
          className="space-y-3"
        >
          <div>
            <label className="text-xs text-ink-muted">Repository</label>
            <Input
              value={repo}
              onChange={(e) => setRepo(e.target.value)}
              placeholder="owner/repo"
              className="mt-1 font-mono text-xs"
              disabled={!connected}
            />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-xs text-ink-muted">Target branch</label>
              <Input value={branch} onChange={(e) => setBranch(e.target.value)} className="mt-1 font-mono text-xs" disabled={!connected} />
            </div>
            <div>
              <label className="text-xs text-ink-muted">Base if missing</label>
              <Input value={baseBranch} onChange={(e) => setBaseBranch(e.target.value)} className="mt-1 font-mono text-xs" disabled={!connected} />
            </div>
          </div>
          <div>
            <label className="text-xs text-ink-muted">Commit message</label>
            <Textarea value={message} onChange={(e) => setMessage(e.target.value)} rows={2} className="mt-1" disabled={!connected} />
          </div>
          <div className="flex justify-end gap-2 pt-1">
            <DialogClose asChild><Button variant="ghost">Cancel</Button></DialogClose>
            <Button type="submit" disabled={!connected || commit.isPending}>
              {commit.isPending ? <Spinner size={13} /> : <GitCommit size={13} />} Commit
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
