/**
 * wallet_transaction_screen.tsx
 */

import React, {
  useCallback, useContext, useEffect, useMemo, useRef, useState,
} from "react";
import {
  ActivityIndicator, Clipboard, Platform,
  RefreshControl, ScrollView, StyleSheet,
  Text, TextInput, TouchableHighlight, TouchableOpacity, View,
} from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Ionicons, MaterialIcons } from "@expo/vector-icons";
import { router, useFocusEffect } from "expo-router";
import {
  collection, doc, getDocs, getDoc, limit, orderBy, query,
  startAfter, where,
  QueryDocumentSnapshot,
} from "firebase/firestore";
import { db } from "@/firebase";
import { GlobalContext } from "@/context";
import ReusableScreen from "@/components/ReusableScreen";

/* ─── Constants ──────────────────────────────────────────────────────────── */
const WALLET_TX_DB = "TRANSACTION_WALLET_DB";
const PAGE_SIZE = 10;

const CACHE_KEY = "user_wallet_tx_v1_records";
const CURSOR_KEY = "user_wallet_tx_v1_cursor_id";

/* ─── Design tokens ──────────────────────────────────────────────────────── */
const T = {
  bg: "#F5F4F2",
  surface: "#FFFFFF",
  surfaceRaised: "#FAFAF9",
  border: "#EBEBEA",
  borderStrong: "#D5D4D2",
  ink: "#18181B",
  inkMid: "#52525B",
  inkMuted: "#A1A1AA",

  accent: "#EA580C",
  accentSoft: "#FFF7ED",
  accentMid: "#FDBA74",
  accentText: "#C2410C",

  amber: "#D97706",
  amberSoft: "#FFFBEB",
  amberMid: "#FCD34D",
  amberText: "#92400E",

  emerald: "#059669",
  emeraldSoft: "#ECFDF5",
  emeraldMid: "#6EE7B7",
  emeraldText: "#065F46",

  rose: "#E11D48",
  roseSoft: "#FFF1F2",
  roseMid: "#FDA4AF",
  roseText: "#9F1239",

  blue: "#2563EB",
  blueSoft: "#EFF6FF",
  blueMid: "#BFDBFE",
  blueText: "#1E3A8A",

  subscriptionColor: "#7C3AED",
  subscriptionBg: "#F5F3FF",
  subscriptionBorder: "#C4B5FD",

  monthlyColor: "#16A34A",
  monthlyBg: "#DCFCE7",
  monthlyBorder: "#86EFAC",

  paygColor: "#0891B2",
  paygBg: "#E0F2FE",
  paygBorder: "#7DD3FC",

  sp1: 4, sp2: 8, sp3: 12, sp4: 16, sp5: 20, sp6: 24,
  radiusSm: 8, radiusMd: 12, radiusLg: 16, radiusXl: 20, radiusFull: 999,
} as const;

/* ─── Types ──────────────────────────────────────────────────────────────── */
type TxStatus = "pending approval" | "completed" | "failed" | "cancelled";

type TxType =
  | "deposit"
  | "withdrawal"
  | "P2P_money_transfer"
  | "credit_purchase"
  | "subscription_purchase"
  | "credit_quiz_reward";

type SubscriptionSubType = "monthly" | null;

interface WalletTx {
  id: string;
  email?: string;
  name?: string;
  transaction_id?: string;
  external_transaction_id?: string;
  transaction_type: TxType;
  transaction_status: TxStatus | string;
  transaction_amount: number | null;
  current_balance: number | null;
  previous_balance: number | null;
  currency?: string;
  payment_method?: string;
  note?: string;
  createdAt: any;
  updatedAt?: any;
  counterpartyEmail?: string;
  counterpartyName?: string;
  adminNote?: string | null;   // ← ADD THIS
  reviewedAt?: any;            // ← ADD THIS (optional, useful for "reviewed on" display)
  subscription_snapshot?: {
    plan: "monthly";
    expires_at: number;
    stacked: boolean;
    total_purchases: number;
  };
  credit_snapshot?: {
    plan: "payg";
    credits_purchased: number;
    credits_total_after: number;
    price_per_credit: number;
  };
}

/* ─── Config maps ────────────────────────────────────────────────────────── */
const STATUS_CFG: Record<string, {
  label: string; color: string; soft: string; mid: string; text: string; icon: string;
}> = {
  "pending approval": {
    label: "Pending", color: T.amber, soft: T.amberSoft, mid: T.amberMid,
    text: T.amberText, icon: "time-outline",
  },
  completed: {
    label: "Completed", color: T.emerald, soft: T.emeraldSoft, mid: T.emeraldMid,
    text: T.emeraldText, icon: "checkmark-circle-outline",
  },
  failed: {
    label: "Failed", color: T.rose, soft: T.roseSoft, mid: T.roseMid,
    text: T.roseText, icon: "close-circle-outline",
  },
  cancelled: {
    label: "Cancelled", color: T.inkMid, soft: T.bg, mid: T.border,
    text: T.inkMid, icon: "remove-circle-outline",
  },
};

const TYPE_CFG: Record<TxType, {
  label: string; icon: string; amountSign: "+" | "-";
}> = {
  deposit: { label: "Deposit", icon: "arrow-down-circle-outline", amountSign: "+" },
  withdrawal: { label: "Withdrawal", icon: "arrow-up-circle-outline", amountSign: "-" },
  P2P_money_transfer: { label: "P2P Transfer", icon: "swap-horizontal-outline", amountSign: "-" },
  credit_purchase: { label: "Pay As You Go", icon: "flash-outline", amountSign: "-" },
  subscription_purchase: { label: "Subscription", icon: "ribbon-outline", amountSign: "-" },
  credit_quiz_reward: { label: "Quiz Reward", icon: "trophy-outline", amountSign: "+" },
};

const METHOD_LABEL: Record<string, string> = {
  momo: "Mobile Money", eth: "Ethereum", binance: "Binance Pay", stanbic: "Stanbic Bank",
  "system transfer": "System Transfer",
};

const ALL_STATUSES: TxStatus[] = ["pending approval", "completed", "failed", "cancelled"];

/* ─── Notification config ─────────────────────────────────────────────────── */
type NotifType = "success" | "error" | "info";

interface NotifState {
  message: string;
  type: NotifType;
}

const NOTIF_CFG: Record<NotifType, {
  bg: string; border: string; color: string; icon: string;
}> = {
  success: {
    bg: T.emeraldSoft, border: T.emeraldMid,
    color: T.emeraldText, icon: "checkmark-circle-outline",
  },
  error: {
    bg: T.roseSoft, border: T.roseMid,
    color: T.roseText, icon: "close-circle-outline",
  },
  info: {
    bg: T.blueSoft, border: T.blueMid,
    color: T.blueText, icon: "information-circle-outline",
  },
};

