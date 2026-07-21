// context/GlobalContext.tsx
import React, {
  createContext,
  useEffect,
  useState,
  useRef,
  useMemo,
  useCallback,
} from "react";
import { AppState, AppStateStatus, Platform } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Updates from "expo-updates";
import { db, rtdb } from "@/firebase";
import { ref, onValue } from "firebase/database";
import {
  doc,
  setDoc,
  getDoc,
  updateDoc,
  serverTimestamp,
  collection,
  orderBy,
  limit,
  onSnapshot,
  query,
  where,
  Timestamp,
} from "firebase/firestore";
import { useAuth } from "@/context/auth";
import { router } from "expo-router";
import { UserStorageKeys } from "@/hooks/storageKeys";
import { useNetworkStatus } from "@/hooks/useNetworkStatus";

// ==================== TYPES ====================

interface Wallet {
  email: string;
  free_reset_credit: number;
  pay_as_you_go_credits: number;
  pay_as_you_go: { date_subscribed: number | null };
  monthly_subscription_plan: {
    expires_at: number | null;
    is_active: boolean;
    is_suspended: boolean;
    last_purchased_at: number | null;
    started_at: number | null;
    suspension_started_at: number | null;
    total_purchases: number;
  };
  plan_id: string;
  transaction_type: string;
  previous_balance: number | null;
  current_balance: number | null;
  transaction_amount: number | null;
  currency: string;
  payment_method: string;
  createdAt: any;
}

type MemberProfile = {
  clientId: string;
  clientName: string;
  actualFullname: string;
  actualDayOfBirth: string;
  actualMonthOfBirth: string;
  actualYearOfBirth: string;
  actualGender: string;
  phone: string;
  email: string;
  current_reward: string;
  current_balance: number;
  current_withdrawal: number;
  badges: number;
  membership_status: string;
  current_transaction_status: string;
  iconUrl: any;
  ownerUid: string;
  createdAt: any;
  year: number;
  [key: string]: any;
};

type UserStatus = {
  email: string;
  lastSeen: number;
  state: "online" | "offline";
};

// ==================== CONSTANTS ====================

const APP_VERSION = { apkVersionCount: 3, apkVersion: "1.0.0" };
const CHAT_CACHE_KEY = "CHAT_MESSAGES_CACHE";

const APP_UPDATE_DOC_REF = doc(db, "APP_UPDATE_DB", "app_update_0");
const ANNOUNCEMENT_DOC_REF = doc(db, "AnnouncementDB", "announcement1");

const DEFAULT_APP_UPDATE_DATA = {
  app_update_count: 1,
  app_update_date: "",
  app_update_description:
    "The APK version will soon be available for download, featuring new and improved functionalities.",
  app_update_status: false,
  app_update_title: "Update not available",
  app_update_url: "https://evotingsystempro.expo.app",
  app_update_version: "APK V0.0.0",
} as const;

const DEFAULT_ANNOUNCEMENT_DATA = {
  announcementConclusion: "hello ends",
  announcementContent1: "SORRY FOR THE INCONVENIENCE.",
  announcementContent2: "",
  announcementContent3: "",
  announcementStatus: true,
  announcementTitle: "EXTENDED TO 6PM",
  apkUrl: "https://evotingsystempro.expo.app",
  apkVersion: "APK V0.0.0",
  closeAppThroughout: false,
  date: new Date("2025-11-30T15:12:59Z"),
  logoutAllUsers: false,
  openAppThroughout: true,
} as const;

// ==================== HELPERS ====================

const uuId = () => {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  return Array.from({ length: 5 }, () =>
    chars.charAt(Math.floor(Math.random() * chars.length))
  ).join("");
};

const getMillis = (ts: any): number =>
  ts?.toMillis?.() ??
  (ts?.seconds ? ts.seconds * 1000 : typeof ts === "number" ? ts : 0);

const insertInOrder = (arr: any[], data: any) => {
  const newTime = getMillis(data.timestamp);
  let insertIndex = arr.length;
  for (let i = arr.length - 1; i >= 0; i--) {
    if (getMillis(arr[i].timestamp) <= newTime) {
      insertIndex = i + 1;
      break;
    }
    if (i === 0) insertIndex = 0;
  }
  arr.splice(insertIndex, 0, data);
};

async function initDBIfNotExists(
  docRef: ReturnType<typeof doc>,
  defaultData: Record<string, unknown>,
  label: string
) {
  try {
    const snap = await getDoc(docRef);
    if (!snap.exists()) {
      await setDoc(docRef, defaultData);
      console.log(`${label} initialized with defaults.`);
    }
  } catch (error) {
    console.error(`Error initializing ${label}:`, error);
  }
}

