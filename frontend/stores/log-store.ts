import { create } from "zustand";

export type LogLevel = "info" | "tool" | "stream" | "error" | "success";

export interface LogEntry {
  id: string;
  ts: number;
  level: LogLevel;
  message: string;
  data?: Record<string, unknown>;
}

interface LogState {
  entries: LogEntry[];
  push: (level: LogLevel, message: string, data?: Record<string, unknown>) => void;
  clear: () => void;
}

let _id = 0;

export const useLogStore = create<LogState>((set) => ({
  entries: [],
  push: (level, message, data) =>
    set((s) => ({
      entries: [
        ...s.entries.slice(-499),
        { id: `${Date.now()}-${++_id}`, ts: Date.now(), level, message, data },
      ],
    })),
  clear: () => set({ entries: [] }),
}));