/* ─── Subscription helpers ────────────────────────────────────────────────── */
function resolveSubPlanFromNote(note?: string): SubscriptionSubType {
  if (!note) return null;
  return note.toLowerCase().includes("month") ? "monthly" : null;
}

function resolveSubscriptionSubType(tx: WalletTx): SubscriptionSubType {
  if (tx.transaction_type !== "subscription_purchase") return null;
  if (tx.subscription_snapshot?.plan) return tx.subscription_snapshot.plan;
  return resolveSubPlanFromNote(tx.note);
}

function subscriptionLabel(subType: SubscriptionSubType): string {
  return subType === "monthly" ? "Monthly Plan" : "Subscription";
}
function subscriptionColor(subType: SubscriptionSubType): string {
  return subType === "monthly" ? T.monthlyColor : T.subscriptionColor;
}

/* ─── Display helpers ─────────────────────────────────────────────────────── */
function txLabel(tx: WalletTx): string {
  switch (tx.transaction_type) {
    case "deposit": return "Deposit";
    case "withdrawal": return "Withdrawal";
    case "P2P_money_transfer": return "P2P Transfer";
    case "credit_purchase": return "Pay As You Go";
    case "credit_quiz_reward": return "Quiz Reward";
    case "subscription_purchase": return subscriptionLabel(resolveSubscriptionSubType(tx));
    default: return tx.transaction_type ?? "Transaction";
  }
}

function txIcon(tx: WalletTx): string {
  switch (tx.transaction_type) {
    case "deposit": return "arrow-down-circle-outline";
    case "withdrawal": return "arrow-up-circle-outline";
    case "P2P_money_transfer": return "swap-horizontal-outline";
    case "credit_purchase": return "flash-outline";
    case "credit_quiz_reward": return "trophy-outline";
    case "subscription_purchase": {
      const plan = tx.subscription_snapshot?.plan ?? resolveSubPlanFromNote(tx.note);
      return plan === "monthly" ? "calendar-outline" : "ribbon-outline";
    }
    default: return "receipt-outline";
  }
}

function txAmountColor(tx: WalletTx): string {
  switch (tx.transaction_type) {
    case "deposit": return T.emerald;
    case "credit_quiz_reward": return T.emerald;
    case "credit_purchase": return T.paygColor;
    case "subscription_purchase": return subscriptionColor(resolveSubscriptionSubType(tx));
    default: return T.rose;
  }
}

function txAmountPrefix(tx: WalletTx): "+" | "-" {
  return (tx.transaction_type === "deposit" || tx.transaction_type === "credit_quiz_reward")
    ? "+"
    : "-";
}

function resolveDisplayAmount(tx: WalletTx): number {
  return tx.transaction_amount ?? tx.current_balance ?? 0;
}

