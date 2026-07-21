/**
 * useMessagesPagination.ts
 *
 * Efficient Firestore cursor-based pagination for the "messages" collection.
 *
 * Strategy:
 *  • Fetches 10 docs per page with orderBy("createdAt") + startAfter(cursor)
 *  • Stores fetched messages in memory to avoid re-reads within a session
 *  • Persists the last-document cursor to AsyncStorage so pagination resumes
 *    exactly where the user left off across app restarts
 *  • On mount: loads cached messages + restores cursor → first fetch continues
 *    from the cursor (or from the beginning for first-time users)
 *  • Guards against duplicate fetches, missing/deleted cursor docs, and empty
 *    result sets
 */

import { useCallback, useEffect, useRef, useState } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import {
    collection,
    doc,
    getDoc,
    getDocs,
    limit,
    orderBy,
    query,
    QueryDocumentSnapshot,
    startAfter,
    DocumentData,
} from "firebase/firestore";
import { db } from "@/firebase"; // adjust path to your Firebase instance

// ─── Constants ────────────────────────────────────────────────────────────────

const MESSAGES_COLLECTION = "messages";
const PAGE_SIZE = 10;

/** AsyncStorage keys scoped per user so cursors never bleed between accounts */
const storageKeys = (userId: string) => ({
    /** Serialised array of all fetched messages for this user */
    cachedMessages: `messages_cache_${userId}`,
    /** Serialised Firestore document data used as the startAfter cursor */
    lastDocData: `messages_cursor_data_${userId}`,
    /** The Firestore document ID of the last fetched doc (used to re-fetch the
     *  live snapshot so startAfter receives a real DocumentSnapshot) */
    lastDocId: `messages_cursor_id_${userId}`,
});

// ─── Types ────────────────────────────────────────────────────────────────────

export interface Message {
    id: string;
    text?: string;
    senderId?: string;
    receiverId?: string;
    createdAt: any;
    [key: string]: any; // allow extra fields from Firestore
}

