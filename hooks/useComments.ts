// hooks/useComments.ts
// Fully synced with comments_flashList.tsx
// Adds: reactions, myReaction, edited, pinned, refresh(), error recovery,
//       local-first boot, stale-while-revalidate, listener dedup guard

import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import {
    collection,
    query,
    orderBy,
    limit,
    startAfter,
    getDocs,
    onSnapshot,
    QueryDocumentSnapshot,
    DocumentData,
    Unsubscribe,
} from "firebase/firestore";
import { db } from "@/firebase";
import { UserStorageKeys } from "./storageKeys";

// ─────────────────────────────────────────────
// SHARED TYPE  (import this in the screen too,
// delete the duplicate type declaration there)
// ─────────────────────────────────────────────
export type Reaction = "heart" | "like" | "haha" | "wow" | "sad";

export type CommentMessage = {
    id: string;
    text: string;
    user: string;
    email: string;
    contact?: string;
    userPhotoUrl?: string;
    image?: string | null;
    imageCaption?: string;
    status: "sending" | "sent" | "offline" | "read";
    timestamp: number;
    serverTime: number;
    likes: number;
    dislikes: number;
    hearts: number;
    // ── new fields ──────────────────────────────
    reactions: Partial<Record<Reaction, number>>;
    myReaction: Reaction | null;
    edited: boolean;
    pinned: boolean;
    // ── reply ───────────────────────────────────
    replyTo?: {
        id: string;
        user: string;
        text: string;
        image?: string | null;
    } | null;
    // ── legacy pressed flags (kept for BC) ──────
    likesPressed?: boolean;
    dislikesPressed?: boolean;
    heartsPressed?: boolean;
};

type UseCommentsParams = {
    userId: string;
};

type UseCommentsReturn = {
    messages: CommentMessage[];
    setMessages: React.Dispatch<React.SetStateAction<CommentMessage[]>>;
    loading: boolean;
    error: Error | null;
    hasMore: boolean;
    loadMore: () => Promise<void>;
    refresh: () => Promise<void>;          // ← new: pull-to-refresh
};

// ─────────────────────────────────────────────
// CONSTANTS
// ─────────────────────────────────────────────
const PAGE_SIZE = 30;
const LISTENER_WINDOW = 10;

