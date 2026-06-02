import { create } from "zustand";

interface AgentState {
  /** Currently selected agent for new chats / agent override on the current chat */
  selectedAgentId: string | null;
  setSelectedAgentId: (id: string | null) => void;
}

const KEY = "aiw_selected_agent";

export const useAgentStore = create<AgentState>((set) => ({
  selectedAgentId: typeof window !== "undefined" ? localStorage.getItem(KEY) : null,
  setSelectedAgentId: (id) => {
    if (typeof window !== "undefined") {
      if (id) localStorage.setItem(KEY, id);
      else localStorage.removeItem(KEY);
    }
    set({ selectedAgentId: id });
  },
}));
