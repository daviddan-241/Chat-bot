import { pgTable, serial, text, integer, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const settingsTable = pgTable("settings", {
  id: serial("id").primaryKey(),
  aiProvider: text("ai_provider").notNull().default("pollinations"),
  ollamaUrl: text("ollama_url").notNull().default(""),
  defaultModel: text("default_model").notNull().default("openai"),
  imageModel: text("image_model").notNull().default("flux"),
  imageWidth: integer("image_width").notNull().default(1024),
  imageHeight: integer("image_height").notNull().default(1024),
  theme: text("theme").notNull().default("light"),
  systemPrompt: text("system_prompt").notNull().default("You are a helpful AI assistant."),
  // API keys — stored server-side, never sent to frontend in plaintext
  openaiApiKey: text("openai_api_key"),
  anthropicApiKey: text("anthropic_api_key"),
  googleApiKey: text("google_api_key"),
  groqApiKey: text("groq_api_key"),
  replicateApiKey: text("replicate_api_key"),
  customApiKey: text("custom_api_key"),
  customBaseUrl: text("custom_base_url"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const insertSettingsSchema = createInsertSchema(settingsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertSettings = z.infer<typeof insertSettingsSchema>;
export type Settings = typeof settingsTable.$inferSelect;
