"use client";
import * as React from "react";
import { ArrowUp, Square, Paperclip, ImageIcon, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface Props {
  onSend: (text: string, attachments: Attachment[]) => void;
  onStop?: () => void;
  streaming?: boolean;
  disabled?: boolean;
  placeholder?: string;
}

export interface Attachment {
  kind: "image" | "file";
  name: string;
  mime: string;
  size: number;
  /** base64 data URL for images, raw text for text-like files */
  data: string;
}

export function ChatComposer({ onSend, onStop, streaming, disabled, placeholder }: Props) {
  const [text, setText] = React.useState("");
  const [attachments, setAttachments] = React.useState<Attachment[]>([]);
  const textareaRef = React.useRef<HTMLTextAreaElement>(null);
  const fileInputRef = React.useRef<HTMLInputElement>(null);
  const imageInputRef = React.useRef<HTMLInputElement>(null);

  // Auto-grow
  React.useEffect(() => {
    const t = textareaRef.current;
    if (!t) return;
    t.style.height = "0px";
    t.style.height = Math.min(220, t.scrollHeight) + "px";
  }, [text]);

  function submit() {
    const trimmed = text.trim();
    if (!trimmed && attachments.length === 0) return;
    let body = trimmed;
    if (attachments.length) {
      const att = attachments
        .map((a) => {
          if (a.kind === "image") return `![${a.name}](${a.data})`;
          return `\n\n\`\`\`\n# ${a.name}\n${a.data}\n\`\`\``;
        })
        .join("\n");
      body = `${trimmed}\n\n${att}`.trim();
    }
    onSend(body, attachments);
    setText("");
    setAttachments([]);
  }

  function onKey(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    // Cmd/Ctrl+Enter always sends
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      submit();
      return;
    }
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      submit();
    }
  }

  async function ingestFiles(files: FileList | null, force: "image" | "file" | null = null) {
    if (!files) return;
    const next: Attachment[] = [];
    for (const f of Array.from(files)) {
      const isImage = force === "image" || f.type.startsWith("image/");
      if (isImage) {
        const data = await fileToDataURL(f);
        next.push({ kind: "image", name: f.name, mime: f.type, size: f.size, data });
      } else {
        const data = await f.text();
        next.push({ kind: "file", name: f.name, mime: f.type || "text/plain", size: f.size, data });
      }
    }
    setAttachments((a) => [...a, ...next].slice(0, 6));
  }

  return (
    <div className="px-4 pb-4 md:px-6 md:pb-5">
      <div className="mx-auto max-w-3xl">
        {attachments.length > 0 && (
          <div className="mb-2 flex flex-wrap gap-2">
            {attachments.map((a, i) => (
              <div key={i} className="glass-soft rounded-lg pl-2 pr-1 py-1 flex items-center gap-2 text-xs">
                {a.kind === "image" ? <ImageIcon size={12} className="text-accent-glow" /> : <Paperclip size={12} className="text-ink-muted" />}
                <span className="truncate max-w-[160px]">{a.name}</span>
                <button
                  onClick={() => setAttachments((arr) => arr.filter((_, j) => j !== i))}
                  className="text-ink-faint hover:text-danger p-0.5 rounded"
                  aria-label="Remove"
                >
                  <X size={11} />
                </button>
              </div>
            ))}
          </div>
        )}
        <div
          className={cn(
            "glass rounded-2xl p-2.5 flex items-end gap-2 transition shadow-[0_8px_30px_-12px_rgba(0,0,0,0.5)]",
            disabled && "opacity-60",
          )}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => { e.preventDefault(); ingestFiles(e.dataTransfer.files); }}
        >
          <div className="flex items-center gap-1 pb-1">
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={() => fileInputRef.current?.click()}
              title="Attach file"
              type="button"
            >
              <Paperclip size={15} />
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={() => imageInputRef.current?.click()}
              title="Attach image"
              type="button"
            >
              <ImageIcon size={15} />
            </Button>
          </div>

          <textarea
            ref={textareaRef}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={onKey}
            disabled={disabled}
            placeholder={placeholder || "Message Nova..."}
            rows={1}
            className="flex-1 min-w-0 resize-none bg-transparent border-0 outline-none text-[15px] leading-6 placeholder:text-ink-faint py-2 max-h-[220px]"
          />

          {streaming ? (
            <Button onClick={onStop} variant="secondary" size="icon" title="Stop">
              <Square size={14} className="fill-current" />
            </Button>
          ) : (
            <Button
              onClick={submit}
              disabled={disabled || (!text.trim() && attachments.length === 0)}
              size="icon"
              title="Send (Enter)"
            >
              <ArrowUp size={16} />
            </Button>
          )}

          <input
            ref={fileInputRef}
            type="file"
            multiple
            className="hidden"
            onChange={(e) => ingestFiles(e.target.files)}
          />
          <input
            ref={imageInputRef}
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            onChange={(e) => ingestFiles(e.target.files, "image")}
          />
        </div>
        <p className="mt-2 text-center text-[10px] text-ink-faint">
          <kbd className="px-1 py-0.5 rounded bg-white/5 border border-white/10 text-[9px]">⏎</kbd> send ·
          <kbd className="mx-1 px-1 py-0.5 rounded bg-white/5 border border-white/10 text-[9px]">⇧⏎</kbd> newline ·
          <kbd className="mr-1 px-1 py-0.5 rounded bg-white/5 border border-white/10 text-[9px]">⌘K</kbd> palette ·
          <kbd className="mx-1 px-1 py-0.5 rounded bg-white/5 border border-white/10 text-[9px]">⌘⏎</kbd> force send
        </p>
      </div>
    </div>
  );
}

function fileToDataURL(file: File): Promise<string> {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result as string);
    r.onerror = rej;
    r.readAsDataURL(file);
  });
}
