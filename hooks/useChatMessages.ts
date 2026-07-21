// hooks/useChatMessages.ts
// Mirrors the useComments pattern exactly.
// Handles: local-first boot, paginated Firestore fetch, realtime listener,
//          optimistic local messages, mark-as-read batch, refresh, cleanup.
//
// Install deps (if not already):
//   npx expo install @react-native-async-storage/async-storage
//   npx expo install firebase

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import {
    collection,
    doc,
    getDocs,
    limit,
    onSnapshot,
    orderBy,
    query,
    startAfter,
    writeBatch,
    QueryDocumentSnapshot,
    DocumentData,
    Unsubscribe,
} from "firebase/firestore";
import { db } from "@/firebase";
import { UserStorageKeys } from "./storageKeys";

// ─────────────────────────────────────────────
// SHARED TYPES  (import these in ChatRoom.tsx — delete the duplicates there)
// ─────────────────────────────────────────────

export interface ReplyRef {
    txtMsgId: string;
    text: string;
    username: string;
}

export interface ChatMessage {
    txtMsgId: string;
    username: string;
    clientname: string;
    text: string;
    timestamp: any;
    status: "Sending" | "Sent" | "Delivered" | "Read" | "Failed" | "Pending" | "Agent";
    userIconUrl: string;
    clientIconUrl: string;
    useremail: string;
    clientemail: string;
    phone?: string;
    replyTo?: ReplyRef | null;
}

// ─────────────────────────────────────────────
// HOOK PARAMS / RETURN
// ─────────────────────────────────────────────

interface UseChatMessagesParams {
    userId: string;        // logged-in user's email
    userName: string;      // logged-in user's display name
    clientName: string;    // chat partner's display name
    clientEmail: string;   // chat partner's email (used for mark-as-read filter)
}

interface UseChatMessagesReturn {
    messages: ChatMessage[];
    setMessages: React.Dispatch<React.SetStateAction<ChatMessage[]>>;
    loading: boolean;
    error: Error | null;
    hasMore: boolean;
    loadMore: () => Promise<void>;
    refresh: () => Promise<void>;
}

// ─────────────────────────────────────────────
// CONSTANTS
// ─────────────────────────────────────────────

const PAGE_SIZE = 30;
const LISTENER_WINDOW = 10;
const MARK_READ_DEBOUNCE_MS = 1000;
const MARK_READ_BATCH_MAX = 500; // Firestore batch cap

// ─────────────────────────────────────────────
// HOOK
// ─────────────────────────────────────────────

