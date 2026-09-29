import Chat from '@components/chat/chat';
import {ChatType} from '@components/chat/chatType';
import type {AppManagers} from '@lib/managers';
import appImManager from '@lib/appImManager';
import {i18n, LangPackKey} from '@lib/langPack';
import getPeerTitle from '@components/wrappers/getPeerTitle';
import {avatarNew} from '@components/avatarNew';
import Icon from '@components/icon';
import mediaSizes from '@helpers/mediaSizes';
import {getMiddleware} from '@helpers/middleware';
import mirrorDocumentStyles from '@helpers/dom/mirrorDocumentStyles';
import apiManagerProxy from '@lib/apiManagerProxy';
import rootScope from '@lib/rootScope';
import DOCUMENT_PICTURE_IN_PICTURE_SUPPORTED from '@environment/documentPictureInPictureSupport';
import {clearDelegatedEvents, delegateEvents} from 'solid-js/web';
import {logger} from '@lib/logger';
import {canOpenMiniChat, clampMiniChatState, isMiniChatViewportSupported, MINI_CHAT_MIN_HEIGHT, MINI_CHAT_MIN_WIDTH, MINI_CHAT_STORAGE_KEY, parseMiniChatState} from '@components/miniChat/state';
import type {MiniChatState} from '@components/miniChat/state';
import './miniChat.scss';

const log = logger('MINI-CHAT');

type MiniChatEntry = {state: MiniChatState, element: HTMLElement, chat: Chat, title: HTMLElement, badge: HTMLElement, newMessages: number, opener?: HTMLElement, avatar: ReturnType<typeof avatarNew>, avatarMiddleware: ReturnType<typeof getMiddleware>};
type MiniChatWindowSession = {window: Window, entry: MiniChatEntry, placeholder: Comment, disposeStyles: () => void, reset: HTMLStyleElement, onPageHide: () => void, focusTarget?: HTMLElement};

class MiniChatManager {
  private entries = new Map<PeerId, MiniChatEntry>();
  private floating: MiniChatWindowSession | undefined;
  private host = document.createElement('div');
  private zIndex = 500;
  private restored = false;
  private dismissedPipPeers = new Set<PeerId>();
  private managers: AppManagers;

  constructor() {
    this.host.className = 'mini-chats-host';
    document.body.append(this.host);
    window.addEventListener('resize', this.onResize);
    mediaSizes.addEventListener('changeScreen', this.onResize);
    rootScope.addEventListener('history_append', this.onHistoryAppend);
    rootScope.addEventListener('dialog_unread', this.onDialogUnread);
    rootScope.addEventListener('peer_deleted', this.onPeerDeleted);
  }

  public open(peerId: PeerId | undefined, managers: AppManagers, opener?: HTMLElement) {
    this.managers = managers;
    if(!isMiniChatViewportSupported(window.innerWidth) || !this.isSupported(peerId)) return;
    this.restore(managers);
    const existing = this.entries.get(peerId);
    if(existing) {
      const pipWasDismissed = this.dismissedPipPeers.delete(peerId);
      existing.state.minimized = false;
      existing.element.hidden = false;
      existing.element.classList.remove('is-minimized');
      if(!pipWasDismissed) void this.openInWindow(existing);
      return;
    }
    this.dismissedPipPeers.delete(peerId);
    if(!canOpenMiniChat(window.innerWidth, this.entries.size)) return;
    const state: MiniChatState = {
      peerId,
      left: Math.max(16, window.innerWidth - 520 - this.entries.size * 24),
      top: Math.max(16, window.innerHeight - 520 - this.entries.size * 24),
      width: 480,
      height: 650,
      minimized: false
    };
    const entry = this.mount(state, managers, opener);
    void this.openInWindow(entry);
  }

  public restoreOnStart(managers: AppManagers) {
    this.managers = managers;
    this.restore(managers);
  }

  private restore(managers: AppManagers) {
    if(this.restored) return;
    if(!isMiniChatViewportSupported(window.innerWidth)) return;
    this.restored = true;
    let serialized: string;
    try {
      serialized = localStorage.getItem(MINI_CHAT_STORAGE_KEY);
    } catch(_err) {
      return;
    }
    parseMiniChatState(serialized).forEach((state) => {
      if(this.isSupported(state.peerId) && canOpenMiniChat(window.innerWidth, this.entries.size)) this.mount(state, managers);
    });
  }