export interface UseMessagesPaginationReturn {
    /** All messages accumulated so far, oldest first */
    messages: Message[];
    /** True while the very first page is loading */
    initialLoading: boolean;
    /** True while any subsequent page is loading */
    loadingMore: boolean;
    /** False once all pages have been fetched */
    hasMore: boolean;
    /** Call this to fetch the next page (no-op if already loading or exhausted) */
    fetchNextPage: () => Promise<void>;
    /** Wipe local cache + cursor and restart from page 1 */
    reset: () => Promise<void>;
    /** Any error surfaced during fetching */
    error: string | null;
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useMessagesPagination(userId: string): UseMessagesPaginationReturn {
    const keys = storageKeys(userId);

    // ── State ──────────────────────────────────────────────────────────────────
    const [messages, setMessages] = useState<Message[]>([]);
    const [initialLoading, setInitialLoading] = useState(true);
    const [loadingMore, setLoadingMore] = useState(false);
    const [hasMore, setHasMore] = useState(true);
    const [error, setError] = useState<string | null>(null);

    /**
     * Ref that holds the live Firestore DocumentSnapshot used as the cursor.
     * A ref (not state) keeps it stable across renders without triggering
     * re-renders, and avoids stale-closure issues inside fetchNextPage.
     */
    const cursorDocRef = useRef<QueryDocumentSnapshot<DocumentData> | null>(null);

    /** Prevents concurrent fetches being triggered (e.g. rapid scroll). */
    const isFetchingRef = useRef(false);

    /** Tracks whether we've finished the bootstrap (cache restore + first fetch). */
    const bootstrappedRef = useRef(false);

    // ── Bootstrap: restore cache + cursor on mount ─────────────────────────────
    useEffect(() => {
        if (!userId) return;

        const bootstrap = async () => {
            try {
                // 1. Restore cached messages so the UI is populated immediately
                const cachedRaw = await AsyncStorage.getItem(keys.cachedMessages);
                if (cachedRaw) {
                    const cached: Message[] = JSON.parse(cachedRaw);
                    if (cached.length > 0) {
                        setMessages(cached);
                    }
                }

                // 2. Restore the cursor by re-fetching the last document from
                //    Firestore so we get a live QueryDocumentSnapshot.
                //    We only need one read per app launch — much cheaper than
                //    re-fetching every page the user already scrolled through.
                const lastDocId = await AsyncStorage.getItem(keys.lastDocId);
                if (lastDocId) {
                    try {
                        const snap = await getDoc(
                            doc(db, MESSAGES_COLLECTION, lastDocId)
                        );
                        if (snap.exists()) {
                            // ✅ Cursor doc still exists — resume from here
                            cursorDocRef.current =
                                snap as QueryDocumentSnapshot<DocumentData>;
                        } else {
                            // ⚠️ Cursor doc was deleted — clear stale cursor;
                            //    next fetch will restart from the beginning.
                            await clearCursor(keys);
                            cursorDocRef.current = null;
                        }
                    } catch {
                        // Network error resolving cursor — fail gracefully;
                        // next fetch will restart from the beginning.
                        await clearCursor(keys);
                        cursorDocRef.current = null;
                    }
                }
            } catch (err) {
                console.error("useMessagesPagination bootstrap error:", err);
            } finally {
                bootstrappedRef.current = true;
                setInitialLoading(false);
            }
        };

        bootstrap();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [userId]);

    // ── Core fetch function ────────────────────────────────────────────────────
    /**
     * Fetches the next PAGE_SIZE messages from Firestore, appends them to
     * the local list, persists the updated cache + new cursor to AsyncStorage.
     */
    const fetchNextPage = useCallback(async () => {
        // Guard rails
        if (!userId) return;
        if (isFetchingRef.current) return;    // already in-flight
        if (!hasMore) return;                  // collection exhausted
        if (!bootstrappedRef.current) return;  // still restoring cache

        isFetchingRef.current = true;
        setError(null);

        // Show the right spinner: initialLoading for page 1, loadingMore after
        const isFirstPage = cursorDocRef.current === null && messages.length === 0;
        if (isFirstPage) {
            setInitialLoading(true);
        } else {
            setLoadingMore(true);
        }

        try {
            // Build the Firestore query
            let q = query(
                collection(db, MESSAGES_COLLECTION),
                orderBy("createdAt", "asc"),
                limit(PAGE_SIZE)
            );

            // If we have a cursor, continue from after it
            if (cursorDocRef.current) {
                q = query(
                    collection(db, MESSAGES_COLLECTION),
                    orderBy("createdAt", "asc"),
                    startAfter(cursorDocRef.current),
                    limit(PAGE_SIZE)
                );
            }

            const snapshot = await getDocs(q);

            // ── Empty result: collection is exhausted ──────────────────────
            if (snapshot.empty) {
                setHasMore(false);
                return;
            }

            // ── Map docs → Message objects ─────────────────────────────────
            const newMessages: Message[] = snapshot.docs.map((d) => ({
                id: d.id,
                ...d.data(),
                createdAt: d.data().createdAt || null, // Ensure createdAt is included
            }));

            // ── Update cursor to the last doc in this batch ────────────────
            const lastDoc = snapshot.docs[snapshot.docs.length - 1];
            cursorDocRef.current = lastDoc;

            // ── Merge into existing list (dedup by id just in case) ────────
            setMessages((prev) => {
                const existingIds = new Set(prev.map((m) => m.id));
                const unique = newMessages.filter((m) => !existingIds.has(m.id));
                return [...prev, ...unique];
            });

            // ── If we got fewer docs than the page size, we're done ────────
            if (snapshot.docs.length < PAGE_SIZE) {
                setHasMore(false);
            }

            // ── Persist cache + cursor to AsyncStorage ─────────────────────
            // We do this after setMessages, but we need the full merged list.
            // Read the current messages via a functional updater ref pattern:
            setMessages((currentMessages) => {
                // Persist asynchronously — non-blocking
                persistToStorage(keys, currentMessages, lastDoc).catch((err) =>
                    console.warn("useMessagesPagination: AsyncStorage write failed:", err)
                );
                return currentMessages; // no change, just piggybacking the read
            });
        } catch (err: any) {
            console.error("useMessagesPagination fetchNextPage error:", err);
            setError("Failed to load messages. Please try again.");
        } finally {
            isFetchingRef.current = false;
            setInitialLoading(false);
            setLoadingMore(false);
        }
    }, [userId, hasMore, messages.length, keys]);

    // ── Reset: clear everything and restart ───────────────────────────────────
    const reset = useCallback(async () => {
        cursorDocRef.current = null;
        isFetchingRef.current = false;
        bootstrappedRef.current = false;
        setMessages([]);
        setHasMore(true);
        setError(null);
        setInitialLoading(true);

        try {
            await AsyncStorage.multiRemove([
                keys.cachedMessages,
                keys.lastDocData,
                keys.lastDocId,
            ]);
        } catch (err) {
            console.warn("useMessagesPagination reset: AsyncStorage clear failed:", err);
        }

        // Allow fetchNextPage to run again
        bootstrappedRef.current = true;
        setInitialLoading(false);
    }, [keys]);

    return {
        messages,
        initialLoading,
        loadingMore,
        hasMore,
        fetchNextPage,
        reset,
        error,
    };
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

/**
 * Persist the full accumulated message list and the new cursor to AsyncStorage.
 * Called after every successful page fetch.
 */
async function persistToStorage(
    keys: ReturnType<typeof storageKeys>,
    allMessages: Message[],
    lastDoc: QueryDocumentSnapshot<DocumentData>
): Promise<void> {
    await AsyncStorage.multiSet([
        [keys.cachedMessages, JSON.stringify(allMessages)],
        [keys.lastDocId, lastDoc.id],
        // Storing the raw data as a fallback reference (not used for startAfter,
        // but useful for debugging and potential offline reconstruction)
        [keys.lastDocData, JSON.stringify(lastDoc.data())],
    ]);
}

/**
 * Remove cursor-related keys from AsyncStorage without touching the message cache.
 * Used when the cursor document no longer exists in Firestore.
 */
async function clearCursor(keys: ReturnType<typeof storageKeys>): Promise<void> {
    await AsyncStorage.multiRemove([keys.lastDocId, keys.lastDocData]);
}
