export type MiniChatState = {peerId: PeerId, left: number, top: number, width: number, height: number, minimized: boolean};
export type StoredMiniChatState = {version: 1, chats: MiniChatState[]};

export const MINI_CHAT_STORAGE_KEY = 'tweb-mini-chats-v1';
export const MINI_CHAT_MAX_COUNT = 4;
export const MINI_CHAT_MIN_WIDTH = 300;
export const MINI_CHAT_MIN_HEIGHT = 260;
export const MINI_CHAT_MIN_VIEWPORT_WIDTH = 768;

export function parseMiniChatState(value: string | null): MiniChatState[] {
  try {
    const stored = JSON.parse(value || 'null') as StoredMiniChatState;
    if(stored?.version !== 1 || !Array.isArray(stored.chats)) return [];
    const seen = new Set<number>();
    return stored.chats.filter((item) => {
      if(!item || !Number.isSafeInteger(item.peerId) || seen.has(item.peerId) ||
        !Number.isFinite(item.left) || !Number.isFinite(item.top) ||
        !Number.isFinite(item.width) || !Number.isFinite(item.height) || typeof item.minimized !== 'boolean') return false;
      seen.add(item.peerId);
      return true;
    }).slice(0, MINI_CHAT_MAX_COUNT);
  } catch(_err) {
    return [];
  }
}

export function isMiniChatViewportSupported(width: number) {
  return width >= MINI_CHAT_MIN_VIEWPORT_WIDTH;
}

export function canOpenMiniChat(width: number, openCount: number) {
  return isMiniChatViewportSupported(width) && openCount < MINI_CHAT_MAX_COUNT;
}

export function clampMiniChatState(state: MiniChatState, viewportWidth: number, viewportHeight: number) {
  const width = Math.min(Math.max(MINI_CHAT_MIN_WIDTH, viewportWidth - 32), Math.max(MINI_CHAT_MIN_WIDTH, state.width));
  const height = Math.min(Math.max(MINI_CHAT_MIN_HEIGHT, viewportHeight - 32), Math.max(MINI_CHAT_MIN_HEIGHT, state.height));
  return {
    ...state,
    width,
    height,
    left: Math.min(viewportWidth - width - 16, Math.max(16, state.left)),
    top: Math.min(viewportHeight - (state.minimized ? 48 : height) - 16, Math.max(16, state.top))
  };
}