  private isSupported(peerId: PeerId | undefined): peerId is PeerId {
    if(typeof peerId !== 'number' || !Number.isSafeInteger(peerId) || peerId === 0) return false;
    if(peerId.isUser()) return peerId !== rootScope.myId;
    if(!peerId.isAnyChat() || apiManagerProxy.isForum(peerId) || apiManagerProxy.isBotforum(peerId)) return false;
    const peer = apiManagerProxy.getChat(peerId.toChatId());
    return !!peer && (peer._ === 'chat' || (peer._ === 'channel' && !peer.pFlags.broadcast));
  }

  private mount(state: MiniChatState, managers: AppManagers, opener?: HTMLElement): MiniChatEntry {
    const element = document.createElement('section');
    element.className = 'mini-chat-window detached-chat-window';
    element.setAttribute('aria-label', i18n('MiniChat.Title').textContent);
    element.style.width = `${state.width}px`;
    element.style.height = `${state.height}px`;

    const header = document.createElement('header');
    header.className = 'mini-chat-header';
    const avatarMiddleware = getMiddleware();
    const avatar = avatarNew({peerId: state.peerId, size: 40, middleware: avatarMiddleware.get(), isDialog: true});
    avatar.node.classList.add('mini-chat-avatar');
    const title = document.createElement('div');
    title.className = 'mini-chat-title';
    title.textContent = String(state.peerId);
    const controls = document.createElement('div');
    controls.className = 'mini-chat-controls';
    const minimize = this.button(state.minimized ? 'MiniChat.Restore' : 'MiniChat.Minimize', state.minimized ? '□' : '−', () => this.minimize(state.peerId));
    minimize.setAttribute('aria-expanded', String(!state.minimized));
    const maximize = this.button('MiniChat.PictureInPicture', '', () => {
      const entry = this.entries.get(state.peerId);
      if(entry) void this.openInWindow(entry);
    });
    maximize.append(Icon('pip_enter', 'mini-chat-control-icon'));
    const close = this.button('MiniChat.Close', '×', () => this.close(state.peerId));
    controls.append(minimize, maximize, close);
    const badge = document.createElement('span');
    badge.className = 'mini-chat-badge';
    badge.hidden = true;
    badge.setAttribute('role', 'status');
    badge.setAttribute('aria-live', 'polite');
    header.append(avatar.node, title, badge, controls);
    element.append(header);

    const chat = new Chat(appImManager, managers, false, {sharedMedia: true});
    chat.isPreview = true;
    chat.isMiniChat = true;
    chat.isStandalone = true;
    chat.onPreviewClose = () => this.close(state.peerId);
    chat.setType(ChatType.Chat);
    chat.recomputePaddings();
    chat.container.classList.add('mini-chat-content', 'detached-chat', 'active');
    chat.container.id = `mini-chat-content-${state.peerId}`;
    minimize.setAttribute('aria-controls', chat.container.id);
    element.append(chat.container);
    element.addEventListener('pointerdown', () => this.activate(element));
    element.addEventListener('focusin', () => this.activate(element));
    element.addEventListener('keydown', (event) => {
      if(event.key === 'Escape') {
        event.preventDefault();
        this.close(state.peerId);
      }
    });
    header.addEventListener('dblclick', (event) => {
      if((event.target as HTMLElement).closest('button')) return;
      this.toggleMaximize(element);
    });
    this.enableDrag(header, element);
    this.enableResize(element);
    if(state.minimized) element.classList.add('is-minimized');
    this.host.append(element);
    const entry = {state, element, chat, title, badge, newMessages: 0, opener, avatar, avatarMiddleware};
    this.entries.set(state.peerId, entry);
    this.place(entry);
    chat.setPeer({peerId: state.peerId});
    void getPeerTitle({peerId: state.peerId, plainText: true, managers}).then((name) => {
      if(this.entries.get(state.peerId) === entry) title.textContent = name;
    });
    if(!state.minimized) this.activate(element);
    this.save();
    return entry;
  }

