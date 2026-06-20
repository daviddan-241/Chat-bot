import { Router } from "express";
import multer from "multer";
import path from "path";
import fs from "fs";
import { db } from "@workspace/db";
import { uploadedFiles } from "@workspace/db/schema";
import { eq } from "drizzle-orm";

const router = Router();

const uploadDir = path.join(process.cwd(), "uploads");
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadDir),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`);
  },
});
const upload = multer({ storage, limits: { fileSize: 100 * 1024 * 1024 } });

router.get("/", async (_req, res) => {
  try {
    const files = await db.select().from(uploadedFiles).orderBy(uploadedFiles.createdAt);
    res.json({ files: files.reverse() });
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch files" });
  }
});

router.post("/upload", upload.single("file"), async (req, res) => {
  try {
    if (!req.file) { res.status(400).json({ error: "No file provided" }); return; }
    const [record] = await db.insert(uploadedFiles).values({
      filename: req.file.filename,
      originalName: req.file.originalname,
      mimeType: req.file.mimetype,
      size: req.file.size,
      path: req.file.path,
    }).returning();
    res.json({ file: record });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Upload failed" });
  }
});

router.get("/:id/download", async (req, res) => {
  try {
    const [file] = await db.select().from(uploadedFiles).where(eq(uploadedFiles.id, Number(req.params["id"])));
    if (!file) { res.status(404).json({ error: "File not found" }); return; }
    res.download(file.path, file.originalName);
  } catch (err) {
    res.status(500).json({ error: "Download failed" });
  }
});

router.delete("/:id", async (req, res) => {
  try {
    const [file] = await db.select().from(uploadedFiles).where(eq(uploadedFiles.id, Number(req.params["id"])));
    if (file) {
      try { fs.unlinkSync(file.path); } catch (_) {}
      await db.delete(uploadedFiles).where(eq(uploadedFiles.id, file.id));
    }
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: "Delete failed" });
  }
});

export default router;
