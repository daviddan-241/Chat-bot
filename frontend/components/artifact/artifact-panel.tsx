"use client";
import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { motion } from "framer-motion";
import {
  Code2, Eye, FileJson, FileText, History, Save, Copy, Check, X, Download, ChevronLeft, Loader2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Spinner } from "@/components/ui/spinner";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useArtifactStore } from "@/stores/artifact-store";
import { useWorkspaceStore } from "@/stores/workspace-store";
import { useUIStore } from "@/stores/ui-store";
import { artifactsApi } from "@/lib/api";
import { useToast } from "@/components/ui/toast";
import { useDebouncedCallback } from "@/hooks/use-debounce";
import { renderMarkdown } from "@/lib/markdown";
import { MonacoEditor } from "./monaco-editor";
import { cn } from "@/lib/utils";
import type { Artifact, ArtifactType } from "@/lib/types";

export function ArtifactPanel({ mobile = false }: { mobile?: boolean }) {
  const { active, draft, setActive, setOpen } = useArtifactStore();
  const { current: workspace } = useWorkspaceStore();
  const { setMobileView } = useUIStore();
  const qc = useQueryClient();
  const { push } = useToast();

  const [localContent, setLocalContent] = React.useState("");
  const [savedAt, setSavedAt] = React.useState<number | null>(null);
  const [saving, setSaving] = React.useState(false);
  const [tab, setTab] = React.useState<"code" | "preview" | "json" | "history">("code");

  React.useEffect(() => {
    if (active) {
      setLocalContent(active.content);
      setSavedAt(Date.now());
      setTab(defaultTabFor(active.type));
    } else if (draft) {
      setLocalContent(draft.content);
      setSavedAt(null);
      setTab(defaultTabFor(draft.type));
    }
  }, [active?.id, draft?.content]); // eslint-disable-line react-hooks/exhaustive-deps

  const persistDraft = useMutation({
    mutationFn: async () => {
      if (!workspace || !draft) throw new Error("No workspace");
      return artifactsApi.create({
        workspace_id: workspace.id,
        title: draft.title || "Untitled",
        type: draft.type,
        language: draft.language ?? undefined,
        content: localContent,
      });
    },
    onSuccess: (a) => {
      setActive(a);
      qc.invalidateQueries({ queryKey: ["artifacts", workspace?.id] });
      push({ kind: "success", message: "Artifact saved" });
    },
    onError: (e) => push({ kind: "error", message: (e as Error).message }),
  });

  const update = useMutation({
    mutationFn: async (content: string) => {
      if (!active) throw new Error("No artifact");
      return artifactsApi.update(active.id, { content });
    },
    onMutate: () => setSaving(true),
    onSuccess: (a) => {
      setActive(a);
      setSavedAt(Date.now());
      qc.invalidateQueries({ queryKey: ["artifact-versions", a.id] });
    },
    onError: (e) => push({ kind: "error", message: (e as Error).message }),
    onSettled: () => setSaving(false),
  });

  // Autosave on change (debounced)
  const debouncedSave = useDebouncedCallback((content: string) => {
    if (!active) return;
    if (content === active.content) return;
    update.mutate(content);
  }, 700);

  function onContentChange(next: string) {
    setLocalContent(next);
    if (active) debouncedSave(next);
  }

  function copyContent() {
    navigator.clipboard.writeText(localContent).then(
      () => push({ kind: "success", message: "Copied to clipboard" }),
      () => push({ kind: "error", message: "Copy failed" }),
    );
  }

  function download() {
    const ext = extFor(active?.type ?? draft?.type ?? "text", active?.language ?? draft?.language ?? null);
    const blob = new Blob([localContent], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${(active?.title ?? draft?.title ?? "artifact").replace(/[^a-z0-9-_]+/gi, "_")}.${ext}`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const type = (active?.type ?? draft?.type) as ArtifactType | undefined;
  const language = active?.language ?? draft?.language ?? null;
  const title = active?.title ?? draft?.title ?? "Untitled";

  if (!type) {
    return (
      <div className="h-full grid place-items-center text-xs text-ink-faint">
        No artifact open
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col glass-soft">
      {/* Header */}
      <div className="shrink-0 px-3.5 py-2.5 border-b hairline flex items-center gap-2">
        {mobile && (
          <Button variant="ghost" size="icon-sm" onClick={() => setMobileView("chat")} aria-label="Back">
            <ChevronLeft size={16} />
          </Button>
        )}
        <div className="h-7 w-7 rounded-lg bg-white/[0.04] grid place-items-center border border-white/5">
          {iconFor(type)}
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium truncate text-ink">{title}</div>
          <div className="text-[10px] text-ink-faint truncate">
            {type}{language ? ` · ${language}` : ""}{active ? ` · v${active.version}` : " · draft"}
          </div>
        </div>
        <SaveIndicator saving={saving} savedAt={savedAt} />
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon-sm" onClick={copyContent}><Copy size={14} /></Button>
          </TooltipTrigger>
          <TooltipContent>Copy content</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon-sm" onClick={download}><Download size={14} /></Button>
          </TooltipTrigger>
          <TooltipContent>Download</TooltipContent>
        </Tooltip>
        {!mobile && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon-sm" onClick={() => setOpen(false)}><X size={14} /></Button>
            </TooltipTrigger>
            <TooltipContent>Close</TooltipContent>
          </Tooltip>
        )}
      </div>

      {/* Draft save prompt */}
      {!active && draft && (
        <div className="px-3.5 py-2 flex items-center gap-2 border-b hairline bg-accent/10">
          <div className="text-xs text-ink-muted flex-1">
            This is a streaming draft. Save to keep it and enable version history.
          </div>
          <Button size="sm" onClick={() => persistDraft.mutate()} disabled={persistDraft.isPending}>
            {persistDraft.isPending ? <Spinner size={12} /> : <Save size={13} />} Save
          </Button>
        </div>
      )}

      {/* Tabs */}
      <Tabs value={tab} onValueChange={(v) => setTab(v as typeof tab)} className="flex-1 min-h-0 flex flex-col">
        <div className="px-3.5 py-2 border-b hairline">
          <TabsList>
            <TabsTrigger value="code"><Code2 size={12} /> Code</TabsTrigger>
            {(type === "html" || type === "markdown") && (
              <TabsTrigger value="preview"><Eye size={12} /> Preview</TabsTrigger>
            )}
            {type === "json" && (
              <TabsTrigger value="preview"><FileJson size={12} /> Tree</TabsTrigger>
            )}
            {active && (
              <TabsTrigger value="history"><History size={12} /> History</TabsTrigger>
            )}
          </TabsList>
        </div>

        <TabsContent value="code" className="flex-1 min-h-0">
          <MonacoEditor
            language={monacoLanguageFor(type, language)}
            value={localContent}
            onChange={onContentChange}
          />
        </TabsContent>

        <TabsContent value="preview" className="flex-1 min-h-0 overflow-auto">
          <PreviewPane type={type} content={localContent} />
        </TabsContent>

        {active && (
          <TabsContent value="history" className="flex-1 min-h-0 overflow-auto">
            <VersionHistory
              artifact={active}
              onRevert={(content) => {
                setLocalContent(content);
                update.mutate(content);
              }}
            />
          </TabsContent>
        )}
      </Tabs>
    </div>
  );
}

function defaultTabFor(t: ArtifactType): "code" | "preview" | "json" | "history" {
  if (t === "html" || t === "markdown" || t === "json") return "code";
  return "code";
}

function SaveIndicator({ saving, savedAt }: { saving: boolean; savedAt: number | null }) {
  if (saving) {
    return <span className="text-[10px] text-ink-faint inline-flex items-center gap-1"><Loader2 size={11} className="animate-spin" /> Saving</span>;
  }
  if (savedAt) {
    return <span className="text-[10px] text-ink-faint inline-flex items-center gap-1"><Check size={11} className="text-success" /> Saved</span>;
  }
  return null;
}

function iconFor(t: ArtifactType) {
  const map: Record<ArtifactType, React.ReactNode> = {
    code: <Code2 size={14} className="text-accent-glow" />,
    html: <Eye size={14} className="text-sky-300" />,
    markdown: <FileText size={14} className="text-emerald-300" />,
    json: <FileJson size={14} className="text-amber-300" />,
    text: <FileText size={14} className="text-ink-muted" />,
  };
  return map[t];
}

function extFor(t: ArtifactType, lang: string | null): string {
  if (t === "html") return "html";
  if (t === "markdown") return "md";
  if (t === "json") return "json";
  if (t === "code") {
    const m: Record<string, string> = {
      typescript: "ts", javascript: "js", python: "py", rust: "rs", go: "go",
      java: "java", c: "c", cpp: "cpp", csharp: "cs", ruby: "rb", php: "php",
      shell: "sh", sql: "sql", html: "html", css: "css", json: "json",
    };
    return m[lang ?? ""] || "txt";
  }
  return "txt";
}

function monacoLanguageFor(t: ArtifactType, lang: string | null): string {
  if (t === "html") return "html";
  if (t === "markdown") return "markdown";
  if (t === "json") return "json";
  if (t === "code") return lang || "plaintext";
  return "plaintext";
}

function PreviewPane({ type, content }: { type: ArtifactType; content: string }) {
  if (type === "html") {
    return (
      <iframe
        title="HTML preview"
        sandbox="allow-scripts allow-forms"
        className="w-full h-full bg-white"
        srcDoc={content}
      />
    );
  }
  if (type === "markdown") {
    return (
      <div
        className="prose-chat p-5 max-w-none"
        dangerouslySetInnerHTML={{ __html: renderMarkdown(content) }}
      />
    );
  }
  if (type === "json") {
    return <JsonTree content={content} />;
  }
  return null;
}

function JsonTree({ content }: { content: string }) {
  let parsed: unknown;
  let error: string | null = null;
  try {
    parsed = JSON.parse(content);
  } catch (e) {
    error = (e as Error).message;
  }
  if (error) {
    return (
      <div className="p-5">
        <div className="text-xs text-danger glass-soft rounded-lg p-3">Invalid JSON: {error}</div>
        <pre className="mt-3 text-xs text-ink-muted whitespace-pre-wrap">{content}</pre>
      </div>
    );
  }
  return (
    <div className="p-4 font-mono text-xs">
      <JsonNode name="" value={parsed} depth={0} root />
    </div>
  );
}

function JsonNode({ name, value, depth, root }: { name: string; value: unknown; depth: number; root?: boolean }) {
  const [open, setOpen] = React.useState(depth < 2);
  const indent = { paddingLeft: depth * 12 };
  if (value === null) return <Row indent={indent} name={name} valueNode={<span className="text-ink-faint">null</span>} />;
  if (typeof value !== "object") {
    const color =
      typeof value === "string" ? "text-emerald-300" :
      typeof value === "number" ? "text-rose-300" :
      typeof value === "boolean" ? "text-violet-300" : "text-ink";
    const display = typeof value === "string" ? `"${value}"` : String(value);
    return <Row indent={indent} name={name} valueNode={<span className={color}>{display}</span>} />;
  }
  const entries = Array.isArray(value)
    ? value.map((v, i) => [String(i), v] as const)
    : Object.entries(value as Record<string, unknown>);
  const bracket = Array.isArray(value) ? ["[", "]"] : ["{", "}"];
  return (
    <div>
      <div style={indent} className="flex items-center gap-1 hover:bg-white/[0.03] rounded">
        <button onClick={() => setOpen(!open)} className="text-ink-faint hover:text-ink w-3">
          {open ? "▾" : "▸"}
        </button>
        {!root && <span className="text-sky-300">{name}</span>}
        {!root && <span className="text-ink-faint">:</span>}
        <span className="text-ink-muted">{bracket[0]}</span>
        {!open && <span className="text-ink-faint italic ml-1">{entries.length} item{entries.length === 1 ? "" : "s"}</span>}
        {!open && <span className="text-ink-muted">{bracket[1]}</span>}
      </div>
      {open && (
        <>
          {entries.map(([k, v]) => (
            <JsonNode key={k} name={k} value={v} depth={depth + 1} />
          ))}
          <div style={indent} className="text-ink-muted">{bracket[1]}</div>
        </>
      )}
    </div>
  );
}

function Row({ indent, name, valueNode }: { indent: React.CSSProperties; name: string; valueNode: React.ReactNode }) {
  return (
    <div style={indent} className="hover:bg-white/[0.03] rounded">
      {name !== "" && (
        <>
          <span className="text-sky-300">{name}</span>
          <span className="text-ink-faint">: </span>
        </>
      )}
      {valueNode}
    </div>
  );
}

function VersionHistory({ artifact, onRevert }: { artifact: Artifact; onRevert: (c: string) => void }) {
  const { data: versions, isLoading } = useQuery({
    queryKey: ["artifact-versions", artifact.id],
    queryFn: () => artifactsApi.versions(artifact.id),
  });
  const [selected, setSelected] = React.useState<number | null>(null);
  if (isLoading) return <div className="p-5"><Spinner /></div>;
  return (
    <div className="grid grid-cols-2 h-full min-h-0">
      <div className="border-r hairline overflow-y-auto">
        {(versions ?? []).slice().reverse().map((v) => (
          <button
            key={v.id}
            onClick={() => setSelected(v.version)}
            className={cn(
              "w-full text-left px-3.5 py-2.5 border-b hairline hover:bg-white/[0.03] transition",
              selected === v.version && "bg-white/[0.06]",
            )}
          >
            <div className="text-xs font-medium">Version {v.version}{v.version === artifact.version && <span className="text-success ml-2 text-[10px]">current</span>}</div>
            <div className="text-[10px] text-ink-faint mt-0.5">{new Date(v.created_at).toLocaleString()}</div>
          </button>
        ))}
      </div>
      <div className="overflow-auto">
        {selected ? (
          <VersionView artifactId={artifact.id} version={selected} onRevert={onRevert} isCurrent={selected === artifact.version} />
        ) : (
          <div className="p-5 text-xs text-ink-faint">Select a version to view.</div>
        )}
      </div>
    </div>
  );
}

function VersionView({ artifactId, version, onRevert, isCurrent }: { artifactId: string; version: number; onRevert: (c: string) => void; isCurrent: boolean }) {
  const { data, isLoading } = useQuery({
    queryKey: ["artifact-version", artifactId, version],
    queryFn: () => artifactsApi.version(artifactId, version),
  });
  if (isLoading) return <div className="p-5"><Spinner /></div>;
  if (!data) return null;
  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="text-xs text-ink-muted">Version {data.version} · {new Date(data.created_at).toLocaleString()}</div>
        {!isCurrent && (
          <Button size="sm" variant="secondary" onClick={() => onRevert(data.content)}>
            Restore as new version
          </Button>
        )}
      </div>
      <pre className="text-xs whitespace-pre-wrap bg-white/[0.02] border border-white/5 rounded-lg p-3 max-h-[60vh] overflow-auto">
        {data.content}
      </pre>
    </motion.div>
  );
}