  private button(key: LangPackKey, text: string, action: () => void) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'mini-chat-control';
    button.textContent = text;
    button.setAttribute('aria-label', i18n(key).textContent);
    button.addEventListener('click', action);
    return button;
  }

  private enableDrag(header: HTMLElement, element: HTMLElement) {
    let startX = 0, startY = 0, left = 0, top = 0;
    header.addEventListener('pointerdown', (event) => {
      if((event.target as HTMLElement).closest('button')) return;
      startX = event.clientX;
      startY = event.clientY;
      left = element.offsetLeft;
      top = element.offsetTop;
      header.setPointerCapture(event.pointerId);
    });
    header.addEventListener('pointermove', (event) => {
      if(!header.hasPointerCapture(event.pointerId)) return;
      const entry = Array.from(this.entries.values()).find((item) => item.element === element);
      if(!entry) return;
      const position = clampMiniChatState({...entry.state, left: left + event.clientX - startX, top: top + event.clientY - startY}, window.innerWidth, window.innerHeight);
      entry.state.left = position.left;
      entry.state.top = position.top;
      element.style.left = `${position.left}px`;
      element.style.top = `${position.top}px`;
      this.updateState(element);
    });
    header.addEventListener('pointerup', (event) => {
      if(header.hasPointerCapture(event.pointerId)) header.releasePointerCapture(event.pointerId);
      this.updateState(element);
    });
  }

  private enableResize(element: HTMLElement) {
    const handle = document.createElement('button');
    handle.type = 'button';
    handle.className = 'mini-chat-resize';
    handle.setAttribute('aria-label', i18n('MiniChat.Resize').textContent);
    handle.tabIndex = 0;
    element.append(handle);
    handle.addEventListener('keydown', (event) => {
      const step = event.shiftKey ? 40 : 16;
      if(event.key === 'ArrowRight') element.style.width = `${Math.min(window.innerWidth - element.offsetLeft - 16, element.offsetWidth + step)}px`;
      else if(event.key === 'ArrowLeft') element.style.width = `${Math.max(MINI_CHAT_MIN_WIDTH, element.offsetWidth - step)}px`;
      else if(event.key === 'ArrowDown') element.style.height = `${Math.min(window.innerHeight - element.offsetTop - 16, element.offsetHeight + step)}px`;
      else if(event.key === 'ArrowUp') element.style.height = `${Math.max(MINI_CHAT_MIN_HEIGHT, element.offsetHeight - step)}px`;
      else return;
      event.preventDefault();
      this.updateState(element);
      this.save();
    });
    handle.addEventListener('pointerdown', (event) => {
      event.preventDefault();
      const width = element.offsetWidth, height = element.offsetHeight;
      const x = event.clientX, y = event.clientY;
      handle.setPointerCapture(event.pointerId);
      const move = (next: PointerEvent) => {
        const maxWidth = window.innerWidth - element.offsetLeft - 16;
        const maxHeight = window.innerHeight - element.offsetTop - 16;
        element.style.width = `${Math.min(maxWidth, Math.max(MINI_CHAT_MIN_WIDTH, width + next.clientX - x))}px`;
        element.style.height = `${Math.min(maxHeight, Math.max(MINI_CHAT_MIN_HEIGHT, height + next.clientY - y))}px`;
        this.updateState(element);
      };
      const up = () => {
        handle.removeEventListener('pointermove', move);
        handle.removeEventListener('pointerup', up);
        this.save();
      };
      handle.addEventListener('pointermove', move);
      handle.addEventListener('pointerup', up);
    });
  }

  private activate(element: HTMLElement) {
    const entry = Array.from(this.entries.values()).find((item) => item.element === element);
    if(entry?.element.classList.contains('is-active')) return;
    if(entry) {
      this.entries.delete(entry.state.peerId);
      this.entries.set(entry.state.peerId, entry);
    }
    element.style.zIndex = String(++this.zIndex);
    this.entries.forEach(({element: item}) => item.classList.toggle('is-active', item === element));
    if(entry) {
      entry.newMessages = 0;
      entry.badge.hidden = true;
    }
    this.save();
  }

  private minimize(peerId: PeerId) {
    const entry = this.entries.get(peerId);
    if(!entry) return;
    if(this.floating?.entry === entry) {
      const session = this.floating;
      this.returnFromWindow(session, false);
      session.window.close();
    }
    entry.state.minimized = !entry.state.minimized;
    entry.element.classList.toggle('is-minimized', entry.state.minimized);
    const control = entry.element.querySelector<HTMLButtonElement>('.mini-chat-controls button');
    control.textContent = entry.state.minimized ? '□' : '−';
    control.setAttribute('aria-label', i18n(entry.state.minimized ? 'MiniChat.Restore' : 'MiniChat.Minimize').textContent);
    control.setAttribute('aria-expanded', String(!entry.state.minimized));
    this.save();
  }

  private maximize(peerId: PeerId) {
    const entry = this.entries.get(peerId);
    if(!entry) return;
    appImManager.setPeer({peerId});
    this.close(peerId, false);
  }

  private async openInWindow(entry: MiniChatEntry) {
    if(this.floating?.entry === entry) {
      this.floating.window.focus();
      return;
    }

    if(this.floating) {
      const previous = this.floating;
      this.returnFromWindow(previous, false);
      previous.window.close();
    }

    if(entry.state.minimized) {
      entry.state.minimized = false;
      entry.element.classList.remove('is-minimized');
      const minimize = entry.element.querySelector<HTMLButtonElement>('.mini-chat-controls button');
      minimize.textContent = '−';
      minimize.setAttribute('aria-label', i18n('MiniChat.Minimize').textContent);
      minimize.setAttribute('aria-expanded', 'true');
    }

    let pipWindow: Window;
    const documentPip = window.documentPictureInPicture;
    if(DOCUMENT_PICTURE_IN_PICTURE_SUPPORTED && documentPip && !documentPip.window) {
      try {
        // requestWindow is called synchronously from the header button's click handler.
        pipWindow = await documentPip.requestWindow({width: 420, height: 680});
      } catch(err) {
        log.error('Could not open the mini chat in Picture-in-Picture', err);
        return;
      }
    } else {
      // This fallback gets a separate resizable window, but browsers do not guarantee that it stays on top.
      const fallbackWindow = window.open('', `tweb-mini-chat-${entry.state.peerId}`, 'popup,width=420,height=680,resizable=yes');
      if(!fallbackWindow) return;
      pipWindow = fallbackWindow;
    }

    const pipDocument = pipWindow.document;
    const disposeStyles = mirrorDocumentStyles(document, pipDocument);
    pipDocument.title = entry.title.textContent || i18n('MiniChat.Title').textContent;
    const reset = pipDocument.createElement('style');
    reset.textContent = 'html,body{box-sizing:border-box;margin:0;padding:0;width:100%;height:100%;overflow:hidden}*,*::before,*::after{box-sizing:border-box}';
    pipDocument.head.append(reset);

    this.updateState(entry.element);
    const placeholder = document.createComment('mini-chat-pip');
    const focusTarget = document.activeElement instanceof HTMLElement ? document.activeElement : undefined;
    entry.element.before(placeholder);
    entry.element.classList.add('is-pip');
    pipDocument.body.append(entry.element);

    const delegatedEvents = (document as Document & {'_$DX_DELEGATE'?: Set<string>})['_$DX_DELEGATE'];
    if(delegatedEvents?.size) delegateEvents([...delegatedEvents], pipDocument);

    const onPageHide = () => {
      const session = this.floating;
      if(session?.window === pipWindow) {
        this.dismissedPipPeers.add(entry.state.peerId);
        this.returnFromWindow(session);
      }
    };
    this.floating = {window: pipWindow, entry, placeholder, disposeStyles, reset, onPageHide, focusTarget};
    pipWindow.addEventListener('pagehide', onPageHide);
    pipWindow.requestAnimationFrame(() => entry.chat.input.messageInputField.input.focus());
  }

  private returnFromWindow(session: MiniChatWindowSession, restoreFocus = true) {
    if(this.floating !== session) return;
    this.floating = undefined;
    session.window.removeEventListener('pagehide', session.onPageHide);
    clearDelegatedEvents(session.window.document);
    session.disposeStyles();
    session.reset.remove();
    session.entry.element.classList.remove('is-pip');
    if(session.placeholder.isConnected) session.placeholder.replaceWith(session.entry.element);
    else this.host.append(session.entry.element);
    this.place(session.entry);
    if(restoreFocus && session.focusTarget?.isConnected) session.focusTarget.focus();
    this.save();
  }

  private toggleMaximize(element: HTMLElement) {
    const entry = Array.from(this.entries.values()).find((item) => item.element === element);
    if(entry) this.maximize(entry.state.peerId);
  }

  private close(peerId: PeerId, restoreFocus = true) {
    const entry = this.entries.get(peerId);
    if(!entry) return;
    this.entries.delete(peerId);
    if(this.floating?.entry.state.peerId === peerId) {
      const session = this.floating;
      this.returnFromWindow(session, false);
      session.window.close();
    }
    entry.chat.destroy();
    entry.avatarMiddleware.destroy();
    entry.element.remove();
    this.save();
    if(restoreFocus && entry.opener?.isConnected) entry.opener.focus();
  }

  private onHistoryAppend = ({message}: {message: {peerId?: PeerId, pFlags?: {out?: boolean, unread?: boolean}}}) => {
    if(!message.peerId || message.pFlags?.out || !message.pFlags?.unread) return;
    const entry = this.entries.get(message.peerId);
    if(!entry || entry.element.classList.contains('is-active')) return;
    entry.newMessages++;
    this.setBadge(entry, entry.newMessages);
  };

  private onDialogUnread = ({peerId, dialog}: {peerId: PeerId, dialog?: {unread_count?: number}}) => {
    const entry = this.entries.get(peerId);
    if(!entry || entry.element.classList.contains('is-active')) return;
    const unread = dialog?.unread_count || entry.newMessages;
    this.setBadge(entry, unread);
  };

  private setBadge(entry: {badge: HTMLElement}, count: number) {
    entry.badge.textContent = count > 0 ? String(count) : '';
    entry.badge.hidden = count <= 0;
    if(count > 0) entry.badge.setAttribute('aria-label', i18n('MiniChat.NewMessages', [count]).textContent);
  }

  private onPeerDeleted = (peerId: PeerId) => this.close(peerId, false);

  private place(entry: {state: MiniChatState, element: HTMLElement}) {
    Object.assign(entry.state, clampMiniChatState(entry.state, window.innerWidth, window.innerHeight));
    const composer = document.querySelector<HTMLElement>('#column-center .chat.active .chat-input:not(.hide)');
    if(composer && !entry.state.minimized) {
      const rect = composer.getBoundingClientRect();
      const overlaps = entry.state.left < rect.right && entry.state.left + entry.state.width > rect.left &&
        entry.state.top < rect.bottom && entry.state.top + entry.state.height > rect.top;
      if(overlaps) {
        const aboveComposer = rect.top - entry.state.height - 16;
        entry.state.top = aboveComposer >= 16 ? aboveComposer : 16;
      }
    }
    entry.element.style.left = `${entry.state.left}px`;
    entry.element.style.top = `${entry.state.top}px`;
    entry.element.style.width = `${entry.state.width}px`;
    entry.element.style.height = `${entry.state.height}px`;
    entry.element.hidden = !isMiniChatViewportSupported(window.innerWidth);
  }

  private updateState(element: HTMLElement) {
    const entry = Array.from(this.entries.values()).find((item) => item.element === element);
    if(!entry) return;
    entry.state.left = element.offsetLeft;
    entry.state.top = element.offsetTop;
    entry.state.width = element.offsetWidth;
    entry.state.height = element.offsetHeight;
  }

  private onResize = () => {
    if(!this.restored && this.managers) this.restore(this.managers);
    this.entries.forEach((entry) => {
      if(this.floating?.entry !== entry) this.place(entry);
    });
    this.save();
  };

  private save() {
    const state = {version: 1 as const, chats: Array.from(this.entries.values(), ({state}) => state)};
    try {
      localStorage.setItem(MINI_CHAT_STORAGE_KEY, JSON.stringify(state));
    } catch(_err) {}
  }
}

let manager: MiniChatManager;

export function openMiniChat(peerId: PeerId | undefined, managers: AppManagers, opener?: HTMLElement) {
  if(typeof peerId !== 'number' || !Number.isSafeInteger(peerId) || peerId === 0) return;
  manager ||= new MiniChatManager();
  manager.open(peerId, managers, opener);
}

export function restoreMiniChats(managers: AppManagers) {
  manager ||= new MiniChatManager();
  manager.restoreOnStart(managers);
}
