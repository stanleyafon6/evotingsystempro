/**
 * useChatListListener.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Real-time Firebase listener hook extracted from ChatListScreen.
 *
 * Responsibilities:
 *  - Subscribes to Firestore ChatDB for conversations the current user
 *    participates in (array-contains query on `participants`).
 *  - Tracks the newest message doc per chatId and maintains per-chat unread
 *    counts (messages sent by the peer that haven't been Read yet).
 *  - Listens to RTDB `status/<sanitisedEmail>` for online presence.
 *  - Listens to RTDB `typing/<peerEmail>_to_<myEmail>` for typing state.
 *  - Persists pin / mute / archive preferences per chatId in AsyncStorage.
 *  - Returns a sorted, filtered list of ChatContact objects ready to render.
 *
 * Usage:
 *   const { contacts, loading, togglePin, toggleMute, archiveChat, archivedCount }
 *     = useChatListListener(myEmail);
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { collection, onSnapshot, orderBy, query, where } from 'firebase/firestore';
import { onValue, ref } from 'firebase/database';
import AsyncStorage from '@react-native-async-storage/async-storage';

import { db, rtdb } from '@/firebase';

// ─── Constants ────────────────────────────────────────────────────────────────

const PREFS_KEY = 'CHAT_LIST_PREFS_v1';

const AVATAR_PALETTE = [
  '#c44b00', '#0077a8', '#b34400', '#005f80',
  '#7a2200', '#0097b2', '#e05a00', '#00687a',
  '#8b2500', '#004f6b',
];

// ─── Types ────────────────────────────────────────────────────────────────────

export type MessageStatus =
  | 'Sending'
  | 'Sent'
  | 'Delivered'
  | 'Read'
  | 'Failed'
  | 'Agent';

export type MessageType = 'text' | 'image' | 'file' | 'deleted';

/** Raw Firestore ChatDB document — mirrors what ChatRoom.tsx writes. */
export interface RawChatDoc {
  txtMsgId: string;
  chatId: string;
  username: string;
  clientname: string;
  useremail: string;
  clientemail: string;
  userIconUrl: string;
  clientIconUrl: string;
  text: string;
  timestamp: any;
  status: MessageStatus;
  type?: MessageType;
  mediaUrl?: string;
  mediaName?: string;
  participants: string[];
}

/** Resolved conversation entry ready to render. */
export interface ChatContact {
  chatId: string;
  peerEmail: string;
  peerName: string;
  peerIconUrl: string;
  txtMsgId: string;
  avatarColor: string;
  isAI: boolean;
  lastMessage: string;
  lastMessageType: MessageType;
  lastMessageIsOutgoing: boolean;
  lastStatus: MessageStatus;
  timestamp: Date;
  unreadCount: number;
  isOnline: boolean;
  isTyping: boolean;
  pinned: boolean;
  muted: boolean;
  archived: boolean;
}

/** Per-chat user preferences stored in AsyncStorage. */
export interface ChatPrefs {
  [chatId: string]: {
    pinned?: boolean;
    muted?: boolean;
    archived?: boolean;
  };
}

// ─── Pure helpers ─────────────────────────────────────────────────────────────

/** Mirrors sanitizeEmail in ChatRoom.tsx. */
const sanitizeEmail = (email: string): string =>
  email.replace(/\./g, '_').replace(/@/g, '_at_');

/** Mirrors tsToMs in ChatRoom.tsx. */
const tsToMs = (ts: any): number => {
  if (!ts) return 0;
  if (typeof ts === 'number') return ts;
  if (typeof ts.toMillis === 'function') return ts.toMillis();
  if (typeof ts.seconds === 'number')
    return ts.seconds * 1000 + Math.floor((ts.nanoseconds ?? 0) / 1e6);
  return 0;
};

const tsToDate = (ts: any): Date => new Date(tsToMs(ts) || Date.now());

/** Deterministic avatar colour derived from the peer's email. */
function pickAvatarColor(email: string): string {
  let hash = 0;
  for (let i = 0; i < email.length; i++) {
    hash = (hash * 31 + email.charCodeAt(i)) >>> 0;
  }
  return AVATAR_PALETTE[hash % AVATAR_PALETTE.length];
}