// ─────────────────────────────────────────────
// HOOK
// ─────────────────────────────────────────────
export function useComments({ userId }: UseCommentsParams): UseCommentsReturn {
    const [messages, setMessages] = useState<CommentMessage[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<Error | null>(null);
    const [hasMore, setHasMore] = useState(true);

    const lastDocRef = useRef<QueryDocumentSnapshot<DocumentData> | null>(null);
    const newestServerTimeRef = useRef<number | null>(null);
    const realtimeUnsubRef = useRef<Unsubscribe | null>(null);
    const isMountedRef = useRef(true);

    const STORAGE_KEY = useMemo(
        () => UserStorageKeys.smartlearners_scores_db2(userId),
        [userId]
    );

    // ─────────────────────────────────────────
    // UTILITIES
    // ─────────────────────────────────────────

    /** Merge two arrays by id, newest-first. Prepend = new msgs go to top. */
    const mergeUnique = (
        prev: CommentMessage[],
        incoming: CommentMessage[],
        prepend = false
    ): CommentMessage[] => {
        const map = new Map<string, CommentMessage>();
        const combined = prepend ? [...incoming, ...prev] : [...prev, ...incoming];
        for (const msg of combined) map.set(msg.id, msg);
        return Array.from(map.values()).sort((a, b) => b.serverTime - a.serverTime);
    };

    /** Map a Firestore doc → CommentMessage with safe defaults. */
    const mapDoc = (d: QueryDocumentSnapshot<DocumentData>): CommentMessage => {
        const data: any = d.data();
        return {
            id: d.id,
            text: data.text ?? "",
            user: data.user ?? "Unknown",
            email: data.email ?? "",
            contact: data.contact,
            userPhotoUrl: data.userPhotoUrl ?? "",
            image: data.image ?? null,
            imageCaption: data.imageCaption ?? "",
            status: "sent",
            timestamp: data.timestamp ?? Date.now(),
            serverTime: data.serverTime?.toMillis?.() ?? Date.now(),
            likes: data.likes ?? 0,
            dislikes: data.dislikes ?? 0,
            hearts: data.hearts ?? 0,
            // ── new fields ──────────────────────────
            reactions: data.reactions ?? {},
            myReaction: null,           // always local — not stored in Firestore
            edited: data.edited ?? false,
            pinned: data.pinned ?? false,
            // ── reply ───────────────────────────────
            replyTo: data.replyTo
                ? {
                    id: data.replyTo.id,
                    user: data.replyTo.user,
                    text: data.replyTo.text ?? "",
                    image: data.replyTo.image ?? null,
                }
                : null,
        };
    };

    const saveLocal = async (msgs: CommentMessage[]) => {
        try {
            await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(msgs));
        } catch (err) {
            console.warn("useComments saveLocal:", err);
        }
    };

    const loadLocal = async (): Promise<CommentMessage[]> => {
        try {
            const raw = await AsyncStorage.getItem(STORAGE_KEY);
            return raw ? JSON.parse(raw) : [];
        } catch {
            return [];
        }
    };

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
            collection(db, "comments"),
            orderBy("serverTime", "desc"),
            limit(LISTENER_WINDOW)
        );

        realtimeUnsubRef.current = onSnapshot(
            q,
            (snapshot) => {
                if (!isMountedRef.current || snapshot.empty) return;

                const docs = snapshot.docs;
                const newestFromSnapshot = docs[0].data().serverTime?.toMillis?.() ?? 0;

                // Skip if no genuinely new data
                if (
                    newestServerTimeRef.current !== null &&
                    newestFromSnapshot <= newestServerTimeRef.current
                ) {
                    return;
                }

                const newMessages = docs.map(mapDoc).filter(
                    (m) =>
                        newestServerTimeRef.current === null ||
                        m.serverTime > newestServerTimeRef.current
                );

                if (!newMessages.length) return;

                newestServerTimeRef.current = newestFromSnapshot;

                setMessages((prev) => {
                    const merged = mergeUnique(prev, newMessages, true);
                    saveLocal(merged);
                    return merged;
                });
            },
            (err) => {
                console.warn("useComments listener error:", err);
                if (isMountedRef.current) setError(err);
            }
        );
    }, []);

    // ─────────────────────────────────────────
    // 1️⃣  INITIAL FETCH  (local-first boot)
    // ─────────────────────────────────────────

    const fetchInitial = useCallback(async () => {
        if (!isMountedRef.current) return;
        setLoading(true);
        setError(null);

        // ── Step 1: show cached data immediately ──
        const cached = await loadLocal();
        if (cached.length && isMountedRef.current) {
            setMessages(cached);
        }

        // ── Step 2: fetch from Firestore ──────────
        try {
            const q = query(
                collection(db, "comments"),
                orderBy("serverTime", "desc"),
                limit(PAGE_SIZE)
            );
            const snapshot = await getDocs(q);

            if (!isMountedRef.current) return;

            if (snapshot.empty) {
                setHasMore(false);
                setLoading(false);
                // Keep showing cached if any
                return;
            }

            const docs = snapshot.docs;
            lastDocRef.current = docs[docs.length - 1];
            newestServerTimeRef.current = docs[0].data().serverTime?.toMillis?.() ?? null;

            const fresh = docs.map(mapDoc);

            // Merge with cached so optimistic local messages aren't lost
            setMessages((prev) => {
                const localOnly = prev.filter((m) => m.status !== "sent");
                const merged = mergeUnique(fresh, localOnly, false);
                saveLocal(merged);
                return merged;
            });

            if (docs.length < PAGE_SIZE) setHasMore(false);

            startRealtimeListener();
        } catch (err: any) {
            if (isMountedRef.current) {
                setError(err);
                console.warn("useComments fetchInitial:", err);
                // Cached data already shown above — graceful degradation
            }
        } finally {
            if (isMountedRef.current) setLoading(false);
        }
    }, [startRealtimeListener]);

    // ─────────────────────────────────────────
    // 2️⃣  LOAD MORE  (pagination)
    // ─────────────────────────────────────────

    const loadMore = useCallback(async () => {
        if (!hasMore || !lastDocRef.current || loading) return;

        try {
            const q = query(
                collection(db, "comments"),
                orderBy("serverTime", "desc"),
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
            const more = docs.map(mapDoc);

            setMessages((prev) => {
                const merged = mergeUnique(prev, more, false);
                saveLocal(merged);
                return merged;
            });

            if (docs.length < PAGE_SIZE) setHasMore(false);
        } catch (err: any) {
            if (isMountedRef.current) {
                setError(err);
                console.warn("useComments loadMore:", err);
            }
        }
    }, [hasMore, loading]);

    // ─────────────────────────────────────────
    // 3️⃣  REFRESH  (pull-to-refresh)
    // ─────────────────────────────────────────

    const refresh = useCallback(async () => {
        stopListener();
        lastDocRef.current = null;
        newestServerTimeRef.current = null;
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
        };
    }, [fetchInitial]);

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
