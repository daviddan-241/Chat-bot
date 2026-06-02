"use client";
import * as React from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { X, Save, Check, Loader2, FileText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { MonacoEditor } from "@/components/artifact/monaco-editor";
import { useFileStore } from "@/stores/file-store";
import { useDebouncedCallback } from "@/hooks/use-debounce";
import { filesApi } from "@/lib/api";
import { cn, languageFromPath } from "@/lib/utils";
import { useToast } from "@/components/ui/toast";

export function FileEditor() {
  const { tabs, activeId, setActive, closeTab, updateContent, markClean } = useFileStore();
  const qc = useQueryClient();
  const { push } = useToast();
  const [savingId, setSavingId] = React.useState<string | null>(null);

  const save = useMutation({
    mutationFn: ({ id, content }: { id: string; content: string }) => filesApi.update(id, { content }),
    onMutate: ({ id }) => setSavingId(id),
    onSuccess: (_, vars) => {
      markClean(vars.id);
      const tab = useFileStore.getState().tabs.find((t) => t.fileId === vars.id);
      if (tab) qc.invalidateQueries({ queryKey: ["files", tab.projectId] });
    },
    onError: (e) => push({ kind: "error", message: (e as Error).message }),
    onSettled: () => setSavingId(null),
  });

  const debouncedSave = useDebouncedCallback((id: string, content: string) => {
    save.mutate({ id, content });
  }, 900);

  const active = tabs.find((t) => t.fileId === activeId) || null;

  if (tabs.length === 0) {
    return (
      <div className="h-full grid place-items-center text-center px-6 text-ink-faint">
        <div>
          <FileText className="mx-auto mb-2" />
          <div className="text-sm text-ink">No file open</div>
          <div className="text-xs">Click a file in the tree to start editing.</div>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      <div className="shrink-0 flex items-center overflow-x-auto border-b hairline">
        {tabs.map((t) => {
          const isActive = t.fileId === activeId;
          return (
            <div
              key={t.fileId}
              onClick={() => setActive(t.fileId)}
              className={cn(
                "group flex items-center gap-2 px-3 py-2 border-r hairline cursor-pointer transition shrink-0",
                isActive ? "bg-white/[0.05] text-ink" : "text-ink-muted hover:text-ink hover:bg-white/[0.03]",
              )}
            >
              <FileText size={12} className="text-sky-300" />
              <span className="text-xs">{t.name}</span>
              {t.dirty && <span className="h-1.5 w-1.5 rounded-full bg-warning" />}
              {savingId === t.fileId && <Loader2 size={11} className="animate-spin text-ink-faint" />}
              <button
                onClick={(e) => { e.stopPropagation(); closeTab(t.fileId); }}
                className="text-ink-faint hover:text-ink p-0.5 opacity-0 group-hover:opacity-100 transition"
                aria-label="Close tab"
              >
                <X size={11} />
              </button>
            </div>
          );
        })}
        <div className="flex-1" />
        {active && (
          <div className="px-3 flex items-center gap-2">
            {savingId === active.fileId ? (
              <span className="text-[10px] text-ink-faint inline-flex items-center gap-1"><Loader2 size={11} className="animate-spin" /> Saving</span>
            ) : !active.dirty ? (
              <span className="text-[10px] text-ink-faint inline-flex items-center gap-1"><Check size={11} className="text-success" /> Saved</span>
            ) : (
              <Button size="sm" variant="ghost" onClick={() => save.mutate({ id: active.fileId, content: active.content })}>
                <Save size={11} /> Save
              </Button>
            )}
          </div>
        )}
      </div>
      <div className="flex-1 min-h-0">
        {active && (
          <MonacoEditor
            key={active.fileId}
            language={languageFromPath(active.path)}
            value={active.content}
            onChange={(v) => {
              updateContent(active.fileId, v);
              debouncedSave(active.fileId, v);
            }}
          />
        )}
      </div>
    </div>
  );
}