/* ─── Pure helpers ───────────────────────────────────────────────────────── */
const fmtDate = (ts: any): string => {
  if (!ts) return "—";
  const d = ts?.toDate ? ts.toDate() : new Date(ts);
  return d.toLocaleDateString("en-GB", {
    day: "numeric", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
};

const fmtShort = (ts: any): string => {
  if (!ts) return "—";
  const d = ts?.toDate ? ts.toDate() : new Date(ts);
  return d.toLocaleDateString("en-GB", {
    day: "numeric", month: "short", hour: "2-digit", minute: "2-digit",
  });
};

const formatGHS = (v: number) =>
  `GHS ${v.toLocaleString("en-GH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

function tsToMs(ts: any): number {
  if (!ts) return 0;
  if (typeof ts.toDate === "function") return ts.toDate().getTime();
  if (ts instanceof Date) return ts.getTime();
  if (typeof ts === "number") return ts;
  const p = Date.parse(ts);
  return isNaN(p) ? 0 : p;
}

function mergeRecords(existing: WalletTx[], incoming: WalletTx[]): WalletTx[] {
  const map = new Map<string, WalletTx>();
  for (const r of existing) map.set(r.id, r);
  for (const r of incoming) map.set(r.id, r);
  return Array.from(map.values()).sort((a, b) => tsToMs(b.createdAt) - tsToMs(a.createdAt));
}

/* ─── AsyncStorage helpers ───────────────────────────────────────────────── */
async function readCache(cacheKey: string): Promise<WalletTx[]> {
  try {
    const raw = await AsyncStorage.getItem(cacheKey);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch { return []; }
}

async function writeCache(cacheKey: string, data: WalletTx[]): Promise<void> {
  try { await AsyncStorage.setItem(cacheKey, JSON.stringify(data)); } catch { /* best-effort */ }
}

async function readCursorDocId(cursorKey: string): Promise<string | null> {
  try { return await AsyncStorage.getItem(cursorKey); } catch { return null; }
}

async function saveCursorDocId(cursorKey: string, docId: string): Promise<void> {
  try { await AsyncStorage.setItem(cursorKey, docId); } catch { /* best-effort */ }
}

async function clearAllCache(cacheKey: string, cursorKey: string): Promise<void> {
  try { await AsyncStorage.multiRemove([cacheKey, cursorKey]); } catch { /* best-effort */ }
}

/* ─── Firestore fetch helpers ────────────────────────────────────────────── */
async function fetchPage(
  userId: string,
  cursorDoc: QueryDocumentSnapshot | null,
): Promise<{ records: WalletTx[]; lastDoc: QueryDocumentSnapshot | null }> {
  const constraints: Parameters<typeof query>[1][] = [
    where("email", "==", userId),
    orderBy("createdAt", "desc"),
    limit(PAGE_SIZE),
  ];
  if (cursorDoc) constraints.push(startAfter(cursorDoc));

  const snap = await getDocs(
    query(collection(db, WALLET_TX_DB), ...constraints)
  );

  const records: WalletTx[] = snap.docs.map((d) => ({
    id: d.id,
    ...(d.data() as Omit<WalletTx, "id">),
  }));

  const lastDoc = snap.docs.length > 0 ? snap.docs[snap.docs.length - 1] : null;
  return { records, lastDoc };
}

async function rehydrateCursor(docId: string): Promise<QueryDocumentSnapshot | null> {
  try {
    const snap = await getDoc(doc(db, WALLET_TX_DB, docId));
    if (!snap.exists()) return null;
    return snap as unknown as QueryDocumentSnapshot;
  } catch { return null; }
}

/* ─── Sub-components ─────────────────────────────────────────────────────── */
function StatusBadge({ status }: { status: string }) {
  const cfg = STATUS_CFG[status] ?? STATUS_CFG["pending approval"];
  return (
    <View style={[ss.badge, { backgroundColor: cfg.soft }]}>
      <View style={[ss.badgeDot, { backgroundColor: cfg.color }]} />
      <Text style={[ss.badgeText, { color: cfg.text }]}>{cfg.label}</Text>
    </View>
  );
}

function KpiCard({ label, value, icon, color }: {
  label: string; value: string; icon: string; color: string;
}) {
  return (
    <View style={ss.kpiCard}>
      <View style={[ss.kpiIconWrap, { backgroundColor: color + "18" }]}>
        <Ionicons name={icon as any} size={14} color={color} />
      </View>
      <Text style={[ss.kpiValue, { color }]}>{value}</Text>
      <Text style={ss.kpiLabel}>{label}</Text>
    </View>
  );
}

function FilterPill({ label, active, color, soft, text, onPress }: {
  label: string; active: boolean;
  color: string; soft: string; text: string; onPress: () => void;
}) {
  return (
    <TouchableOpacity
      style={[ss.pill, active && { backgroundColor: soft, borderColor: color + "55" }]}
      onPress={onPress}
      activeOpacity={0.7}
    >
      {active && <View style={[ss.pillDot, { backgroundColor: color }]} />}
      <Text style={[ss.pillText, active && { color: text, fontWeight: "600" }]}>{label}</Text>
    </TouchableOpacity>
  );
}

function DetailRow({ label, value, valueColor }: {
  label: string; value: string; valueColor?: string;
}) {
  return (
    <View style={ss.detailRow}>
      <Text style={ss.detailLabel}>{label}</Text>
      <Text style={[ss.detailValue, valueColor ? { color: valueColor } : undefined]} numberOfLines={10}>
        {value}
      </Text>
    </View>
  );
}

function CopyRow({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    Clipboard.setString(value);
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  };
  return (
    <View style={ss.detailRow}>
      <Text style={ss.detailLabel}>{label}</Text>
      <TouchableOpacity style={ss.copyTarget} onPress={copy} activeOpacity={0.65}>
        <Text style={ss.detailMono} numberOfLines={1} ellipsizeMode="middle">{value || "—"}</Text>
        <Ionicons
          name={copied ? "checkmark-circle" : "copy-outline"}
          size={14}
          color={copied ? T.emerald : T.inkMuted}
          style={{ marginLeft: 6 }}
        />
      </TouchableOpacity>
    </View>
  );
}

/* ─── Load More Footer ───────────────────────────────────────────────────── */
function LoadMoreFooter({
  loading, allLoaded, loadedCount, onPress,
}: {
  loading: boolean; allLoaded: boolean; loadedCount: number; onPress: () => void;
}) {
  if (allLoaded) {
    return (
      <View style={ss.allLoadedFooter}>
        <View style={ss.allLoadedLine} />
        <Text style={ss.allLoadedText}>All {loadedCount} records loaded</Text>
        <View style={ss.allLoadedLine} />
      </View>
    );
  }

  return (
    <View style={ss.loadMoreContainer}>
      <View style={ss.loadMoreDivider} />
      {loading ? (
        <View style={ss.loadMoreLoadingRow}>
          <ActivityIndicator size="small" color={T.accent} />
          <Text style={ss.loadMoreLoadingText}>Loading next {PAGE_SIZE} records…</Text>
        </View>
      ) : (
        <TouchableOpacity style={ss.loadMoreButton} onPress={onPress} activeOpacity={0.78}>
          <Ionicons name="chevron-down-circle-outline" size={16} color={T.accent} />
          <Text style={ss.loadMoreButtonText}>Load more</Text>
          <View style={ss.loadMoreBadge}>
            <Text style={ss.loadMoreBadgeText}>{loadedCount} loaded</Text>
          </View>
        </TouchableOpacity>
      )}
    </View>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   Main Screen
═══════════════════════════════════════════════════════════════════════════ */
export default function WalletTransactionScreen() {
  const { userName, userId } = useContext(GlobalContext);

  const userCacheKey = `${CACHE_KEY}_${userId ?? "anon"}`;
  const userCursorKey = `${CURSOR_KEY}_${userId ?? "anon"}`;

  useFocusEffect(
    useCallback(() => {
      if (!userName) { router.replace("/"); }
    }, [userName])
  );

  /* ── State ─────────────────────────────────────────────────────────────── */
  const [records, setRecords] = useState<WalletTx[]>([]);
  const [initializing, setInitializing] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [allLoaded, setAllLoaded] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [searchQuery, setSearchQuery] = useState("");
  const [filterStatus, setFilterStatus] = useState<TxStatus | "all">("all");
  const [filterType, setFilterType] = useState<TxType | "all">("all");
  const [sortNewest, setSortNewest] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  /* ── Inline notification (replaces floating Toast) ────────────────────── */
  const [notification, setNotification] = useState<NotifState | null>(null);
  const notifTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showNotification = useCallback((message: string, type: NotifType = "success") => {
    if (notifTimer.current) clearTimeout(notifTimer.current);
    setNotification({ message, type });
    notifTimer.current = setTimeout(() => setNotification(null), 3500);
  }, []);

  const dismissNotification = useCallback(() => {
    if (notifTimer.current) clearTimeout(notifTimer.current);
    setNotification(null);
  }, []);

  const cursorRef = useRef<QueryDocumentSnapshot | null>(null);

  /* ── Core fetch + merge ──────────────────────────────────────────────── */
  const doFetch = useCallback(
    async (cursor: QueryDocumentSnapshot | null, replace: boolean): Promise<void> => {
      if (!userId) return;
      setLoadError(null);
      try {
        const { records: incoming, lastDoc } = await fetchPage(userId, cursor);

        setRecords((prev) => {
          const merged = replace ? incoming : mergeRecords(prev, incoming);
          writeCache(userCacheKey, merged);
          return merged;
        });

        if (lastDoc) {
          cursorRef.current = lastDoc;
          saveCursorDocId(userCursorKey, lastDoc.id);
        }

        setAllLoaded(incoming.length < PAGE_SIZE);
      } catch (err) {
        console.error("[WalletTx] fetch error:", err);
        const msg = "Failed to load transactions. Pull down to retry.";
        setLoadError(msg);
        showNotification(msg, "error");
      }
    },
    [userId, userCacheKey, userCursorKey, showNotification],
  );

  /* ── Mount ───────────────────────────────────────────────────────────── */
  useEffect(() => {
    let cancelled = false;

    (async () => {
      setInitializing(true);
      setAllLoaded(false);
      cursorRef.current = null;

      const cached = await readCache(userCacheKey);
      if (!cancelled && cached.length > 0) {
        setRecords(cached);
        setInitializing(false);
      }

      await doFetch(null, false);

      const savedCursorId = await readCursorDocId(userCursorKey);
      if (savedCursorId && !cancelled) {
        const live = await rehydrateCursor(savedCursorId);
        if (live && !cancelled) {
          cursorRef.current = live;
        } else if (!cancelled) {
          await AsyncStorage.removeItem(userCursorKey);
        }
      }

      if (!cancelled) setInitializing(false);
    })();

    return () => { cancelled = true; };
  }, [userId]); // eslint-disable-line react-hooks/exhaustive-deps

  /* ── Load More ───────────────────────────────────────────────────────── */
  const handleLoadMore = useCallback(async () => {
    if (loadingMore || allLoaded) return;
    setLoadingMore(true);
    await doFetch(cursorRef.current, false);
    setLoadingMore(false);
  }, [loadingMore, allLoaded, doFetch]);

  /* ── Refresh ─────────────────────────────────────────────────────────── */
  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    setAllLoaded(false);
    cursorRef.current = null;
    setExpandedId(null);
    await clearAllCache(userCacheKey, userCursorKey);
    await doFetch(null, true);
    setRefreshing(false);
  }, [doFetch, userCacheKey, userCursorKey]);

  /* ── Derived / filtered data ─────────────────────────────────────────── */
  const uniqueTypes = useMemo(() =>
    ["all", ...Array.from(new Set(records.map((r) => r.transaction_type)))] as (TxType | "all")[],
    [records]
  );

  const filtered = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return records
      .filter((r) => {
        if (filterStatus !== "all" && r.transaction_status !== filterStatus) return false;
        if (filterType !== "all" && r.transaction_type !== filterType) return false;
        if (q) {
          return (
            (r.transaction_id ?? "").toLowerCase().includes(q) ||
            (r.external_transaction_id ?? "").toLowerCase().includes(q) ||
            (r.note ?? "").toLowerCase().includes(q) ||
            (r.counterpartyEmail ?? "").toLowerCase().includes(q) ||
            (r.counterpartyName ?? "").toLowerCase().includes(q)
          );
        }
        return true;
      })
      .sort((a, b) =>
        sortNewest
          ? tsToMs(b.createdAt) - tsToMs(a.createdAt)
          : tsToMs(a.createdAt) - tsToMs(b.createdAt)
      );
  }, [records, filterStatus, filterType, searchQuery, sortNewest]);

  /* ── KPIs ────────────────────────────────────────────────────────────── */
  const completedTxs = useMemo(() =>
    records.filter((r) => r.transaction_status === "completed"), [records]);
  const pendingCount = useMemo(() =>
    records.filter((r) => r.transaction_status === "pending approval").length, [records]);

  const totalDeposited = useMemo(() =>
    completedTxs
      .filter((r) => r.transaction_type === "deposit" || r.transaction_type === "credit_quiz_reward")
      .reduce((s, r) => s + resolveDisplayAmount(r), 0), [completedTxs]);
  const totalWithdrawn = useMemo(() =>
    completedTxs.filter((r) => r.transaction_type === "withdrawal")
      .reduce((s, r) => s + resolveDisplayAmount(r), 0), [completedTxs]);
  const totalSpent = useMemo(() =>
    completedTxs
      .filter((r) => ["credit_purchase", "subscription_purchase", "P2P_money_transfer"].includes(r.transaction_type))
      .reduce((s, r) => s + resolveDisplayAmount(r), 0), [completedTxs]);

  const hasFilters = filterStatus !== "all" || filterType !== "all" || !!searchQuery;
  const clearFilters = () => {
    setFilterStatus("all");
    setFilterType("all");
    setSearchQuery("");
  };

  /* ── Loading splash ──────────────────────────────────────────────────── */
  if (initializing && records.length === 0) {
    return (
      <View style={ss.splashContainer}>
        <View style={ss.splashCard}>
          <ActivityIndicator size="large" color={T.accent} />
          <Text style={ss.splashText}>Loading your transactions</Text>
          <Text style={ss.splashSub}>Fetching your wallet history…</Text>
        </View>
      </View>
    );
  }

  /* ═══════════════════════════════════════════════════════════════════════
     Render
  ═══════════════════════════════════════════════════════════════════════ */
  return (
    <ReusableScreen>
      <View style={ss.root}>

        {/* ══ Header ══ */}
        <View style={ss.header}>
          <TouchableOpacity
            onPress={() => router.back()}
            style={ss.backBtn}
            activeOpacity={0.7}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Ionicons name="arrow-back" size={18} color={T.ink} />
          </TouchableOpacity>
          <View style={{ flex: 1, marginLeft: T.sp3 }}>
            <Text style={ss.headerTitle}>Transaction History</Text>
            <Text style={ss.headerSub}>
              {records.length} transaction{records.length !== 1 ? "s" : ""}{" "}
              · {allLoaded ? "all loaded" : "scroll to load more"}
            </Text>
          </View>
          <TouchableOpacity
            onPress={handleRefresh}
            style={ss.iconBtn}
            disabled={refreshing}
            activeOpacity={0.7}
          >
            {refreshing
              ? <ActivityIndicator size="small" color={T.accent} />
              : <Ionicons name="refresh-outline" size={17} color={T.inkMid} />
            }
          </TouchableOpacity>
        </View>

        {/* ══ Inline notification banner ══ */}
        {notification && (() => {
          const ncfg = NOTIF_CFG[notification.type];
          return (
            <View style={[ss.notifBanner, { backgroundColor: ncfg.bg, borderBottomColor: ncfg.border }]}>
              <Ionicons name={ncfg.icon as any} size={16} color={ncfg.color} />
              <Text style={[ss.notifText, { color: ncfg.color }]} numberOfLines={2}>
                {notification.message}
              </Text>
              <TouchableOpacity
                onPress={dismissNotification}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                activeOpacity={0.7}
              >
                <Ionicons name="close-outline" size={16} color={ncfg.color} />
              </TouchableOpacity>
            </View>
          );
        })()}

        {/* ══ Error banner ══ */}
        {loadError && (
          <View style={ss.errorBanner}>
            <Ionicons name="warning-outline" size={14} color={T.rose} />
            <Text style={ss.errorBannerText}>{loadError}</Text>
            <TouchableOpacity onPress={handleRefresh} activeOpacity={0.7}>
              <Text style={ss.errorBannerRetry}>Retry</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* ══ KPI strip ══ */}
        <View style={ss.kpiStrip}>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={ss.kpiScroll}
          >
            <KpiCard label="Deposited" value={formatGHS(totalDeposited)} icon="arrow-down-circle-outline" color={T.emerald} />
            <KpiCard label="Withdrawn" value={formatGHS(totalWithdrawn)} icon="arrow-up-circle-outline" color={T.accent} />
            <KpiCard label="Spent" value={formatGHS(totalSpent)} icon="flash-outline" color={T.paygColor} />
            <KpiCard label="Pending" value={String(pendingCount)} icon="time-outline" color={T.amber} />
            <KpiCard label="Completed" value={String(completedTxs.length)} icon="checkmark-circle-outline" color={T.emerald} />
            <KpiCard label="Total" value={String(records.length)} icon="list-outline" color={T.inkMid} />
          </ScrollView>
        </View>

        {/* ══ Pending notice ══ */}
        {pendingCount > 0 && (
          <TouchableOpacity
            style={ss.alertBanner}
            onPress={() => setFilterStatus("pending approval")}
            activeOpacity={0.85}
          >
            <View style={ss.alertStripe} />
            <View style={[ss.alertIconWrap, { backgroundColor: T.amberSoft }]}>
              <Ionicons name="time-outline" size={16} color={T.amber} />
            </View>
            <Text style={ss.alertText}>
              <Text style={ss.alertCount}>{pendingCount}</Text>
              {" transaction"}{pendingCount !== 1 ? "s" : ""} pending review
            </Text>
            <View style={ss.alertCta}>
              <Text style={ss.alertCtaText}>View</Text>
              <Ionicons name="chevron-forward" size={12} color={T.amber} />
            </View>
          </TouchableOpacity>
        )}

        {/* ══ Search ══ */}
        <View style={ss.searchWrap}>
          <View style={ss.searchBox}>
            <Ionicons name="search-outline" size={16} color={T.inkMuted} style={{ marginRight: 8 }} />
            <TextInput
              style={[ss.searchInput, Platform.OS === "web" && ({ outlineStyle: "none" } as any)]}
              placeholder="Search by transaction ID, note, recipient…"
              placeholderTextColor={T.inkMuted}
              value={searchQuery}
              onChangeText={setSearchQuery}
              autoCapitalize="none"
              autoCorrect={false}
            />
            {searchQuery.length > 0 && (
              <TouchableOpacity
                onPress={() => setSearchQuery("")}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              >
                <Ionicons name="close-circle" size={16} color={T.inkMuted} />
              </TouchableOpacity>
            )}
          </View>
        </View>

        {/* ══ Filters ══ */}
        <View style={ss.filtersContainer}>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={ss.filterRow}
          >
            <FilterPill
              label="All" active={filterStatus === "all"}
              color={T.accent} soft={T.accentSoft} text={T.accentText}
              onPress={() => setFilterStatus("all")}
            />
            {ALL_STATUSES.map((sv) => {
              const c = STATUS_CFG[sv];
              return (
                <FilterPill
                  key={sv} label={c.label} active={filterStatus === sv}
                  color={c.color} soft={c.soft} text={c.text}
                  onPress={() => setFilterStatus(sv)}
                />
              );
            })}
          </ScrollView>

          <View style={{ flexDirection: "row", alignItems: "center" }}>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={[ss.filterRow, { paddingRight: 0 }]}
            >
              <FilterPill
                label="All types" active={filterType === "all"}
                color={T.accent} soft={T.accentSoft} text={T.accentText}
                onPress={() => setFilterType("all")}
              />
              {(Object.keys(TYPE_CFG) as TxType[])
                .filter((k) => uniqueTypes.includes(k))
                .map((tv) => (
                  <FilterPill
                    key={tv} label={TYPE_CFG[tv].label} active={filterType === tv}
                    color={T.accent} soft={T.accentSoft} text={T.accentText}
                    onPress={() => setFilterType(tv)}
                  />
                ))}
            </ScrollView>
            <TouchableOpacity
              style={ss.sortBtn}
              onPress={() => setSortNewest((v) => !v)}
              activeOpacity={0.7}
            >
              <Ionicons
                name={sortNewest ? "arrow-down-outline" : "arrow-up-outline"}
                size={12}
                color={T.accent}
              />
              <Text style={ss.sortBtnText}>{sortNewest ? "Newest" : "Oldest"}</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* ══ Results bar ══ */}
        <View style={ss.resultsBar}>
          <Text style={ss.resultsText}>
            Showing{" "}
            <Text style={ss.resultsCount}>{filtered.length}</Text>
            {" of "}
            <Text style={ss.resultsCount}>{records.length}</Text>
            {!allLoaded && <Text style={{ color: T.inkMuted }}> · more available</Text>}
          </Text>
          {hasFilters && (
            <TouchableOpacity onPress={clearFilters} activeOpacity={0.7}>
              <Text style={ss.clearFilters}>Clear filters</Text>
            </TouchableOpacity>
          )}
        </View>

        {/* ══ Transaction list ══ */}
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={ss.listContent}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={handleRefresh}
              colors={[T.accent]}
              tintColor={T.accent}
            />
          }
        >
          {filtered.length === 0 ? (
            <View style={ss.emptyState}>
              <View style={ss.emptyIcon}>
                <MaterialIcons name="receipt-long" size={30} color={T.inkMuted} />
              </View>
              <Text style={ss.emptyTitle}>
                {records.length > 0 ? "No matching transactions" : "No transactions yet"}
              </Text>
              <Text style={ss.emptyBody}>
                {records.length > 0
                  ? "Adjust your filters or search terms."
                  : "Your wallet transactions will appear here once you make them."}
              </Text>
              {hasFilters && (
                <TouchableOpacity
                  style={ss.emptyClearBtn}
                  onPress={clearFilters}
                  activeOpacity={0.8}
                >
                  <Text style={ss.emptyClearText}>Clear filters</Text>
                </TouchableOpacity>
              )}
            </View>
          ) : (
            filtered.map((tx) => {
              const expanded = expandedId === tx.id;
              const scfg = STATUS_CFG[tx.transaction_status] ?? STATUS_CFG["pending approval"];
              const subType = resolveSubscriptionSubType(tx);
              const isSubscription = tx.transaction_type === "subscription_purchase";
              const isPayg = tx.transaction_type === "credit_purchase";

              const label = txLabel(tx);
              const icon = txIcon(tx);
              const amountColor = txAmountColor(tx);
              const prefix = txAmountPrefix(tx);
              const displayAmt = resolveDisplayAmount(tx);

              const isQuizReward = tx.transaction_type === "credit_quiz_reward";
              const statusBarColor = isSubscription
                ? subscriptionColor(subType)
                : isPayg ? T.paygColor
                  : isQuizReward ? T.emerald
                    : scfg.color;

              return (
                <View
                  key={tx.id}
                  style={[ss.txCard, expanded && ss.txCardExpanded]}
                >
                  <TouchableHighlight
                    onPress={() => setExpandedId(expanded ? null : tx.id)}
                    underlayColor={T.bg}
                    activeOpacity={0.9}
                    style={ss.txMainRow}
                  >
                    <View style={ss.txMainInner}>
                      <View style={[ss.txStripe, { backgroundColor: statusBarColor }]} />
                      <View style={ss.txContent}>
                        <View style={ss.txTopRow}>
                          <Text style={ss.txLabel}>{label}</Text>
                          <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
                            <StatusBadge status={tx.transaction_status} />
                            <Ionicons
                              name={expanded ? "chevron-up" : "chevron-down"}
                              size={14}
                              color={T.inkMuted}
                            />
                          </View>
                        </View>

                        <View style={ss.txMidRow}>
                          <Text style={[ss.txAmount, { color: amountColor }]}>
                            {prefix}{formatGHS(displayAmt)}
                          </Text>
                          {isSubscription && tx.subscription_snapshot?.stacked && (
                            <>
                              <Text style={ss.txDot}>·</Text>
                              <Text style={[ss.txMeta, { color: amountColor }]}>Extended</Text>
                            </>
                          )}
                          {isPayg && tx.credit_snapshot?.credits_purchased != null && (
                            <>
                              <Text style={ss.txDot}>·</Text>
                              <Text style={[ss.txMeta, { color: T.paygColor }]}>
                                {tx.credit_snapshot.credits_purchased} credits
                              </Text>
                            </>
                          )}
                          {tx.payment_method && (
                            <Text style={ss.txMeta}>
                              · {METHOD_LABEL[tx.payment_method] ?? tx.payment_method}
                            </Text>
                          )}
                        </View>
                        <Text style={ss.txDate}>{fmtShort(tx.createdAt)}</Text>
                      </View>
                    </View>
                  </TouchableHighlight>

                  {expanded && (
                    <View style={ss.detailPanel}>
                      <View style={ss.detailSection}>
                        <Text style={ss.detailSectionTitle}>Details</Text>

                        <DetailRow
                          label="Amount"
                          value={tx.transaction_amount != null ? formatGHS(tx.transaction_amount) : "—"}
                          valueColor={amountColor}
                        />
                        <DetailRow
                          label="Previous balance"
                          value={tx.previous_balance != null ? formatGHS(tx.previous_balance) : "—"}
                        />
                        <DetailRow
                          label="Balance after"
                          value={tx.current_balance != null ? formatGHS(tx.current_balance) : "—"}
                          valueColor={T.ink}
                        />
                        <DetailRow label="Status" value={scfg.label} valueColor={scfg.color} />
                        <DetailRow label="Currency" value={tx.currency ?? "GHS"} />
                        {tx.payment_method && (
                          <DetailRow
                            label="Payment method"
                            value={METHOD_LABEL[tx.payment_method] ?? tx.payment_method}
                          />
                        )}
                        <DetailRow label="Date" value={fmtDate(tx.createdAt)} />
                        {tx.updatedAt && (
                          <DetailRow label="Last updated" value={fmtDate(tx.updatedAt)} />
                        )}
                        {tx.counterpartyEmail && (
                          <DetailRow
                            label="Recipient"
                            value={tx.counterpartyName
                              ? `${tx.counterpartyName} (${tx.counterpartyEmail})`
                              : tx.counterpartyEmail}
                          />
                        )}
                        {tx.note && <DetailRow label="Note" value={tx.note} />}

                        {isPayg && tx.credit_snapshot && (
                          <>
                            <DetailRow
                              label="Credits purchased"
                              value={String(tx.credit_snapshot.credits_purchased)}
                              valueColor={T.paygColor}
                            />
                            <DetailRow
                              label="Total credits after"
                              value={String(tx.credit_snapshot.credits_total_after)}
                            />
                            <DetailRow
                              label="Price per credit"
                              value={`GHS ${tx.credit_snapshot.price_per_credit.toFixed(2)}`}
                            />
                          </>
                        )}

                        {isSubscription && tx.subscription_snapshot && (
                          <>
                            <DetailRow
                              label="Plan"
                              value={subscriptionLabel(subType)}
                              valueColor={subscriptionColor(subType)}
                            />
                            <DetailRow
                              label="Expires"
                              value={fmtDate(tx.subscription_snapshot.expires_at)}
                            />
                            <DetailRow
                              label="Renewed"
                              value={tx.subscription_snapshot.stacked ? "Yes" : "No"}
                            />
                          </>
                        )}

                        <CopyRow label="Transaction ID" value={tx.transaction_id ?? tx.id} />
                        {tx.external_transaction_id && (
                          <CopyRow label="Reference ID" value={tx.external_transaction_id} />
                        )}
                      </View>

                      {/* ── Admin review note ── */}
                      {!!tx.adminNote && (
                        <View style={[
                          ss.adminNoteBox,
                          tx.transaction_status === "cancelled" && { backgroundColor: T.roseSoft, borderColor: T.roseMid },
                          tx.transaction_status === "failed" && { backgroundColor: T.roseSoft, borderColor: T.roseMid },
                          tx.transaction_status === "completed" && { backgroundColor: T.emeraldSoft, borderColor: T.emeraldMid },
                        ]}>
                          <View style={ss.adminNoteHeader}>
                            <Ionicons
                              name="information-circle-outline"
                              size={14}
                              color={
                                tx.transaction_status === "completed" ? T.emeraldText
                                  : (tx.transaction_status === "cancelled" || tx.transaction_status === "failed") ? T.roseText
                                    : T.blueText
                              }
                            />
                            <Text style={[
                              ss.adminNoteTitle,
                              tx.transaction_status === "completed" && { color: T.emeraldText },
                              (tx.transaction_status === "cancelled" || tx.transaction_status === "failed") && { color: T.roseText },
                            ]}>
                              Note from support
                            </Text>
                            {!!tx.reviewedAt && (
                              <Text style={[
                                ss.adminNoteDate,
                                tx.transaction_status === "completed" && { color: T.emeraldText },
                                (tx.transaction_status === "cancelled" || tx.transaction_status === "failed") && { color: T.roseText },
                              ]}>
                                {fmtShort(tx.reviewedAt)}
                              </Text>
                            )}
                          </View>
                          <Text style={[
                            ss.adminNoteText,
                            tx.transaction_status === "completed" && { color: T.emeraldText },
                            (tx.transaction_status === "cancelled" || tx.transaction_status === "failed") && { color: T.roseText },
                          ]}>
                            {tx.adminNote}
                          </Text>
                        </View>
                      )}
                    </View>
                  )}
                </View>
              );
            })
          )}

          {records.length > 0 && (
            <LoadMoreFooter
              loading={loadingMore}
              allLoaded={allLoaded}
              loadedCount={records.length}
              onPress={handleLoadMore}
            />
          )}

          <View style={{ height: 50 }} />
        </ScrollView>

      </View>
    </ReusableScreen>
  );
}

/* ─── Styles ─────────────────────────────────────────────────────────────── */
const ss = StyleSheet.create({
  root: { flex: 1, backgroundColor: T.bg },

  splashContainer: {
    flex: 1, backgroundColor: T.bg, justifyContent: "center", alignItems: "center",
  },
  splashCard: {
    backgroundColor: T.surface, borderRadius: T.radiusXl,
    paddingHorizontal: 40, paddingVertical: 36, alignItems: "center",
    borderWidth: 1, borderColor: T.border,
    ...Platform.select({
      ios: { shadowColor: "#000", shadowOpacity: 0.06, shadowRadius: 20, shadowOffset: { width: 0, height: 4 } },
      android: { elevation: 4 },
    }),
  },
  splashText: { marginTop: 16, fontSize: 15, fontWeight: "600", color: T.ink },
  splashSub: { marginTop: 4, fontSize: 13, color: T.inkMuted },

  /* ── Inline notification banner ── */
  notifBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: T.sp4,
    paddingVertical: 11,
    borderBottomWidth: 1,
  },
  notifText: {
    flex: 1,
    fontSize: 13,
    fontWeight: "600",
    lineHeight: 18,
  },

  errorBanner: {
    flexDirection: "row", alignItems: "center", gap: 8,
    paddingHorizontal: T.sp4, paddingVertical: 9,
    backgroundColor: "#FFF1F2", borderBottomWidth: 1, borderBottomColor: "#FDA4AF",
  },
  errorBannerText: { flex: 1, fontSize: 12.5, color: T.rose, fontWeight: "500" },
  errorBannerRetry: { fontSize: 12.5, fontWeight: "700", color: T.accent },

  header: {
    flexDirection: "row", alignItems: "center", backgroundColor: T.surface,
    paddingHorizontal: T.sp4, paddingVertical: T.sp3,
    borderBottomWidth: 1, borderBottomColor: T.border,
  },
  backBtn: {
    width: 36, height: 36, borderRadius: T.radiusMd,
    backgroundColor: T.bg, borderWidth: 1, borderColor: T.border,
    justifyContent: "center", alignItems: "center",
  },
  headerTitle: { fontSize: 17, fontWeight: "700", color: T.ink, letterSpacing: -0.3 },
  headerSub: { fontSize: 11, color: T.inkMuted, marginTop: 1 },
  iconBtn: {
    width: 36, height: 36, borderRadius: T.radiusMd,
    backgroundColor: T.bg, borderWidth: 1, borderColor: T.border,
    justifyContent: "center", alignItems: "center",
  },

  kpiStrip: { backgroundColor: T.surface, borderBottomWidth: 1, borderBottomColor: T.border },
  kpiScroll: { paddingHorizontal: T.sp4, paddingVertical: T.sp3, gap: T.sp2, flexDirection: "row" },
  kpiCard: {
    alignItems: "center", backgroundColor: T.surfaceRaised, borderRadius: T.radiusMd,
    paddingVertical: 10, paddingHorizontal: 14, minWidth: 84,
    borderWidth: 1, borderColor: T.border, gap: 3,
  },
  kpiIconWrap: {
    width: 26, height: 26, borderRadius: 7,
    justifyContent: "center", alignItems: "center", marginBottom: 2,
  },
  kpiValue: { fontSize: 14, fontWeight: "700", letterSpacing: -0.4 },
  kpiLabel: { fontSize: 10, fontWeight: "500", color: T.inkMuted, textAlign: "center" },

  alertBanner: {
    flexDirection: "row", alignItems: "center", backgroundColor: T.amberSoft,
    borderBottomWidth: 1, borderBottomColor: T.amberMid + "55",
    paddingVertical: 10, paddingRight: T.sp4, overflow: "hidden", position: "relative",
  },
  alertStripe: { width: 3, position: "absolute", left: 0, top: 0, bottom: 0, backgroundColor: T.amber },
  alertIconWrap: {
    marginLeft: T.sp4, marginRight: T.sp3, width: 28, height: 28,
    borderRadius: T.radiusSm, justifyContent: "center", alignItems: "center",
  },
  alertText: { flex: 1, fontSize: 13, color: T.amberText },
  alertCount: { fontWeight: "700", fontSize: 13, color: T.amberText },
  alertCta: {
    flexDirection: "row", alignItems: "center", backgroundColor: "#FDE68A55",
    paddingHorizontal: 10, paddingVertical: 5,
    borderRadius: T.radiusSm, borderWidth: 0.5, borderColor: T.amberMid, gap: 2,
  },
  alertCtaText: { fontSize: 12.5, fontWeight: "700", color: T.amber },

  searchWrap: {
    backgroundColor: T.surface, paddingHorizontal: T.sp4, paddingVertical: 10,
    borderBottomWidth: 1, borderBottomColor: T.border,
  },
  searchBox: {
    flexDirection: "row", alignItems: "center", backgroundColor: T.bg,
    borderRadius: T.radiusMd, paddingHorizontal: 12, paddingVertical: 9,
    borderWidth: 1, borderColor: T.border,
  },
  searchInput: { flex: 1, fontSize: 14, color: T.ink },

  filtersContainer: {
    backgroundColor: T.surface, borderBottomWidth: 1, borderBottomColor: T.border, paddingBottom: T.sp2,
  },
  filterRow: { paddingHorizontal: T.sp4, paddingTop: T.sp2, flexDirection: "row", gap: 6 },
  pill: {
    flexDirection: "row", alignItems: "center",
    paddingHorizontal: 12, paddingVertical: 6,
    borderRadius: T.radiusFull, borderWidth: 1, borderColor: T.border,
    backgroundColor: T.bg, minHeight: 32,
  },
  pillDot: { width: 5, height: 5, borderRadius: 3, marginRight: 5 },
  pillText: { fontSize: 12.5, fontWeight: "500", color: T.inkMid },
  sortBtn: {
    flexDirection: "row", alignItems: "center", gap: 3,
    marginRight: T.sp4, marginLeft: T.sp2,
    backgroundColor: T.accentSoft, paddingHorizontal: 10, paddingVertical: 5,
    borderRadius: T.radiusFull, borderWidth: 1, borderColor: T.accentMid + "66",
  },
  sortBtnText: { fontSize: 12, fontWeight: "600", color: T.accent },

  resultsBar: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: T.sp4, paddingVertical: 8,
    borderBottomWidth: 1, borderBottomColor: T.border, backgroundColor: T.bg,
  },
  resultsText: { fontSize: 12, color: T.inkMuted },
  resultsCount: { fontWeight: "700", color: T.ink },
  clearFilters: { fontSize: 12, color: T.accent, fontWeight: "600" },

  listContent: { paddingHorizontal: T.sp4, paddingTop: T.sp3, paddingBottom: 50, gap: 8 },

  txCard: {
    backgroundColor: T.surface, borderRadius: T.radiusLg,
    borderWidth: 1, borderColor: T.border, overflow: "hidden",
    ...Platform.select({
      ios: { shadowColor: "#000", shadowOpacity: 0.04, shadowRadius: 6, shadowOffset: { width: 0, height: 2 } },
      android: { elevation: 1 },
    }),
  },
  txCardExpanded: { borderColor: T.borderStrong },
  txMainRow: { borderRadius: T.radiusLg },
  txMainInner: { flexDirection: "row", alignItems: "stretch" },
  txStripe: { width: 3, alignSelf: "stretch", minHeight: 56 },
  txContent: {
    flex: 1, paddingVertical: T.sp3,
    paddingRight: T.sp3, paddingLeft: T.sp3,
  },
  txTopRow: {
    flexDirection: "row", alignItems: "center",
    justifyContent: "space-between", marginBottom: 5,
  },
  txLabel: { fontSize: 13.5, fontWeight: "600", color: T.ink, flex: 1, marginRight: 8 },
  txMidRow: { flexDirection: "row", alignItems: "center", gap: 5, marginBottom: 4, flexWrap: "wrap" },
  txAmount: { fontSize: 15, fontWeight: "700", letterSpacing: -0.3 },
  txDot: { fontSize: 11, color: T.inkMuted },
  txMeta: { fontSize: 12, color: T.inkMuted },
  txDate: { fontSize: 11.5, color: T.inkMuted },

  badge: { flexDirection: "row", alignItems: "center", paddingHorizontal: 8, paddingVertical: 3, borderRadius: T.radiusFull },
  badgeDot: { width: 5, height: 5, borderRadius: 3, marginRight: 5 },
  badgeText: { fontSize: 11.5, fontWeight: "600" },

  detailPanel: {
    borderTopWidth: 1, borderTopColor: T.border,
    paddingHorizontal: T.sp4, paddingTop: T.sp3, paddingBottom: T.sp4,
  },
  detailSection: { marginBottom: T.sp3 },
  detailSectionTitle: {
    fontSize: 11, fontWeight: "700", color: T.inkMuted,
    textTransform: "uppercase", letterSpacing: 0.7, marginBottom: 8,
  },
  detailRow: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingVertical: 7, borderBottomWidth: 1, borderBottomColor: T.bg,
  },
  detailLabel: { fontSize: 13, color: T.inkMid, flex: 1 },
  detailValue: { fontSize: 13, fontWeight: "500", color: T.ink, textAlign: "right", maxWidth: "60%" },
  detailMono: {
    fontFamily: Platform.OS === "ios" ? "Courier New" : "monospace",
    fontSize: 11.5, color: T.ink, maxWidth: 180,
  },
  copyTarget: { flexDirection: "row", alignItems: "center", maxWidth: "62%" },

  loadMoreContainer: { paddingHorizontal: T.sp4, paddingVertical: T.sp3, alignItems: "center" },
  loadMoreDivider: { height: 1, backgroundColor: T.border, width: "100%", marginBottom: T.sp3 },
  loadMoreLoadingRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 12 },
  loadMoreLoadingText: { fontSize: 13.5, color: T.inkMid, fontWeight: "500" },
  loadMoreButton: {
    flexDirection: "row", alignItems: "center", gap: T.sp2,
    paddingHorizontal: 20, paddingVertical: 12,
    backgroundColor: T.accentSoft, borderRadius: T.radiusMd,
    borderWidth: 1.5, borderColor: T.accentMid,
  },
  loadMoreButtonText: { fontSize: 14, fontWeight: "600", color: T.accent },
  loadMoreBadge: {
    marginLeft: 4, paddingHorizontal: 8, paddingVertical: 3,
    backgroundColor: T.accentMid, borderRadius: T.radiusFull,
  },
  loadMoreBadgeText: { fontSize: 11, fontWeight: "700", color: T.accentText },

  allLoadedFooter: {
    flexDirection: "row", alignItems: "center",
    paddingHorizontal: T.sp4, paddingVertical: T.sp5, gap: T.sp3,
  },
  allLoadedLine: { flex: 1, height: 1, backgroundColor: T.border },
  allLoadedText: { fontSize: 12, color: T.inkMuted, fontWeight: "500" },

  emptyState: { alignItems: "center", paddingTop: 60, gap: 8 },
  emptyIcon: {
    width: 64, height: 64, borderRadius: T.radiusLg,
    backgroundColor: T.surface, borderWidth: 1, borderColor: T.border,
    justifyContent: "center", alignItems: "center", marginBottom: 4,
  },
  emptyTitle: { fontSize: 16, fontWeight: "700", color: T.ink },
  emptyBody: { fontSize: 13.5, color: T.inkMid, textAlign: "center", maxWidth: 260, lineHeight: 20 },
  emptyClearBtn: {
    marginTop: 12, backgroundColor: T.accent, borderRadius: T.radiusMd,
    paddingHorizontal: 22, paddingVertical: 10, minHeight: 44,
  },
  emptyClearText: { fontSize: 14, fontWeight: "700", color: "#fff" },

  adminNoteBox: {
    backgroundColor: T.blueSoft,
    borderRadius: T.radiusMd,
    borderWidth: 1,
    borderColor: T.blueMid,
    padding: T.sp3,
    gap: 0,
  },
  adminNoteHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginBottom: 6,
  },
  adminNoteTitle: {
    fontSize: 12,
    fontWeight: "700",
    color: T.blueText,
    flex: 1,
  },
  adminNoteDate: {
    fontSize: 11,
    color: T.blueText,
    opacity: 0.75,
  },
  adminNoteText: {
    fontSize: 13,
    color: T.blueText,
    lineHeight: 19,
  },
});
