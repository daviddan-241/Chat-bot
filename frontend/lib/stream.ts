/**
 * SSE streaming client for POST /ai/stream.
 *
 * EventSource only supports GET, so we use fetch + ReadableStream to consume
 * the SSE response and parse "event:" / "data:" blocks manually.
 */
import type { StreamEvent } from "./types";
import { auth } from "./api";

export interface StreamOptions {
  chatId: string;
  content: string;
  model?: string;
  systemPrompt?: string;
  agentId?: string | null;
  provider?: string | null;
  temperature?: number | null;
  signal?: AbortSignal;
  onEvent: (e: StreamEvent) => void;
}

export async function streamChat(opts: StreamOptions): Promise<void> {
  const token = auth.access;
  if (!token) throw new Error("Not authenticated");

  const res = await fetch("/api/backend/ai/stream", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "text/event-stream",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      chat_id: opts.chatId,
      content: opts.content,
      model: opts.model,
      system_prompt: opts.systemPrompt,
      agent_id: opts.agentId ?? undefined,
      provider: opts.provider ?? undefined,
      temperature: opts.temperature ?? undefined,
    }),
    signal: opts.signal,
  });

  if (!res.ok || !res.body) {
    const errText = await res.text().catch(() => res.statusText);
    throw new Error(`Stream failed (${res.status}): ${errText.slice(0, 200)}`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });

      let idx: number;
      // SSE separates events with "\n\n"
      while ((idx = buf.indexOf("\n\n")) !== -1) {
        const block = buf.slice(0, idx);
        buf = buf.slice(idx + 2);
        const evt = parseSSEBlock(block);
        if (evt) opts.onEvent(evt);
      }
    }
  } finally {
    try { reader.releaseLock(); } catch {}
  }
}

function parseSSEBlock(block: string): StreamEvent | null {
  let event = "message";
  const dataLines: string[] = [];
  for (const rawLine of block.split("\n")) {
    const line = rawLine.replace(/\r$/, "");
    if (!line) continue;
    if (line.startsWith("event:")) event = line.slice(6).trim();
    else if (line.startsWith("data:")) dataLines.push(line.slice(5).trim());
  }
  if (!dataLines.length) return null;
  const dataStr = dataLines.join("\n");
  let payload: Record<string, unknown> = {};
  try { payload = JSON.parse(dataStr); } catch { payload = { raw: dataStr }; }
  return { type: event, ...payload } as StreamEvent;
}
