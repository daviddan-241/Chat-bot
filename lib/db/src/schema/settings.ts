import { pgTable, serial, text, integer, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const settingsTable = pgTable("settings", {
  id: serial("id").primaryKey(),
  aiProvider: text("ai_provider").notNull().default("pollinations"),
  ollamaUrl: text("ollama_url").notNull().default("http://localhost:11434"),
  defaultModel: text("default_model").notNull().default("openai"),
  imageModel: text("image_model").notNull().default("flux"),
  imageWidth: integer("image_width").notNull().default(1024),
  imageHeight: integer("image_height").notNull().default(1024),
  theme: text("theme").notNull().default("dark"),
  systemPrompt: text("system_prompt").notNull().default("You are a helpful AI assistant."),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const insertSettingsSchema = createInsertSchema(settingsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertSettings = z.infer<typeof insertSettingsSchema>;
export type Settings = typeof settingsTable.$inferSelect;
