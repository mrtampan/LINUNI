class FlowSessionStore {
  constructor() {
    this.sessions = new Map();
  }

  getSession(chatId) {
    return this.sessions.get(String(chatId)) || null;
  }

  setSession(chatId, sessionData) {
    this.sessions.set(String(chatId), {
      ...sessionData,
      updatedAt: Date.now(),
    });
  }

  clearSession(chatId) {
    this.sessions.delete(String(chatId));
  }
}

export const sessionStore = new FlowSessionStore();
