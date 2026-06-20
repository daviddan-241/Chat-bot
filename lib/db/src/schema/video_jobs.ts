import { pgTable, serial, text, integer, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const videoJobs = pgTable("video_jobs", {
  id: serial("id").primaryKey(),
  status: text("status").notNull().default("pending"),
  inputFileId: integer("input_file_id").notNull(),
  outputFileId: integer("output_file_id"),
  operation: text("operation").notNull(),
  progress: integer("progress").notNull().default(0),
  error: text("error"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const insertVideoJobSchema = createInsertSchema(videoJobs).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertVideoJob = z.infer<typeof insertVideoJobSchema>;
export type VideoJob = typeof videoJobs.$inferSelect;
