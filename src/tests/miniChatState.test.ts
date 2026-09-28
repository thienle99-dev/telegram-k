import {canOpenMiniChat, clampMiniChatState, isMiniChatViewportSupported, parseMiniChatState} from '@components/miniChat/state';

const validChat = {peerId: 42, left: 120, top: 80, width: 340, height: 480, minimized: false};

describe('mini chat saved state', () => {
  it('accepts the current version and caps restored windows at four', () => {
    const chats = [
      {...validChat, peerId: 1},
      {...validChat, peerId: 1},
      {...validChat, peerId: 2},
      {...validChat, peerId: 3},
      {...validChat, peerId: 4},
      {...validChat, peerId: 5}
    ];
    const parsed = parseMiniChatState(JSON.stringify({version: 1, chats}));

    expect(parsed).toHaveLength(4);
    expect(parsed.map(({peerId}) => peerId)).toEqual([1, 2, 3, 4]);
  });

  it('ignores invalid entries and unsupported versions', () => {
    expect(parseMiniChatState(JSON.stringify({version: 2, chats: [validChat]}))).toEqual([]);
    expect(parseMiniChatState(JSON.stringify({version: 1, chats: [{...validChat, width: NaN}]}))).toEqual([]);
    expect(parseMiniChatState('invalid json')).toEqual([]);
  });

  it('applies the desktop cutoff and four-window capacity', () => {
    expect(isMiniChatViewportSupported(767)).toBe(false);
    expect(isMiniChatViewportSupported(768)).toBe(true);
    expect(canOpenMiniChat(1200, 3)).toBe(true);
    expect(canOpenMiniChat(1200, 4)).toBe(false);
  });

  it('clamps restored geometry into the current viewport', () => {
    expect(clampMiniChatState({...validChat, left: 2000, top: 2000, width: 900, height: 900}, 800, 600)).toEqual({
      ...validChat,
      left: 16,
      top: 16,
      width: 768,
      height: 568
    });
  });
});