// ==================== CONTEXT ====================

export const GlobalContext = createContext<any>(null);

function GlobalState({ children }: { children: React.ReactNode }) {

  // ==================== AUTH ====================
  const { signIn, signOut, user: oauthUser, isLoading: oauthLoading } = useAuth();

  const [traditionalAuth, setTraditionalAuth] = useState<any | null>(null);
  const [traditionalLoading, setTraditionalLoading] = useState(false);

  const user = oauthUser || traditionalAuth;
  const isLoading = oauthLoading || traditionalLoading;

  const userName = user?.name ?? null;
  const userEmail = user?.email?.trim().toLowerCase() ?? null;
  const userPassword = user?.password ?? null;
  const userPhotoUrl = user?.picture ?? null;

  const rawUserEmail = userEmail;
  const userId = userEmail;

  // ==================== LOAD TRADITIONAL AUTH ====================

  useEffect(() => {
    if (oauthUser) return;
    let cancelled = false;

    (async () => {
      try {
        setTraditionalLoading(true);
        const key = UserStorageKeys.savedUserCredentials();
        const stored =
          Platform.OS === "web"
            ? localStorage.getItem(key)
            : await AsyncStorage.getItem(key);
        if (stored && !cancelled) setTraditionalAuth(JSON.parse(stored));
      } catch (e) {
        console.error("Failed to load traditional auth:", e);
      } finally {
        if (!cancelled) setTraditionalLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [oauthUser]);

  // ==================== CORE STATE ====================

  const isConnectedNET = useNetworkStatus();
  const appState = useRef<AppStateStatus>(AppState.currentState);
  const STORAGE_KEY = UserStorageKeys.smartlearners_scoreboard_cache(userId);

  const [clientId, setClientId] = useState("");
  const [clientName, setClientName] = useState("");
  const [statusMap, setStatusMap] = useState<Record<string, any>>({});
  const [scoresCleared, setScoresCleared] = useState(false);
  const [refreshHandle, setRefreshHandle] = useState(Date.now());
  const [detectChangeInQuizResult, setDetectChangeInQuizResult] = useState(false);
  const [taskStartingTime, setTaskStartingTime] = useState<number | null>(null);

  const [attemptHistory, setAttemptHistory] = useState<any[]>([]);
  const [bestScore, setBestScore] = useState(0);
  const [reviewAnswers, setReviewAnswers] = useState<any[]>([]);

  const [currentScore, setCurrentScore] = useState<number>(0);
  const [estimatedTotalTOT, setEstimatedTotalTOT] = useState<number>(0);
  const [correctScoreTOT, setCorrectScoreTOT] = useState<number>(0);
  const [wrongCountTOT, setWrongCountTOT] = useState<number>(0);

  const [memberProfile, setMemberProfile] = useState<MemberProfile | null>(null);
  const [walletFieldsContext, setWalletFieldsContext] = useState<Wallet | null>(null);
  const [clientsOnlineStatus, setClientsOnlineStatus] = useState<Record<string, UserStatus>>({});

  // ==================== ANNOUNCEMENT STATE ====================
  const [announcementStatus, setAnnouncementStatus] = useState(false);
  const [announcementTitle, setAnnouncementTitle] = useState("");
  const [announcementContent1, setAnnouncementContent1] = useState("");
  const [apkVersion, setApkVersion] = useState("");
  const [apkUrl, setApkUrl] = useState("");
  const [openAppThroughout, setOpenAppThroughout] = useState(false);
  const [closeAppThroughout, setCloseAppThroughout] = useState(false);
  const [logoutAllUsers, setLogoutAllUsers] = useState(false);

  // ==================== APP UPDATE STATE ====================
  const [app_update_status, setApp_update_status] = useState(true);
  const [app_update_description, setApp_update_description] = useState("");
  const [app_update_count, setApp_update_count] = useState(0);
  const [app_update_version, setApp_update_version] = useState("");
  const [app_update_title, setApp_update_title] = useState("");
  const [app_update_url, setApp_update_url] = useState("");
  const [showUpdateButton, setShowUpdateButton] = useState(false);
  const [serverVersionLabel, setServerVersionLabel] = useState("");

  // ==================== CHAT STATE ====================
  const [chatMessages, setChatMessages] = useState<any[]>([]);
  const [isChatReady, setIsChatReady] = useState(false);
  const [hasPendingChatMessages, setHasPendingChatMessages] = useState(false);
  const numberOfPendingChatMessages = useRef(new Set<string>());
  const fetchedIds = useRef<Set<string>>(new Set());
  const isChatListeningRef = useRef(false);

  // ==================== LOGOUT ====================
  const logout = useCallback(async () => {
    try {
      await signOut?.();
      await AsyncStorage.clear();
      setTraditionalAuth(null);
      if (Platform.OS === "web") {
        localStorage.clear();
        sessionStorage.clear();
        window.location.replace("/");
        return;
      }
      await Updates.reloadAsync();
      router.replace("/");
    } catch (e) {
      console.error("Logout failed:", e);
    }
  }, [signOut]);

  useEffect(() => {
    if (logoutAllUsers) logout();
  }, [logoutAllUsers]);

  // ==================== ANNOUNCEMENTS ====================
  useEffect(() => {
    const q = query(
      collection(db, "AnnouncementDB"),
      orderBy("announcementStatus", "desc"),
      limit(1)
    );
    const unsub = onSnapshot(q, (snap) => {
      if (snap.empty) return;
      const d = snap.docs[0].data();
      setLogoutAllUsers(d.logoutAllUsers);
      setAnnouncementTitle(d.announcementTitle);
      setAnnouncementContent1(d.announcementContent1);
      setOpenAppThroughout(d.openAppThroughout);
      setCloseAppThroughout(d.closeAppThroughout);
      setAnnouncementStatus(d.announcementStatus);
      setApkVersion(d.apkVersion);
      setApkUrl(d.apkUrl);
    });
    return () => unsub();
  }, []);

  useEffect(() => {
    if (closeAppThroughout) {
      setAnnouncementStatus(true);
      return;
    }
    if (openAppThroughout) {
      setAnnouncementStatus(false);
      return;
    }
    const hour = new Date().getHours();
    setAnnouncementStatus(hour >= 18 && hour < 20 ? false : true);
  }, [closeAppThroughout, openAppThroughout]);

  // ==================== APP UPDATES ====================
  useEffect(() => {
    let unsub: (() => void) | undefined;

    const init = async () => {
      await Promise.all([
        initDBIfNotExists(APP_UPDATE_DOC_REF, DEFAULT_APP_UPDATE_DATA, "APP_UPDATE_DB"),
        initDBIfNotExists(ANNOUNCEMENT_DOC_REF, DEFAULT_ANNOUNCEMENT_DATA, "AnnouncementDB"),
      ]);

      const q = query(
        collection(db, "APP_UPDATE_DB"),
        orderBy("app_update_status", "desc"),
        limit(1)
      );

      unsub = onSnapshot(q, (snap) => {
        if (snap.empty) return;
        const d = snap.docs[0].data();
        setApp_update_count(d.app_update_count);
        setApp_update_version(d.app_update_version);
        setApp_update_title(d.app_update_title);
        setApp_update_url(d.app_update_url);
        setApp_update_description(d.app_update_description);
      });
    };

    init();
    return () => unsub?.();
  }, []);

  useEffect(() => {
    const isUpdateAvailable =
      Platform.OS === "web" || app_update_count > APP_VERSION.apkVersionCount;
    setApp_update_status(isUpdateAvailable);
  }, [app_update_count, isConnectedNET]);

  // ==================== PRESENCE ====================
  useEffect(() => {
    if (!rawUserEmail) return;
    const userDocRef = doc(db, "users", userId!);
    const setOnline = () => updateDoc(userDocRef, { status: "online" }).catch(() => { });
    const setOffline = () =>
      updateDoc(userDocRef, { status: "offline", lastSeen: serverTimestamp() }).catch(() => { });

    setOnline();

    const handleAppStateChange = (next: AppStateStatus) => {
      if (appState.current.match(/inactive|background/) && next === "active") setOnline();
      else if (next.match(/inactive|background/)) setOffline();
      appState.current = next;
    };

    const sub = AppState.addEventListener("change", handleAppStateChange);
    return () => {
      sub.remove();
      setOffline();
    };
  }, [rawUserEmail]);

  // ==================== REALTIME DB: ONLINE STATUS ====================
  useEffect(() => {
    const statusRef = ref(rtdb, "status/");
    const unsub = onValue(statusRef, (snapshot) => {
      const data = snapshot.val();
      if (!data) return;

      const updated: Record<string, UserStatus> = {};
      Object.values(data).forEach((value: any) => {
        if (!value?.email) return;
        updated[value.email] = {
          email: value.email,
          lastSeen: value.lastSeen,
          state: value.state,
        };
      });

      setClientsOnlineStatus((prev) => {
        const prevKeys = Object.keys(prev);
        const nextKeys = Object.keys(updated);

        const changed =
          prevKeys.length !== nextKeys.length ||
          nextKeys.some(
            (email) =>
              prev[email]?.state !== updated[email].state ||
              prev[email]?.lastSeen !== updated[email].lastSeen
          );

        return changed ? updated : prev;
      });
    });
    return () => unsub();
  }, []);

  // ==================== MEMBER PROFILE & WALLET ====================
  useEffect(() => {
    if (!userId) {
      setMemberProfile(null);
      setWalletFieldsContext(null);
      return;
    }

    let isMounted = true;

    const unsubMember = onSnapshot(
      doc(db, "members_list_db", userId),
      (snap) => {
        if (!isMounted) return;
        setMemberProfile(snap.exists() ? (snap.data() as MemberProfile) : null);
      },
      (err) => {
        console.error("Member profile listener error:", err);
        if (isMounted) setMemberProfile(null);
      }
    );

    const unsubWallet = onSnapshot(
      doc(db, "WALLET_DB", userId),
      (snap) => {
        if (!isMounted) return;
        setWalletFieldsContext(snap.exists() ? (snap.data() as Wallet) : null);
      },
      (err) => {
        console.error("Wallet listener error:", err);
        if (isMounted) setWalletFieldsContext(null);
      }
    );

    return () => {
      isMounted = false;
      unsubMember();
      unsubWallet();
    };
  }, [userId]);

  // ==================== CHAT ====================
  useEffect(() => {
    let unsub: (() => void) | undefined;

    const setupChatListener = async () => {
      if (isChatListeningRef.current) return;
      isChatListeningRef.current = true;

      try {
        // Load cache first
        const cached = await AsyncStorage.getItem(CHAT_CACHE_KEY);
        if (cached) {
          const parsed: any[] = JSON.parse(cached);
          parsed.sort((a, b) => getMillis(a.timestamp) - getMillis(b.timestamp));
          setChatMessages(parsed);
          parsed.forEach((m) => {
            fetchedIds.current.add(m.txtMsgId);
            if (m.username === userName && m.status !== "Read") {
              numberOfPendingChatMessages.current.add(m.txtMsgId);
            }
          });
          setHasPendingChatMessages(numberOfPendingChatMessages.current.size > 0);
        }

        setIsChatReady(true);

        // Set up Firestore listener from last known timestamp
        const storedTimestamp = await AsyncStorage.getItem("LAST_TIMESTAMP");
        let lastTimestamp = storedTimestamp ? Number(storedTimestamp) : 0;

        const q = query(
          collection(db, "ChatDB"),
          orderBy("timestamp", "asc"),
          where("timestamp", ">=", Timestamp.fromMillis(lastTimestamp))
        );

        unsub = onSnapshot(q, async (snapshot) => {
          if (!snapshot) return;

          const deliveryUpdates: Promise<any>[] = [];
          let newestTimestamp = lastTimestamp;
          let updatedMessages: any[] = [];

          setChatMessages((prev) => {
            updatedMessages = [...prev];

            snapshot.docChanges().forEach((change) => {
              if (change.type !== "added" && change.type !== "modified") return;
              const data = change.doc.data();
              if (!data?.txtMsgId) return;

              const { txtMsgId } = data;
              const newTime = getMillis(data.timestamp);

              // Track pending messages
              if (data.username === userName) {
                data.status !== "Read"
                  ? numberOfPendingChatMessages.current.add(txtMsgId)
                  : numberOfPendingChatMessages.current.delete(txtMsgId);
              }

              // Update or insert message
              const existingIndex = updatedMessages.findIndex((m) => m.txtMsgId === txtMsgId);
              if (existingIndex >= 0) {
                updatedMessages[existingIndex] = { ...updatedMessages[existingIndex], ...data };
              } else {
                insertInOrder(updatedMessages, data);
                fetchedIds.current.add(txtMsgId);
              }

              if (newTime > newestTimestamp) newestTimestamp = newTime;

              // Mark delivered
              if (data.clientname === userName && data.status === "Sent") {
                deliveryUpdates.push(
                  updateDoc(doc(db, "ChatDB", change.doc.id), { status: "Delivered" }).catch(
                    (err) => console.error("Failed to set Delivered:", err)
                  )
                );
              }
            });

            setIsChatReady(true);
            return updatedMessages;
          });

          setHasPendingChatMessages(numberOfPendingChatMessages.current.size > 0);

          if (updatedMessages.length) {
            AsyncStorage.setItem(CHAT_CACHE_KEY, JSON.stringify(updatedMessages)).catch((e) =>
              console.error("Cache save error:", e)
            );
          }

          if (newestTimestamp > lastTimestamp) {
            lastTimestamp = newestTimestamp;
            AsyncStorage.setItem("LAST_TIMESTAMP", String(newestTimestamp));
          }

          if (deliveryUpdates.length) Promise.all(deliveryUpdates);
        });
      } catch (err) {
        console.error("Chat listener error:", err);
        setIsChatReady(true);
      }
    };

    setupChatListener();
    return () => {
      unsub?.();
      isChatListeningRef.current = false;
    };
  }, [userName, clientName]);

  // ==================== QUIZ ====================
  const addAttempt = useCallback(
    (score: number, total: number, answers?: any[]) => {
      const entry = { score, total, timestamp: new Date().toISOString(), answers: answers ?? [] };
      setAttemptHistory((prev) => [entry, ...prev]);
      if (score > bestScore) setBestScore(score);
      if (answers) setReviewAnswers(answers);
    },
    [bestScore]
  );

  const clearHistory = useCallback(() => {
    setAttemptHistory([]);
    setBestScore(0);
    setReviewAnswers([]);
  }, []);

  // ==================== CHAT DERIVED STATE ====================
  const userUniqueChatMessages = useMemo(() => {
    const seen = new Set<string>();
    return [...chatMessages]
      .sort((a, b) => (b.timestamp?.seconds ?? 0) - (a.timestamp?.seconds ?? 0))
      .filter((msg) => {
        if (msg.username !== userName && msg.clientname !== userName) return false;
        const other = msg.username === userName ? msg.clientname : msg.username;
        if (seen.has(other)) return false;
        seen.add(other);
        return true;
      });
  }, [chatMessages, userName]);

  const filteredUserUniqueChatMessages = useMemo(
    () => userUniqueChatMessages.filter((m) => m.clientId !== userId),
    [userUniqueChatMessages, userId]
  );

  const clientLastMessage = filteredUserUniqueChatMessages[0]?.text ?? "";
  const clientNameSentLastMessage = filteredUserUniqueChatMessages[0]?.username ?? "";
  const clientUriSentLastMessage = filteredUserUniqueChatMessages[0]?.userIconUrl ?? "";
  const clientLastUnreadMsgId = filteredUserUniqueChatMessages[0]?.txtMsgId ?? "";
  const clientLastUnreadEmail = filteredUserUniqueChatMessages[0]?.useremail ?? "";

  const hasUnreadMessages = useMemo(
    () => chatMessages.some((msg) => msg.clientname === userName && msg.status === "Delivered"),
    [chatMessages, userName]
  );

  const unreadCount = useMemo(
    () =>
      chatMessages.reduce(
        (count, msg) =>
          msg.clientname === userName && msg.status === "Delivered" ? count + 1 : count,
        0
      ),
    [chatMessages, userName]
  );

  // ==================== CONTEXT PROVIDER ====================
  return (
    <GlobalContext.Provider
      value={{
        clientId, setClientId,
        clientName, setClientName,
        statusMap,

        currentUser: { id: rawUserEmail, name: userName },

        attemptHistory,
        bestScore,
        reviewAnswers,
        addAttempt,
        clearHistory,
        scoresCleared, setScoresCleared,

        memberProfile,
        walletFieldsContext,

        detectChangeInQuizResult, setDetectChangeInQuizResult,

        clientLastMessage,
        clientNameSentLastMessage,
        clientUriSentLastMessage,
        clientLastUnreadMsgId,
        clientLastUnreadEmail,

        isChatReady,

        taskStartingTime, setTaskStartingTime,

        userUniqueChatMessages,
        hasUnreadMessages,
        unreadCount,

        showUpdateButton, setShowUpdateButton,
        serverVersionLabel, setServerVersionLabel,

        announcementStatus, setAnnouncementStatus,
        announcementTitle, setAnnouncementTitle,
        announcementContent1, setAnnouncementContent1,
        apkVersion, setApkVersion,
        apkUrl, setApkUrl,

        app_update_status, setApp_update_status,
        app_update_description, setApp_update_description,
        app_update_count, setApp_update_count,
        app_update_version, setApp_update_version,
        app_update_title, setApp_update_title,
        app_update_url, setApp_update_url,

        hasPendingChatMessages,

        estimatedTotalTOT, setEstimatedTotalTOT,
        currentScore, setCurrentScore,
        correctScoreTOT, setCorrectScoreTOT,
        wrongCountTOT, setWrongCountTOT,

        chatMessages, setChatMessages,

        clientsOnlineStatus,

        userName,
        userPassword,
        rawUserEmail,
        userId,
        userPhotoUrl,
        signIn,
        isLoading,
        setTraditionalAuth,
      }}
    >
      {children}
    </GlobalContext.Provider>
  );
}

export default GlobalState;