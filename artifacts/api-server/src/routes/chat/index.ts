import { Router } from "express";
import { db } from "@workspace/db";
import { conversations, messages } from "@workspace/db/schema";
import { eq } from "drizzle-orm";

const router = Router();
const POLLINATIONS_BASE = "https://text.pollinations.ai/openai";

/* ── Conversations ─────────────────────────── */

router.get("/conversations", async (req, res) => {
  try {
    const rows = await db.select().from(conversations).orderBy(conversations.updatedAt);
    res.json({ conversations: rows.reverse() });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Failed to fetch conversations" });
  }
});

router.post("/conversations", async (req, res) => {
  try {
    const { title } = req.body as { title?: string };
    const [conv] = await db.insert(conversations).values({ title: title || "New Chat" }).returning();
    res.json(conv);
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Failed to create conversation" });
  }
});

router.get("/conversations/:id", async (req, res) => {
  try {
    const id = Number(req.params["id"]);
    const [conv] = await db.select().from(conversations).where(eq(conversations.id, id));
    if (!conv) { res.status(404).json({ error: "Conversation not found" }); return; }
    const msgs = await db.select().from(messages).where(eq(messages.conversationId, id)).orderBy(messages.createdAt);
    res.json({ ...conv, messages: msgs });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Failed to fetch conversation" });
  }
});

router.delete("/conversations/:id", async (req, res) => {
  try {
    const id = Number(req.params["id"]);
    await db.delete(messages).where(eq(messages.conversationId, id));
    await db.delete(conversations).where(eq(conversations.id, id));
    res.json({ ok: true });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Failed to delete conversation" });
  }
});

/* ── Streaming chat (used by ChatPage + AgentsPage) ── */

router.post("/stream", async (req, res) => {
  try {
    const { conversationId, message: userMsg, model, systemPrompt, history } = req.body as {
      conversationId?: number;
      message: string;
      model?: string;
      systemPrompt?: string;
      history?: { role: string; content: string }[];
    };

    if (!userMsg) { res.status(400).json({ error: "message is required" }); return; }

    // Persist to DB only for regular chat (no system prompt = user-facing chat)
    let convId = conversationId;
    if (!systemPrompt) {
      if (!convId) {
        const [conv] = await db.insert(conversations)
          .values({ title: userMsg.slice(0, 60) })
          .returning();
        convId = conv!.id;
      }
      await db.insert(messages).values({ conversationId: convId, role: "user", content: userMsg });
    }

    // Build message array: system prompt → history → latest user message
    const chatMessages: { role: string; content: string }[] = [];
    if (systemPrompt) chatMessages.push({ role: "system", content: systemPrompt });
    if (history && history.length > 0) {
      chatMessages.push(...history);
    } else if (convId && !systemPrompt) {
      // Load history from DB
      const dbMsgs = await db.select().from(messages)
        .where(eq(messages.conversationId, convId))
        .orderBy(messages.createdAt);
      chatMessages.push(...dbMsgs.map(m => ({ role: m.role, content: m.content })));
    }

    // Add current user message if not already in history
    const lastMsg = chatMessages[chatMessages.length - 1];
    if (!lastMsg || lastMsg.role !== "user" || lastMsg.content !== userMsg) {
      chatMessages.push({ role: "user", content: userMsg });
    }

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders();

    if (convId) res.write(`data: ${JSON.stringify({ conversationId: convId })}\n\n`);

    const response = await fetch(POLLINATIONS_BASE, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: model || "openai",
        messages: chatMessages,
        stream: true,
      }),
    });

    if (!response.ok || !response.body) {
      res.write(`data: ${JSON.stringify({ content: "AI service unavailable. Please try again." })}\n\n`);
      res.write("data: [DONE]\n\n");
      res.end();
      return;
    }

    let fullContent = "";
    const reader = response.body.getReader();
    const decoder = new TextDecoder();

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = decoder.decode(value, { stream: true });
      for (const line of chunk.split("\n")) {
        if (!line.startsWith("data: ")) continue;
        const raw = line.slice(6).trim();
        if (raw === "[DONE]") continue;
        try {
          const parsed = JSON.parse(raw);
          const token = parsed.choices?.[0]?.delta?.content;
          if (token) {
            fullContent += token;
            // Send "content" field — what the frontend expects
            res.write(`data: ${JSON.stringify({ content: token })}\n\n`);
          }
        } catch (_) {}
      }
    }

    // Persist assistant reply to DB
    if (convId && !systemPrompt && fullContent) {
      await db.insert(messages).values({ conversationId: convId, role: "assistant", content: fullContent });
      await db.update(conversations).set({ updatedAt: new Date() }).where(eq(conversations.id, convId));
    }

    res.write("data: [DONE]\n\n");
    res.end();
  } catch (err) {
    req.log.error(err);
    if (!res.headersSent) res.status(500).json({ error: "Chat failed" });
    else { res.write("data: [DONE]\n\n"); res.end(); }
  }
});

/* ── Non-streaming (fallback) ── */

router.post("/chat", async (req, res) => {
  try {
    const { conversationId, message: userMsg, model, systemPrompt } = req.body as {
      conversationId?: number; message: string; model?: string; systemPrompt?: string;
    };

    let convId = conversationId;
    if (!convId) {
      const [conv] = await db.insert(conversations).values({ title: userMsg.slice(0, 60) }).returning();
      convId = conv!.id;
    }
    await db.insert(messages).values({ conversationId: convId, role: "user", content: userMsg });

    const history = await db.select().from(messages)
      .where(eq(messages.conversationId, convId))
      .orderBy(messages.createdAt);

    const chatMessages = systemPrompt
      ? [{ role: "system", content: systemPrompt }, ...history.map(m => ({ role: m.role, content: m.content }))]
      : history.map(m => ({ role: m.role, content: m.content }));

    const response = await fetch(POLLINATIONS_BASE, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: model || "openai", messages: chatMessages, stream: false }),
    });

    const data = await response.json() as { choices?: { message?: { content?: string } }[] };
    const content = data.choices?.[0]?.message?.content || "";

    await db.insert(messages).values({ conversationId: convId, role: "assistant", content });
    await db.update(conversations).set({ updatedAt: new Date() }).where(eq(conversations.id, convId));

    res.json({ content, conversationId: convId });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Chat failed" });
  }
});

/* ── Models ── */

router.get("/models", (_req, res) => {
  res.json({
    models: [
      { id: "openai",        name: "GPT-4o",           provider: "pollinations" },
      { id: "openai-large",  name: "GPT-4o Large",      provider: "pollinations" },
      { id: "mistral",       name: "Mistral Large",     provider: "pollinations" },
      { id: "llama",         name: "Llama 3.3 70B",     provider: "pollinations" },
      { id: "qwen-coder",    name: "Qwen 2.5 Coder",    provider: "pollinations" },
      { id: "deepseek",      name: "DeepSeek R1",       provider: "pollinations" },
      { id: "phi",           name: "Phi-4",             provider: "pollinations" },
    ],
  });
});

export default router;