/** Short preview text for the last message. */
function lastMsgPreview(doc: RawChatDoc): string {
  if (doc.type === 'deleted') return '🚫 This message was deleted';
  if (doc.type === 'image') return '📷 Photo';
  if (doc.type === 'file') return `📎 ${doc.mediaName ?? 'File'}`;
  return doc.text || '…';
}

// ─── AsyncStorage helpers ─────────────────────────────────────────────────────

async function loadPrefs(): Promise<ChatPrefs> {
  try {
    const raw = await AsyncStorage.getItem(PREFS_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

async function savePrefs(prefs: ChatPrefs): Promise<void> {
  try {
    await AsyncStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
  } catch {
    /* non-fatal */
  }
}

// ─── useChatListListener ──────────────────────────────────────────────────────

export interface UseChatListListenerReturn {
  contacts: ChatContact[];
  loading: boolean;
  togglePin: (chatId: string) => void;
  toggleMute: (chatId: string) => void;
  archiveChat: (chatId: string) => void;
  archivedCount: number;
}

export function useChatListListener(
  myEmail: string | null | undefined,
): UseChatListListenerReturn {
  const [contacts, setContacts] = useState<ChatContact[]>([]);
  const [prefs, setPrefs] = useState<ChatPrefs>({});
  const [loading, setLoading] = useState(true);
  const [onlineMap, setOnlineMap] = useState<Record<string, boolean>>({});
  const [typingMap, setTypingMap] = useState<Record<string, boolean>>({});

  // chatId → newest RawChatDoc seen so far
  const latestDocsRef = useRef<Map<string, RawChatDoc>>(new Map());
  // chatId → unread count
  const unreadMapRef = useRef<Map<string, number>>(new Map());

  // ── 1. Load saved prefs on mount ──────────────────────────────────────────
  useEffect(() => {
    loadPrefs().then(setPrefs);
  }, []);

  // ── 2. Rebuild contacts array ─────────────────────────────────────────────
  // Declared before the Firestore effect so it can be called inside it.
  const rebuildContacts = useCallback(() => {
    const result: ChatContact[] = [];

    latestDocsRef.current.forEach((doc, chatId) => {
      const isOutgoing = doc.useremail === myEmail;
      const peerEmail = isOutgoing ? doc.clientemail : doc.useremail;
      const peerName = isOutgoing ? doc.clientname : doc.username;
      const peerIconUrl = isOutgoing ? doc.clientIconUrl : doc.userIconUrl;

      const pref = prefs[chatId] ?? {};
      if (pref.archived) return; // skip archived chats

      result.push({
        chatId,
        peerEmail,
        txtMsgId: doc.txtMsgId,
        peerName: peerName || peerEmail,
        peerIconUrl: peerIconUrl || '',
        avatarColor: pickAvatarColor(peerEmail),
        isAI: peerName === 'Lydia Fauson',
        lastMessage: lastMsgPreview(doc),
        lastMessageType: (doc.type ?? 'text') as MessageType,
        lastMessageIsOutgoing: isOutgoing,
        lastStatus: doc.status,
        timestamp: tsToDate(doc.timestamp),
        unreadCount: unreadMapRef.current.get(chatId) ?? 0,
        isOnline: onlineMap[peerEmail] ?? false,
        isTyping: typingMap[peerEmail] ?? false,
        pinned: pref.pinned ?? false,
        muted: pref.muted ?? false,
        archived: false,
      });
    });

    // Sort: pinned first, then by timestamp descending
    result.sort((a, b) => {
      if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
      return b.timestamp.getTime() - a.timestamp.getTime();
    });

    setContacts(result);
  }, [myEmail, prefs, onlineMap, typingMap]);

  // Re-render contacts whenever prefs or presence maps change
  useEffect(() => {
    rebuildContacts();
  }, [rebuildContacts]);

  // ── 3. Firestore real-time listener ──────────────────────────────────────
  useEffect(() => {
    if (!myEmail) return;

    const q = query(
      collection(db, 'ChatDB'),
      where('participants', 'array-contains', myEmail),
      orderBy('timestamp', 'desc'),
    );

    const unsub = onSnapshot(
      q,
      (snap) => {
        // Process incremental changes
        snap.docChanges().forEach((change) => {
          const data = {
            ...change.doc.data(),
            txtMsgId: change.doc.id,
          } as RawChatDoc;
          const { chatId } = data;
          if (!chatId) return;

          if (change.type === 'removed') {
            // Only evict if it was the representative doc for this chatId 
            const cur = latestDocsRef.current.get(chatId);
            if (cur?.txtMsgId === data.txtMsgId) {
              latestDocsRef.current.delete(chatId);
            }
            return;
          }

          // Keep the chronologically newest doc per conversation
          const existing = latestDocsRef.current.get(chatId);
          const existingMs = tsToMs(existing?.timestamp);
          const incomingMs = tsToMs(data.timestamp);
          if (!existing || incomingMs >= existingMs) {
            latestDocsRef.current.set(chatId, data);
          }
        });

        // Recount unread from the full snapshot
        const freshUnread = new Map<string, number>();
        snap.docs.forEach((d) => {
          const data = d.data() as RawChatDoc;
          if (!data.chatId) return;
          if (data.useremail !== myEmail && data.status !== 'Read') {
            freshUnread.set(
              data.chatId,
              (freshUnread.get(data.chatId) ?? 0) + 1,
            );
          }
        });
        unreadMapRef.current = freshUnread;

        rebuildContacts();
        setLoading(false);
      },
      (err) => {
        console.error('[useChatListListener] onSnapshot error:', err);
        setLoading(false);
      },
    );

    return unsub;
    // rebuildContacts is stable across renders — safe to include
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [myEmail]);

  // ── 4. RTDB presence & typing listeners ──────────────────────────────────
  useEffect(() => {
    if (!myEmail || contacts.length === 0) return;

    const peerEmails = [...new Set(contacts.map((c) => c.peerEmail))];
    const offs: (() => void)[] = [];

    peerEmails.forEach((email) => {
      // Online status
      const statusRef = ref(rtdb, `status/${sanitizeEmail(email)}`);
      offs.push(
        onValue(statusRef, (snap) => {
          setOnlineMap((prev) => ({
            ...prev,
            [email]: snap.val()?.state === 'online',
          }));
        }),
      );

      // Typing: peer is typing TO me
      const typingRef = ref(
        rtdb,
        `typing/${sanitizeEmail(email)}_to_${sanitizeEmail(myEmail)}`,
      );
      offs.push(
        onValue(typingRef, (snap) => {
          setTypingMap((prev) => ({
            ...prev,
            [email]: snap.val()?.isTyping === true,
          }));
        }),
      );
    });

    return () => offs.forEach((off) => off());
    // Re-subscribe only when the set of peer emails changes in size
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contacts.length, myEmail]);

  // ── 5. Pref mutators ──────────────────────────────────────────────────────
  const updatePref = useCallback(
    (chatId: string, patch: Partial<ChatPrefs[string]>) => {
      setPrefs((prev) => {
        const next = { ...prev, [chatId]: { ...prev[chatId], ...patch } };
        savePrefs(next);
        return next;
      });
    },
    [],
  );

  const togglePin = useCallback(
    (chatId: string) =>
      updatePref(chatId, { pinned: !(prefs[chatId]?.pinned ?? false) }),
    [prefs, updatePref],
  );

  const toggleMute = useCallback(
    (chatId: string) =>
      updatePref(chatId, { muted: !(prefs[chatId]?.muted ?? false) }),
    [prefs, updatePref],
  );

  const archiveChat = useCallback(
    (chatId: string) => updatePref(chatId, { archived: true }),
    [updatePref],
  );

  const archivedCount = useMemo(
    () => Object.values(prefs).filter((p) => p.archived).length,
    [prefs],
  );

  return { contacts, loading, togglePin, toggleMute, archiveChat, archivedCount };
}
