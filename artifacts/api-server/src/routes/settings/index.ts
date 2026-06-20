import { Router } from "express";
import { db } from "@workspace/db";
import { settingsTable } from "@workspace/db/schema";

const router = Router();

router.get("/", async (_req, res) => {
  try {
    const rows = await db.select().from(settingsTable).limit(1);
    const row = rows[0];
    if (!row) {
      const [newRow] = await db.insert(settingsTable).values({}).returning();
      const s = newRow!;
      res.json({ settings: { ollama_url: s.ollamaUrl, default_model: s.defaultModel, default_image_model: s.imageModel } });
      return;
    }
    res.json({ settings: { ollama_url: row.ollamaUrl, default_model: row.defaultModel, default_image_model: row.imageModel } });
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch settings" });
  }
});

router.post("/", async (req, res) => {
  try {
    const body = req.body as Record<string, string>;
    const update: Record<string, string> = {};
    if (body["ollama_url"] !== undefined) update["ollamaUrl"] = body["ollama_url"];
    if (body["default_model"] !== undefined) update["defaultModel"] = body["default_model"];
    if (body["default_image_model"] !== undefined) update["imageModel"] = body["default_image_model"];

    const rows = await db.select().from(settingsTable).limit(1);
    if (rows.length === 0) {
      await db.insert(settingsTable).values({ ...update });
    } else {
      await db.update(settingsTable).set({ ...update, updatedAt: new Date() });
    }
    res.json({ ok: true });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Failed to update settings" });
  }
});

export default router;
