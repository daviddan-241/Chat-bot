"use client";
import * as React from "react";
import { motion } from "framer-motion";
import { Copy, Check, RefreshCw, Pencil, Sparkles, FileCode2 } from "lucide-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { renderMarkdown } from "@/lib/markdown";
import { chatsApi, artifactsApi } from "@/lib/api";
import { useArtifactStore } from "@/stores/artifact-store";
import { useToast } from "@/components/ui/toast";
import { cn, initials } from "@/lib/utils";
import { AgentAvatar } from "./agent-picker";
import type { Agent, ChatMessage as ChatMessageT, User } from "@/lib/types";

interface Props {
  message: ChatMessageT;
  user: User | null;
  agents?: Agent[];
  streaming?: boolean;
  onRegenerate?: () => void;
}

export function ChatMessage({ message, user, agents, streaming, onRegenerate }: Props) {
  const meta = (message.metadata || {}) as { agent_slug?: string; agent_id?: string; provider?: string };
  const agent = agents?.find((a) => a.id === meta.agent_id) || agents?.find((a) => a.slug === meta.agent_slug) || null;
  const isUser = message.role === "user";
  const isAssistant = message.role === "assistant";
  const { setActive } = useArtifactStore();
  const qc = useQueryClient();
  const { push } = useToast();
  const [editing, setEditing] = React.useState(false);
  const [draft, setDraft] = React.useState(message.content);
  const [copied, setCopied] = React.useState(false);

  React.useEffect(() => { setDraft(message.content); }, [message.content]);

  // Click-to-copy on any rendered code block
  const html = React.useMemo(() => renderMarkdown(message.content || ""), [message.content]);
  const contentRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    const el = contentRef.current;
    if (!el) return;
    const onClick = async (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (target.tagName === "BUTTON" && target.getAttribute("data-copy") === "1") {
        const pre = target.closest("div")?.parentElement?.querySelector("pre code");
        const text = pre?.textContent ?? "";
        try {
          await navigator.clipboard.writeText(text);
          const prev = target.textContent;
          target.textContent = "Copied";
          setTimeout(() => { if (target) target.textContent = prev || "Copy"; }, 1200);
        } catch {}
      }
    };
    el.addEventListener("click", onClick);
    return () => el.removeEventListener("click", onClick);
  }, [html]);

  const updateMutation = useMutation({
    mutationFn: async () => {
      // Backend has no PATCH for messages; we delete & recreate as a workaround
      // by simply storing a new user message. For simplicity we leave the original
      // and add the edited version as a fresh user message via regeneration.
      return chatsApi.addMessage(message.chat_id, draft, "user");
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["messages", message.chat_id] });
      setEditing(false);
      onRegenerate?.();
    },
    onError: (e) => push({ kind: "error", message: (e as Error).message }),
  });

  async function copyAll() {
    try {
      await navigator.clipboard.writeText(message.content);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {}
  }

  async function openArtifact() {
    if (!message.artifact_id) return;
    try {
      const a = await artifactsApi.get(message.artifact_id);
      setActive(a);
    } catch (e) {
      push({ kind: "error", message: (e as Error).message });
    }
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.18 }}
      className={cn("group flex gap-3 px-4 md:px-6", isUser ? "justify-end" : "justify-start")}
    >
      {!isUser && (
        agent ? (
          <AgentAvatar agent={agent} size={32} />
        ) : (
          <div className="h-8 w-8 rounded-lg bg-gradient-to-br from-accent to-fuchsia-500 grid place-items-center shrink-0 shadow-md">
            <Sparkles size={14} className="text-white" />
          </div>
        )
      )}

      <div className={cn("min-w-0 max-w-[88%] md:max-w-[78%] flex flex-col gap-1", isUser && "items-end")}>
        {!isUser && agent && (
          <div className="text-[10px] text-ink-faint px-1">
            {agent.name}{meta.provider && meta.provider !== "auto" ? ` · ${meta.provider}` : ""}
          </div>
        )}
        <div className={cn(
          "rounded-2xl px-4 py-3 border",
          isUser
            ? "bg-accent/10 border-accent/20 text-ink"
            : "glass-soft text-ink",
        )}>
          {editing ? (
            <div className="space-y-2 w-[min(640px,80vw)]">
              <Textarea
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                rows={4}
                autoFocus
              />
              <div className="flex justify-end gap-2">
                <Button variant="ghost" size="sm" onClick={() => { setEditing(false); setDraft(message.content); }}>Cancel</Button>
                <Button size="sm" disabled={!draft.trim() || updateMutation.isPending} onClick={() => updateMutation.mutate()}>
                  Send edit
                </Button>
              </div>
            </div>
          ) : (
            <div
              ref={contentRef}
              className={cn("prose-chat", streaming && "stream-caret")}
              dangerouslySetInnerHTML={{ __html: html || (streaming ? "" : "<em class='text-ink-faint'>(empty)</em>") }}
            />
          )}

          {message.artifact_id && (
            <button
              onClick={openArtifact}
              className="mt-2 inline-flex items-center gap-2 text-xs px-2.5 py-1.5 rounded-lg bg-white/[0.04] hover:bg-white/[0.08] border border-white/5 transition"
            >
              <FileCode2 size={12} className="text-accent-glow" />
              Open artifact
            </button>
          )}
        </div>

        {!editing && (
          <div className={cn(
            "flex items-center gap-1 opacity-0 group-hover:opacity-100 transition",
            isUser && "justify-end",
          )}>
            <button onClick={copyAll} className="text-[11px] text-ink-faint hover:text-ink inline-flex items-center gap-1 px-1.5 py-0.5 rounded">
              {copied ? <Check size={11} /> : <Copy size={11} />}
              {copied ? "Copied" : "Copy"}
            </button>
            {isUser && (
              <button onClick={() => setEditing(true)} className="text-[11px] text-ink-faint hover:text-ink inline-flex items-center gap-1 px-1.5 py-0.5 rounded">
                <Pencil size={11} /> Edit
              </button>
            )}
            {isAssistant && onRegenerate && (
              <button onClick={onRegenerate} className="text-[11px] text-ink-faint hover:text-ink inline-flex items-center gap-1 px-1.5 py-0.5 rounded">
                <RefreshCw size={11} /> Regenerate
              </button>
            )}
          </div>
        )}
      </div>

      {isUser && (
        <div className="h-8 w-8 rounded-lg bg-gradient-to-br from-indigo-500 to-fuchsia-500 grid place-items-center shrink-0 text-[10px] font-semibold text-white">
          {initials(user?.full_name, user?.email)}
        </div>
      )}
    </motion.div>
  );
}
