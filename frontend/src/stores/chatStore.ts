import { create } from "zustand";
import * as api from "@/utils/tauri";
import type { ChatSession, ChatMessageRecord, AgentAction } from "@/utils/tauri";

interface ChatState {
  sessions: ChatSession[];
  currentSessionId: string | null;
  messages: ChatMessageRecord[];
  loadSessions: () => Promise<void>;
  newSession: () => Promise<string>;
  openSession: (id: string) => Promise<void>;
  addMessage: (
    role: "user" | "assistant",
    text: string,
    actions?: AgentAction[],
    executed?: boolean,
  ) => Promise<ChatMessageRecord>;
  markExecuted: (messageId: string) => Promise<void>;
  deleteSession: (id: string) => Promise<void>;
}

export const useChatStore = create<ChatState>((set, get) => ({
  sessions: [],
  currentSessionId: null,
  messages: [],

  loadSessions: async () => {
    const sessions = await api.listChatSessions();
    set({ sessions });
  },

  newSession: async () => {
    const session = await api.createChatSession();
    set((s) => ({
      sessions: [session, ...s.sessions],
      currentSessionId: session.id,
      messages: [],
    }));
    return session.id;
  },

  openSession: async (id) => {
    const messages = await api.getChatMessages(id);
    set({ currentSessionId: id, messages });
  },

  addMessage: async (role, text, actions, executed = false) => {
    let sessionId = get().currentSessionId;
    if (!sessionId) {
      sessionId = await get().newSession();
    }
    const actionsJson = actions ? JSON.stringify(actions) : null;
    const msg = await api.addChatMessage(sessionId, role, text, actionsJson, executed);
    set((s) => {
      const updated = [...s.messages, msg];
      // Update session title from first user message
      if (role === "user" && s.messages.length === 0) {
        const title = text.slice(0, 80);
        return {
          messages: updated,
          sessions: s.sessions.map((ss) =>
            ss.id === sessionId ? { ...ss, title } : ss
          ),
        };
      }
      return { messages: updated };
    });
    return msg;
  },

  markExecuted: async (messageId) => {
    await api.updateChatMessage(messageId, true);
    set((s) => ({
      messages: s.messages.map((m) =>
        m.id === messageId ? { ...m, executed: true } : m
      ),
    }));
  },

  deleteSession: async (id) => {
    await api.deleteChatSession(id);
    set((s) => {
      const sessions = s.sessions.filter((ss) => ss.id !== id);
      if (s.currentSessionId === id) {
        return { sessions, currentSessionId: null, messages: [] };
      }
      return { sessions };
    });
  },
}));
