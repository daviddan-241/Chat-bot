import { Router } from "express";
import { db } from "@workspace/db";
import { conversations, messages } from "@workspace/db/schema";
import { eq } from "drizzle-orm";

const router = Router();

const POLLINATIONS_BASE = "https://text.pollinations.ai/openai";

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

router.get("/conversations/:id/messages", async (req, res) => {
  try {
    const id = Number(req.params["id"]);
    const rows = await db.select().from(messages).where(eq(messages.conversationId, id)).orderBy(messages.createdAt);
    res.json({ messages: rows });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Failed to fetch messages" });
  }
});

router.post("/chat", async (req, res) => {
  try {
    const { conversationId, message: userMsg, model, systemPrompt, stream } = req.body as {
      conversationId?: number;
      message: string;
      model?: string;
      systemPrompt?: string;
      stream?: boolean;
    };

    let convId = conversationId;
    if (!convId) {
      const [conv] = await db.insert(conversations).values({
        title: userMsg.slice(0, 60),
      }).returning();
      convId = conv!.id;
    }

    await db.insert(messages).values({
      conversationId: convId,
      role: "user",
      content: userMsg,
    });

    const history = await db.select().from(messages).where(eq(messages.conversationId, convId)).orderBy(messages.createdAt);
    const chatMessages = history.map((m) => ({ role: m.role, content: m.content }));

    const sysMessages = systemPrompt
      ? [{ role: "system", content: systemPrompt }, ...chatMessages]
      : chatMessages;

    const shouldStream = stream !== false;

    if (shouldStream) {
      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("Connection", "keep-alive");
      res.flushHeaders();

      const response = await fetch(POLLINATIONS_BASE, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: model || "openai",
          messages: sysMessages,
          stream: true,
        }),
      });

      if (!response.ok) {
        res.write(`data: ${JSON.stringify({ error: "AI service error" })}\n\n`);
        res.end();
        return;
      }

      let fullContent = "";
      const reader = response.body!.getReader();
      const decoder = new TextDecoder();

      res.write(`data: ${JSON.stringify({ conversationId: convId })}\n\n`);

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value);
        const lines = chunk.split("\n");
        for (const line of lines) {
          if (line.startsWith("data: ")) {
            const data = line.slice(6).trim();
            if (data === "[DONE]") continue;
            try {
              const parsed = JSON.parse(data);
              const delta = parsed.choices?.[0]?.delta?.content;
              if (delta) {
                fullContent += delta;
                res.write(`data: ${JSON.stringify({ delta })}\n\n`);
              }
            } catch (_) {}
          }
        }
      }

      await db.insert(messages).values({
        conversationId: convId,
        role: "assistant",
        content: fullContent,
      });
      await db.update(conversations).set({ updatedAt: new Date() }).where(eq(conversations.id, convId));

      res.write(`data: ${JSON.stringify({ done: true, content: fullContent })}\n\n`);
      res.end();
    } else {
      const response = await fetch(POLLINATIONS_BASE, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: model || "openai",
          messages: sysMessages,
          stream: false,
        }),
      });

      const data = await response.json() as any;
      const content = data.choices?.[0]?.message?.content || "";

      await db.insert(messages).values({
        conversationId: convId,
        role: "assistant",
        content,
      });
      await db.update(conversations).set({ updatedAt: new Date() }).where(eq(conversations.id, convId));

      res.json({ content, conversationId: convId });
    }
  } catch (err) {
    req.log.error(err);
    if (!res.headersSent) res.status(500).json({ error: "Chat failed" });
  }
});

router.get("/models", async (_req, res) => {
  res.json({
    models: [
      { id: "openai", name: "GPT-4o (Pollinations)", provider: "pollinations" },
      { id: "openai-large", name: "GPT-4o Large", provider: "pollinations" },
      { id: "mistral", name: "Mistral Large", provider: "pollinations" },
      { id: "claude-hybridspace", name: "Claude Hybrid", provider: "pollinations" },
      { id: "llama", name: "Llama 3.3 70B", provider: "pollinations" },
      { id: "qwen-coder", name: "Qwen 2.5 Coder", provider: "pollinations" },
      { id: "deepseek", name: "DeepSeek R1", provider: "pollinations" },
      { id: "phi", name: "Phi-4", provider: "pollinations" },
    ],
  });
});

export default router;
