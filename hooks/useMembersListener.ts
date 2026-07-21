import { useContext, useEffect, useRef, useState } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  collection,
  query,
  orderBy,
  limit,
  startAfter,
  getDocs,
  onSnapshot,
  Timestamp,
} from "firebase/firestore";
import { db } from "../firebase";
import { useNetworkStatus } from "./useNetworkStatus";
import { UserStorageKeys } from "./storageKeys";
import { GlobalContext } from "@/context";

/* ---------------- TYPES ---------------- */

export interface Member {
  id: string;
  createdAt: Timestamp;
  [key: string]: any;
}

interface UseMembersListenerReturn {
  members: Member[];
  counts: number;
  loading: boolean;
}

/* ---------------- CONSTANTS ---------------- */

const PAGE_SIZE = 15;

/* ---------------- HOOK ---------------- */

export const useMembersListener = (): UseMembersListenerReturn => {
  const { userId } = useContext(GlobalContext);

  const [members, setMembers] = useState<Member[]>([]);
  const [counts, setCounts] = useState(0);
  const [loading, setLoading] = useState(true);

  const lastCursorRef = useRef<Timestamp | null>(null);
  const fetchingRef = useRef(false);

  const isConnectedNET = useNetworkStatus();

  const MEMBERS_KEY = UserStorageKeys.CACHED_MEMBERS(userId);
  const LAST_CURSOR_KEY = UserStorageKeys.LAST_MEMBER_CURSOR(userId);

  /* -------- Load cache -------- */

  useEffect(() => {
    (async () => {
      try {
        const cachedMembers = await AsyncStorage.getItem(MEMBERS_KEY);
        const cachedCursor = await AsyncStorage.getItem(LAST_CURSOR_KEY);

        if (cachedMembers) {
          const parsed: Member[] = JSON.parse(cachedMembers);
          setMembers(parsed);
          setCounts(parsed.length);
        }

        if (cachedCursor) {
          lastCursorRef.current = Timestamp.fromMillis(Number(cachedCursor));
        }
      } catch (e) {
        console.log("❌ Error loading members cache:", e);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  /* -------- AUTO PAGINATION (15 by 15) -------- */

  useEffect(() => {
    if (!isConnectedNET) return; // ✅ Skip fetch when offline, rely on cache

    const fetchAllMembers = async () => {
      if (fetchingRef.current) return;
      fetchingRef.current = true;

      let hasMore = true;

      try {
        while (hasMore) {
          const colRef = collection(db, "members_list_db");

          const q = lastCursorRef.current
            ? query(
              colRef,
              orderBy("createdAt", "desc"),
              startAfter(lastCursorRef.current),
              limit(PAGE_SIZE)
            )
            : query(colRef, orderBy("createdAt", "desc"), limit(PAGE_SIZE));

          const snapshot = await getDocs(q);

          if (snapshot.empty) {
            hasMore = false;
            break;
          }

          const fetched: Member[] = snapshot.docs.map((doc) => ({
            id: doc.id,
            ...(doc.data() as any),
          }));

          // ✅ Guard against null/missing createdAt (can happen with offline cache)
          const validFetched = fetched.filter((m) => m.createdAt != null);

          if (validFetched.length === 0) {
            hasMore = false;
            break;
          }

          const lastVisible = validFetched[validFetched.length - 1];
          lastCursorRef.current = lastVisible.createdAt;

          setMembers((prev) => {
            const map = new Map<string, Member>();
            [...prev, ...validFetched].forEach((m) => map.set(m.id, m));
            const merged = Array.from(map.values());

            AsyncStorage.setItem(MEMBERS_KEY, JSON.stringify(merged));
            AsyncStorage.setItem(
              LAST_CURSOR_KEY,
              lastVisible.createdAt.toMillis().toString() // ✅ Now safe
            );

            return merged;
          });

          setCounts((c) => c + validFetched.length);

          if (validFetched.length < PAGE_SIZE) {
            hasMore = false;
          }
        }
      } catch (e) {
        console.log("❌ Error paginating members from Firestore:", e);
      } finally {
        fetchingRef.current = false;
      }
    };

    fetchAllMembers();
  }, [isConnectedNET]); // ✅ Re-runs when connection is restored

  /* -------- REAL-TIME LISTENER (NEW MEMBERS ONLY) -------- */

  useEffect(() => {
    if (!isConnectedNET) return; // ✅ Skip listener when offline

    let unsubscribe: (() => void) | undefined;

    try {
      const colRef = collection(db, "members_list_db");

      const q = query(colRef, orderBy("createdAt", "desc"), limit(1));

      unsubscribe = onSnapshot(q, (snapshot) => {
        snapshot.docChanges().forEach((change) => {
          if (change.type === "added") {
            const doc = change.doc;
            const data = doc.data();

            // ✅ Guard against null createdAt in real-time listener too
            if (!data?.createdAt) return;

            const member: Member = {
              id: doc.id,
              ...(data as any),
            };

            setMembers((prev) => {
              if (prev.some((m) => m.id === member.id)) return prev;
              const updated = [member, ...prev];

              AsyncStorage.setItem(MEMBERS_KEY, JSON.stringify(updated));
              return updated;
            });

            setCounts((c) => c + 1);
          }
        });
      });
    } catch (e) {
      console.log("❌ Error fetching members list from Firestore:", e);
    }

    return () => {
      if (unsubscribe) unsubscribe(); // ✅ Always clean up the listener
    };
  }, [isConnectedNET]);

  return { members, counts, loading };
};