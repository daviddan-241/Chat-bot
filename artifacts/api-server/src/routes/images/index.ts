import { Router } from "express";
import { db } from "@workspace/db";
import { generatedImages } from "@workspace/db/schema";
import { desc } from "drizzle-orm";

const router = Router();

router.post("/generate", async (req, res) => {
  try {
    const { prompt, width = 1024, height = 1024, model = "flux", nologo = true } = req.body as {
      prompt: string;
      width?: number;
      height?: number;
      model?: string;
      nologo?: boolean;
    };

    if (!prompt) {
      res.status(400).json({ error: "prompt is required" });
      return;
    }

    const encoded = encodeURIComponent(prompt);
    const url = `https://image.pollinations.ai/prompt/${encoded}?width=${width}&height=${height}&model=${model}&nologo=${nologo}&seed=${Math.floor(Math.random() * 1000000)}`;

    const [record] = await db.insert(generatedImages).values({
      prompt,
      url,
      width,
      height,
      model,
    }).returning();

    res.json({ url, id: record!.id, prompt });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Image generation failed" });
  }
});

router.get("/gallery", async (_req, res) => {
  try {
    const images = await db.select().from(generatedImages).orderBy(desc(generatedImages.createdAt)).limit(50);
    res.json({ images });
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch gallery" });
  }
});

export default router;
