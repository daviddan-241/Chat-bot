import { Router } from "express";
import { exec } from "child_process";
import { promisify } from "util";
import path from "path";
import fs from "fs";
import { db } from "@workspace/db";
import { videoJobs } from "@workspace/db/schema";
import { eq } from "drizzle-orm";

const router = Router();
const execAsync = promisify(exec);

const uploadsDir = path.join(process.cwd(), "uploads");
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

router.get("/jobs", async (_req, res) => {
  try {
    const jobs = await db.select().from(videoJobs).orderBy(videoJobs.createdAt);
    res.json({ jobs: jobs.reverse() });
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch video jobs" });
  }
});

router.get("/jobs/:id", async (req, res) => {
  try {
    const [job] = await db.select().from(videoJobs).where(eq(videoJobs.id, Number(req.params["id"])));
    if (!job) { res.status(404).json({ error: "Job not found" }); return; }
    res.json(job);
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch job" });
  }
});

router.post("/process", async (req, res) => {
  try {
    const { operation, inputPath, outputName, options } = req.body as {
      operation: string;
      inputPath: string;
      outputName?: string;
      options?: Record<string, string | number>;
    };

    if (!operation || !inputPath) {
      res.status(400).json({ error: "operation and inputPath are required" });
      return;
    }

    const outputFile = outputName || `output_${Date.now()}.mp4`;
    const outputPath = path.join(uploadsDir, outputFile);

    const [job] = await db.insert(videoJobs).values({
      operation,
      inputPath,
      outputPath,
      status: "queued",
      options: options ? JSON.stringify(options) : null,
    }).returning();

    await db.update(videoJobs).set({ status: "running" }).where(eq(videoJobs.id, job!.id));

    let ffmpegCmd = "";
    switch (operation) {
      case "compress":
        ffmpegCmd = `ffmpeg -i "${inputPath}" -vcodec libx264 -crf 28 "${outputPath}" -y`;
        break;
      case "convert_mp4":
        ffmpegCmd = `ffmpeg -i "${inputPath}" "${outputPath}" -y`;
        break;
      case "extract_audio":
        const audioOut = outputPath.replace(".mp4", ".mp3");
        ffmpegCmd = `ffmpeg -i "${inputPath}" -q:a 0 -map a "${audioOut}" -y`;
        break;
      case "trim":
        const { start = "0", duration = "30" } = (options || {}) as Record<string, string>;
        ffmpegCmd = `ffmpeg -i "${inputPath}" -ss ${start} -t ${duration} -c copy "${outputPath}" -y`;
        break;
      case "resize":
        const { width = 1280, height = 720 } = (options || {}) as Record<string, string | number>;
        ffmpegCmd = `ffmpeg -i "${inputPath}" -vf scale=${width}:${height} "${outputPath}" -y`;
        break;
      case "thumbnail":
        const thumbOut = outputPath.replace(".mp4", ".jpg");
        ffmpegCmd = `ffmpeg -i "${inputPath}" -ss 00:00:01.000 -vframes 1 "${thumbOut}" -y`;
        break;
      default:
        await db.update(videoJobs).set({ status: "failed", error: "Unknown operation" }).where(eq(videoJobs.id, job!.id));
        res.status(400).json({ error: "Unknown operation" });
        return;
    }

    res.json({ jobId: job!.id, status: "running", message: "Processing started" });

    execAsync(ffmpegCmd)
      .then(async () => {
        await db.update(videoJobs).set({ status: "completed", outputPath }).where(eq(videoJobs.id, job!.id));
      })
      .catch(async (err) => {
        await db.update(videoJobs).set({ status: "failed", error: String(err.message).slice(0, 500) }).where(eq(videoJobs.id, job!.id));
      });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Video processing failed" });
  }
});

export default router;