export function useChatMessages({
    userId,
    userName,
    clientName,
    clientEmail,
}: UseChatMessagesParams): UseChatMessagesReturn {

    const [messages, setMessages] = useState<ChatMessage[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<Error | null>(null);
    const [hasMore, setHasMore] = useState(true);

    const lastDocRef = useRef<QueryDocumentSnapshot<DocumentData> | null>(null);
    const newestTimestampRef = useRef<number | null>(null);
    const realtimeUnsubRef = useRef<Unsubscribe | null>(null);
    const markReadTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const isMountedRef = useRef(true);

    // Stable storage key scoped to both participants so conversations don't bleed.
    const STORAGE_KEY = useMemo(
        () => UserStorageKeys.smartlearners_scores_db2(`chat_${userId}_${clientEmail}`),
        [userId, clientEmail]
    );

    // ─────────────────────────────────────────
    // UTILITIES
    // ─────────────────────────────────────────

    /** Map a Firestore doc → ChatMessage with safe defaults. */
    const mapDoc = (d: QueryDocumentSnapshot<DocumentData>): ChatMessage => {
        const data: any = d.data();
        const toMs = (ts: any): number => {
            if (!ts) return Date.now();
            if (typeof ts.toMillis === "function") return ts.toMillis();
            if (ts.seconds) return ts.seconds * 1000;
            if (typeof ts === "number") return ts;
            return Date.now();
        };
        return {
            txtMsgId: d.id,
            username: data.username ?? "Unknown",
            clientname: data.clientname ?? "",
            text: data.text ?? "",
            timestamp: toMs(data.timestamp),
            status: data.status ?? "Sent",
            userIconUrl: data.userIconUrl ?? "",
            clientIconUrl: data.clientIconUrl ?? "",
            useremail: data.useremail ?? "",
            clientemail: data.clientemail ?? "",
            phone: data.phone,
            replyTo: data.replyTo
                ? {
                    txtMsgId: data.replyTo.txtMsgId,
                    text: data.replyTo.text ?? "",
                    username: data.replyTo.username ?? "",
                }
                : null,
        };
    };

    /**
     * Merge two arrays by txtMsgId, newest-first.
     * `prepend` = incoming msgs go to the top (realtime new arrivals).
     */
    const mergeUnique = (
        prev: ChatMessage[],
        incoming: ChatMessage[],
        prepend = false
    ): ChatMessage[] => {
        const map = new Map<string, ChatMessage>();
        const combined = prepend ? [...incoming, ...prev] : [...prev, ...incoming];
        for (const msg of combined) map.set(msg.txtMsgId, msg);
        // Sort newest-first — matches FlashList inverted layout
        return Array.from(map.values()).sort((a, b) => {
            const ta = typeof a.timestamp === "number" ? a.timestamp : 0;
            const tb = typeof b.timestamp === "number" ? b.timestamp : 0;
            return tb - ta;
        });
    };

    /** Filter to only this conversation's messages. */
    const belongsToConversation = (m: ChatMessage): boolean =>
        (m.username === userName && m.clientname === clientName) ||
        (m.username === clientName && m.clientname === userName);

    const saveLocal = async (msgs: ChatMessage[]) => {
        try {
            await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(msgs));
        } catch (err) {
            console.warn("[useChatMessages] saveLocal:", err);
        }
    };

    const loadLocal = async (): Promise<ChatMessage[]> => {
        try {
            const raw = await AsyncStorage.getItem(STORAGE_KEY);
            return raw ? (JSON.parse(raw) as ChatMessage[]).filter(belongsToConversation) : [];
        } catch {
            return [];
        }
    };

    // ─────────────────────────────────────────
    // MARK-AS-READ  (batched + debounced)
    // ─────────────────────────────────────────

    const scheduleMarkRead = useCallback(
        (msgs: ChatMessage[]) => {
            if (markReadTimerRef.current) clearTimeout(markReadTimerRef.current);

            markReadTimerRef.current = setTimeout(async () => {
                const unread = msgs
                    .filter(
                        (m) =>
                            m.clientname === userName &&
                            m.username === clientName &&
                            m.status !== "Read" &&
                            m.txtMsgId
                    )
                    .slice(0, MARK_READ_BATCH_MAX);

                if (!unread.length) return;

                try {
                    const batch = writeBatch(db);
                    for (const msg of unread) {
                        batch.update(doc(db, "ChatDB", msg.txtMsgId), { status: "Read" });
                    }
                    await batch.commit();
                } catch (err) {
                    console.warn("[useChatMessages] mark-as-read batch failed:", err);
                }
            }, MARK_READ_DEBOUNCE_MS);
        },
        [clientName, userName]
    );

    // ─────────────────────────────────────────
    // REALTIME LISTENER
    // ─────────────────────────────────────────

    const stopListener = () => {
        realtimeUnsubRef.current?.();
        realtimeUnsubRef.current = null;
    };

    const startRealtimeListener = useCallback(() => {
        stopListener(); // prevent duplicate listeners

        const q = query(
            collection(db, "ChatDB"),
            orderBy("timestamp", "desc"),
            limit(LISTENER_WINDOW)
        );

        realtimeUnsubRef.current = onSnapshot(
            q,
            (snapshot) => {
                if (!isMountedRef.current || snapshot.empty) return;

                const docs = snapshot.docs;
                const newestMs =
                    typeof docs[0].data().timestamp?.toMillis === "function"
                        ? docs[0].data().timestamp.toMillis()
                        : (docs[0].data().timestamp ?? 0);

                // Skip if no genuinely new data
                if (
                    newestTimestampRef.current !== null &&
                    newestMs <= newestTimestampRef.current
                ) return;

                const newMessages = docs
                    .map(mapDoc)
                    .filter(
                        (m) =>
                            belongsToConversation(m) &&
                            (newestTimestampRef.current === null ||
                                (typeof m.timestamp === "number" &&
                                    m.timestamp > newestTimestampRef.current))
                    );

                if (!newMessages.length) return;

                newestTimestampRef.current = newestMs;

                setMessages((prev) => {
                    const merged = mergeUnique(prev, newMessages, true);
                    saveLocal(merged);
                    scheduleMarkRead(merged);
                    return merged;
                });
            },
            (err) => {
                console.warn("[useChatMessages] listener error:", err);
                if (isMountedRef.current) setError(err);
            }
        );
    }, [scheduleMarkRead]);

    // ─────────────────────────────────────────
    // 1️⃣  INITIAL FETCH  (local-first boot)
    // ─────────────────────────────────────────

    const fetchInitial = useCallback(async () => {
        if (!isMountedRef.current) return;
        setLoading(true);
        setError(null);

        // ── Step 1: show cached data immediately ──────────────────────────────
        const cached = await loadLocal();
        if (cached.length && isMountedRef.current) {
            setMessages(cached);
        }

        // ── Step 2: fetch fresh page from Firestore ───────────────────────────
        try {
            const q = query(
                collection(db, "ChatDB"),
                orderBy("timestamp", "desc"),
                limit(PAGE_SIZE)
            );
            const snapshot = await getDocs(q);

            if (!isMountedRef.current) return;

            if (snapshot.empty) {
                setHasMore(false);
                setLoading(false);
                return; // cached data (if any) already shown
            }

            const docs = snapshot.docs;
            lastDocRef.current = docs[docs.length - 1];

            const rawMs = docs[0].data().timestamp;
            newestTimestampRef.current =
                typeof rawMs?.toMillis === "function"
                    ? rawMs.toMillis()
                    : (rawMs ?? null);

            const fresh = docs.map(mapDoc).filter(belongsToConversation);

            setMessages((prev) => {
                // Keep optimistic local-only messages (sending/offline) alive
                const localOnly = prev.filter(
                    (m) => m.status === "Sending" || m.status === "Failed"
                );
                const merged = mergeUnique(fresh, localOnly, false);
                saveLocal(merged);
                scheduleMarkRead(merged);
                return merged;
            });

            if (docs.length < PAGE_SIZE) setHasMore(false);

            startRealtimeListener();
        } catch (err: any) {
            if (isMountedRef.current) {
                setError(err);
                console.warn("[useChatMessages] fetchInitial:", err);
                // Cached data already shown — graceful degradation
            }
        } finally {
            if (isMountedRef.current) setLoading(false);
        }
    }, [scheduleMarkRead, startRealtimeListener]);

    // ─────────────────────────────────────────
    // 2️⃣  LOAD MORE  (pagination)
    // ─────────────────────────────────────────

    const loadMore = useCallback(async () => {
        if (!hasMore || !lastDocRef.current || loading) return;

        try {
            const q = query(
                collection(db, "ChatDB"),
                orderBy("timestamp", "desc"),
                startAfter(lastDocRef.current),
                limit(PAGE_SIZE)
            );
            const snapshot = await getDocs(q);

            if (!isMountedRef.current || snapshot.empty) {
                setHasMore(false);
                return;
            }

            const docs = snapshot.docs;
            lastDocRef.current = docs[docs.length - 1];

            const more = docs.map(mapDoc).filter(belongsToConversation);

            setMessages((prev) => {
                const merged = mergeUnique(prev, more, false);
                saveLocal(merged);
                return merged;
            });

            if (docs.length < PAGE_SIZE) setHasMore(false);
        } catch (err: any) {
            if (isMountedRef.current) {
                setError(err);
                console.warn("[useChatMessages] loadMore:", err);
            }
        }
    }, [hasMore, loading]);

    // ─────────────────────────────────────────
    // 3️⃣  REFRESH  (pull-to-refresh)
    // ─────────────────────────────────────────

    const refresh = useCallback(async () => {
        stopListener();
        lastDocRef.current = null;
        newestTimestampRef.current = null;
        setHasMore(true);
        await fetchInitial();
    }, [fetchInitial]);

    // ─────────────────────────────────────────
    // LIFECYCLE
    // ─────────────────────────────────────────

    useEffect(() => {
        isMountedRef.current = true;
        fetchInitial();

        return () => {
            isMountedRef.current = false;
            stopListener();
            if (markReadTimerRef.current) clearTimeout(markReadTimerRef.current);
        };
    }, [fetchInitial]);

    // Re-run mark-as-read whenever message list changes from outside the hook
    useEffect(() => {
        if (messages.length) scheduleMarkRead(messages);
    }, [messages, scheduleMarkRead]);

    return {
        messages,
        setMessages,
        loading,
        error,
        hasMore,
        loadMore,
        refresh,
    };
}
