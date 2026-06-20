import { Router } from "express";
import { db } from "@workspace/db";
import { settingsTable } from "@workspace/db/schema";

const router = Router();

// Fields sent TO the client (never expose raw API keys — only masked status)
function toPublic(row: typeof settingsTable.$inferSelect) {
  return {
    ollama_url:           row.ollamaUrl,
    default_model:        row.defaultModel,
    default_image_model:  row.imageModel,
    image_width:          row.imageWidth,
    image_height:         row.imageHeight,
    system_prompt:        row.systemPrompt,
    custom_base_url:      row.customBaseUrl ?? "",
    // Return true/false so the UI can show "Key saved ✓" without leaking the value
    has_openai_key:       !!row.openaiApiKey,
    has_anthropic_key:    !!row.anthropicApiKey,
    has_google_key:       !!row.googleApiKey,
    has_groq_key:         !!row.groqApiKey,
    has_replicate_key:    !!row.replicateApiKey,
    has_custom_key:       !!row.customApiKey,
  };
}

router.get("/", async (_req, res) => {
  try {
    const rows = await db.select().from(settingsTable).limit(1);
    const row = rows[0];
    if (!row) {
      const [newRow] = await db.insert(settingsTable).values({}).returning();
      res.json({ settings: toPublic(newRow!) });
      return;
    }
    res.json({ settings: toPublic(row) });
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch settings" });
  }
});

router.post("/", async (req, res) => {
  try {
    const body = req.body as Record<string, string>;
    const update: Record<string, string | number> = {};

    if (body["ollama_url"]          !== undefined) update["ollamaUrl"]      = body["ollama_url"];
    if (body["default_model"]       !== undefined) update["defaultModel"]   = body["default_model"];
    if (body["default_image_model"] !== undefined) update["imageModel"]     = body["default_image_model"];
    if (body["system_prompt"]       !== undefined) update["systemPrompt"]   = body["system_prompt"];
    if (body["custom_base_url"]     !== undefined) update["customBaseUrl"]  = body["custom_base_url"];
    // API keys — only written if sent; empty string clears the key
    if (body["openai_api_key"]      !== undefined) update["openaiApiKey"]   = body["openai_api_key"];
    if (body["anthropic_api_key"]   !== undefined) update["anthropicApiKey"]= body["anthropic_api_key"];
    if (body["google_api_key"]      !== undefined) update["googleApiKey"]   = body["google_api_key"];
    if (body["groq_api_key"]        !== undefined) update["groqApiKey"]     = body["groq_api_key"];
    if (body["replicate_api_key"]   !== undefined) update["replicateApiKey"]= body["replicate_api_key"];
    if (body["custom_api_key"]      !== undefined) update["customApiKey"]   = body["custom_api_key"];

    const rows = await db.select().from(settingsTable).limit(1);
    let updated;
    if (rows.length === 0) {
      [updated] = await db.insert(settingsTable).values({ ...update }).returning();
    } else {
      [updated] = await db.update(settingsTable).set({ ...update, updatedAt: new Date() }).returning();
    }
    res.json({ ok: true, settings: toPublic(updated!) });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Failed to update settings" });
  }
});

// DELETE a single API key by name
router.delete("/key/:name", async (req, res) => {
  try {
    const keyMap: Record<string, string> = {
      openai:    "openaiApiKey",
      anthropic: "anthropicApiKey",
      google:    "googleApiKey",
      groq:      "groqApiKey",
      replicate: "replicateApiKey",
      custom:    "customApiKey",
    };
    const field = keyMap[req.params["name"] ?? ""];
    if (!field) { res.status(400).json({ error: "Unknown key name" }); return; }
    await db.update(settingsTable).set({ [field]: null, updatedAt: new Date() });
    res.json({ ok: true });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Failed to delete key" });
  }
});

export default router;
