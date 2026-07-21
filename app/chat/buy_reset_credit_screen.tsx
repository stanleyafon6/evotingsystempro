import React, {
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  LayoutAnimation,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  UIManager,
  View,
} from "react-native";
import { Ionicons, MaterialIcons } from "@expo/vector-icons";
import { router, useFocusEffect, useLocalSearchParams } from "expo-router";
import {
  addDoc,
  collection,
  doc,
  getDoc,
  onSnapshot,
  serverTimestamp,
  setDoc,
} from "firebase/firestore";
import { db } from "@/firebase";
import { GlobalContext } from "@/context";
import ReusableScreen from "@/components/ReusableScreen";
import { MenuProvider } from "react-native-popup-menu";

if (
  Platform.OS === "android" &&
  UIManager.setLayoutAnimationEnabledExperimental
) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

// ─── Constants ────────────────────────────────────────────────────────────────
const TRANSACTION_WALLET_DB = "TRANSACTION_WALLET_DB";
/** Single-document wallet store. Doc ID === userId (email). */
const WALLET_DB = "WALLET_DB";


const IS_WEB = Platform.OS === 'web';
const IS_IOS = Platform.OS === 'ios';

const GHS_PER_CREDIT = 0.2;
const MIN_PAYG_CREDITS = 5;
const MAX_PAYG_CREDITS = 10_000;

const MONTHLY_GHS = 200; // ← Updated from GHS 10 to GHS 200
const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1_000;

const MIN_SUB_QTY = 1;
const MAX_MONTHLY_QTY = 12;

const FREE_TRIAL_CREDITS = 15;

// ─── Design Tokens ────────────────────────────────────────────────────────────
const BG = "#F7F8FA";
const SURFACE = "#FFFFFF";
const SURFACE_ALT = "#F2F4F7";
const BORDER = "#E4E7EC";
const BORDER_MED = "#CBD2DA";
const PRIMARY = "#2563EB";
const PRIMARY_BG = "#EFF6FF";

const PAYG_COLOR = "#0891B2";
const PAYG_LIGHT = "#E0F2FE";
const PAYG_DARK = "#0E7490";

const SUB_COLOR = "#16A34A";
const SUB_LIGHT = "#DCFCE7";
const SUB_DARK = "#15803D";

const SUSPEND_COLOR = "#D97706";
const SUSPEND_LIGHT = "#FEF3C7";
const SUSPEND_DARK = "#92400E";

const SUCCESS = "#16A34A";
const SUCCESS_BG = "#DCFCE7";
const ERROR = "#DC2626";
const ERROR_BG = "#FEF2F2";
const WARNING_BG = "#FEF3C7";
const WARNING = "#B45309";

const TEXT_HEADING = "#0F172A";
const TEXT_BODY = "#374151";
const TEXT_LABEL = "#6B7280";
const TEXT_MUTED = "#909397";
const TEXT_WHITE = "#FFFFFF";

const SCREEN_THEME = "#F7F8FA";

// ─── Types ────────────────────────────────────────────────────────────────────
type PlanKey = "payg" | "monthly";
type PurchaseStage = "idle" | "processing" | "success" | "insufficient";

/** Shape of WALLET_DB document (canonical, 2025). */
interface WalletDoc {
  email: string;
  free_reset_credit: number;
  pay_as_you_go_credits: number;           // numeric credit balance
  pay_as_you_go: { date_subscribed: number | null }; // metadata obj
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

interface PlanConfig {
  key: PlanKey;
  name: string;
  tagline: string;
  priceLabel: string;
  perUnit: string;
  color: string;
  colorLight: string;
  colorDark: string;
  icon: keyof typeof Ionicons.glyphMap;
  badge?: string;
  features: string[];
}

// ─── Plan definitions ─────────────────────────────────────────────────────────
const PLANS: PlanConfig[] = [
  {
    key: "payg",
    name: "Pay As You Go",
    tagline: "Buy exactly what you need, no commitment",
    priceLabel: "GHS 0.20",
    perUnit: "per credit",
    color: PAYG_COLOR,
    colorLight: PAYG_LIGHT,
    colorDark: PAYG_DARK,
    icon: "flash",
    features: [
      "Credits never expire",
      "Minimum 5 credits per purchase",
      "Maximum 10,000 credits per order",
      "P2P credit transfers supported",
    ],
  },
  {
    key: "monthly",
    name: "Monthly Plan",
    tagline: "Unlimited resets for 30 days",
    priceLabel: "GHS 200", // ← Updated from GHS 10 to GHS 200
    perUnit: "/ 30 days",
    color: SUB_COLOR,
    colorLight: SUB_LIGHT,
    colorDark: SUB_DARK,
    icon: "calendar-outline",
    badge: "POPULAR",
    features: [
      "30 days of unlimited resets",
      "Stack months to extend access",
      "Subscriber-only bonus questions",
      "Priority leaderboard badge",
    ],
  },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────
const generateRef = (prefix = "TXN"): string => {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  const rand = Array.from({ length: 12 }, () =>
    chars[Math.floor(Math.random() * chars.length)]
  ).join("");
  return `${prefix}_${rand}`;
};

const fmtDate = (ms: number) =>
  new Date(ms).toLocaleDateString("en-GB", {
    day: "numeric", month: "short", year: "numeric",
  });

const fmtGHS = (n: number) =>
  `GHS ${n.toLocaleString("en-GH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;

// ─── Sub-components ───────────────────────────────────────────────────────────

const PlanBadge = ({
  label, color, colorLight,
}: { label: string; color: string; colorLight: string }) => (
  <View style={[pb.wrap, { backgroundColor: colorLight, borderColor: color }]}>
    <Text style={[pb.text, { color }]}>{label}</Text>
  </View>
);
const pb = StyleSheet.create({
  wrap: { borderRadius: 4, paddingHorizontal: 7, paddingVertical: 3, borderWidth: 1 },
  text: { fontSize: 9, fontWeight: "800", letterSpacing: 1 },
});

const FeatureRow = ({ text, color }: { text: string; color: string; colorLight: string }) => (
  <View style={fr.row}>
    <View style={[fr.check, { backgroundColor: "orange" }]}>
      <Ionicons name="checkmark" size={13} color="#fff" />
    </View>
    <Text style={fr.text}>{text}</Text>
  </View>
);
const fr = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "flex-start", gap: 10, paddingVertical: 5 },
  check: { width: 18, height: 18, borderRadius: 10, alignItems: "center", justifyContent: "center", marginTop: 1 },
  text: { flex: 1, fontSize: 15, color: TEXT_BODY, lineHeight: 20 },
});

const SectionDivider = ({ label }: { label: string }) => (
  <View style={sd.row}>
    <View style={sd.line} />
    <Text style={sd.label}>{label}</Text>
    <View style={sd.line} />
  </View>
);
const sd = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: 10 },
  line: { flex: 1, height: 1, backgroundColor: BORDER_MED },
  label: { fontSize: 13, fontWeight: "700", color: TEXT_MUTED, letterSpacing: 1 },
});

// ─── StatBlock ────────────────────────────────────────────────────────────────
const StatBlock = ({
  label, value, valueColor, icon, iconColor, iconBg,
}: {
  label: string; value: string; valueColor: string;
  icon: keyof typeof Ionicons.glyphMap; iconColor: string; iconBg: string;
}) => (
  <View style={stb.wrap}>
    <View style={[stb.iconBox, { backgroundColor: iconBg }]}>
      <Ionicons name={icon} size={20} color={iconColor} />
    </View>
    <View style={stb.textWrap}>
      <Text style={stb.label} numberOfLines={1}>{label}</Text>
      <Text style={[stb.value, { color: valueColor }]} numberOfLines={1} adjustsFontSizeToFit>
        {value}
      </Text>
    </View>
  </View>
);
const stb = StyleSheet.create({
  wrap: { flex: 1, flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 13, paddingHorizontal: 12 },
  iconBox: { width: 34, height: 34, borderRadius: 9, alignItems: "center", justifyContent: "center", flexShrink: 0 },
  textWrap: { flex: 1, gap: 1 },
  label: { fontSize: 11, color: TEXT_MUTED, fontWeight: "600", letterSpacing: 0.3 },
  value: { fontSize: 17, fontWeight: "800" },
});

// ─── MonthlyToggleBlock ───────────────────────────────────────────────────────
const MonthlyToggleBlock = ({
  monthlyIsActive, isSuspended, monthlyExpiresAt, adjustedExpiresAt,
  isTogglingMonthly, onToggle,
}: {
  monthlyIsActive: boolean;
  isSuspended: boolean;
  monthlyExpiresAt: number | null;
  adjustedExpiresAt: number | null;
  isTogglingMonthly: boolean;
  onToggle: () => void;
}) => {
  const canManuallyToggle = monthlyIsActive && !isSuspended;
  const iconColor = isSuspended ? SUSPEND_COLOR : monthlyIsActive ? SUB_COLOR : TEXT_MUTED;
  const iconBg = isSuspended ? SUSPEND_LIGHT : monthlyIsActive ? SUB_LIGHT : SURFACE_ALT;
  const trackColorTrue = isSuspended ? SUSPEND_COLOR : SUB_COLOR;

  const statusLabel = isSuspended
    ? adjustedExpiresAt
      ? `Paused · Resumes ${fmtDate(adjustedExpiresAt)}`
      : "Paused (PAYG active)"
    : monthlyIsActive
      ? monthlyExpiresAt ? `Until ${fmtDate(monthlyExpiresAt)}` : "Active"
      : "Inactive";

  const statusColor = isSuspended ? SUSPEND_DARK : monthlyIsActive ? SUB_DARK : TEXT_MUTED;

  return (
    <View style={mtb.wrap}>
      <View style={[mtb.iconBox, { backgroundColor: iconBg }]}>
        <Ionicons
          name={isSuspended ? "pause-circle-outline" : "calendar-outline"}
          size={20} color={iconColor}
        />
      </View>
      <View style={mtb.textWrap}>
        <Text style={mtb.label} numberOfLines={1}>Monthly Plan</Text>
        <Text style={[mtb.status, { color: statusColor }]} numberOfLines={1} adjustsFontSizeToFit>
          {statusLabel}
        </Text>
      </View>
      {isTogglingMonthly ? (
        <ActivityIndicator size="small" color={SUB_COLOR} />
      ) : (
        <Switch
          value={monthlyIsActive && !isSuspended}
          onValueChange={canManuallyToggle ? onToggle : undefined}
          disabled={!canManuallyToggle}
          trackColor={{ false: BORDER_MED, true: trackColorTrue }}
          thumbColor={monthlyIsActive ? "#fff" : SURFACE_ALT}
          ios_backgroundColor={BORDER_MED}
          style={{ opacity: canManuallyToggle ? 1 : 0.55 }}
        />
      )}
    </View>
  );
};
const mtb = StyleSheet.create({
  wrap: { flex: 1, flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 13, paddingHorizontal: 12 },
  iconBox: { width: 34, height: 34, borderRadius: 9, alignItems: "center", justifyContent: "center", flexShrink: 0 },
  textWrap: { flex: 1, gap: 1 },
  label: { fontSize: 11, color: TEXT_MUTED, fontWeight: "600", letterSpacing: 0.3 },
  status: { fontSize: 13, fontWeight: "800" },
});

// ─── SuspensionBanner ─────────────────────────────────────────────────────────
const SuspensionBanner = ({
  paygCredits, adjustedExpiresAt,
}: { paygCredits: number; adjustedExpiresAt: number | null }) => (
  <View style={sb.wrap}>
    <Ionicons name="pause-circle" size={20} color={SUSPEND_COLOR} />
    <View style={{ flex: 1, gap: 3 }}>
      <Text style={sb.title}>Monthly Plan Suspended</Text>
      <Text style={sb.body}>
        Your monthly plan is paused while you have{" "}
        <Text style={sb.bold}>{paygCredits} PAYG credit{paygCredits !== 1 ? "s" : ""}</Text>.
        The clock resumes automatically once your PAYG balance reaches zero.
        {adjustedExpiresAt ? ` Estimated resume date: ${fmtDate(adjustedExpiresAt)}.` : ""}
      </Text>
    </View>
  </View>
);
const sb = StyleSheet.create({
  wrap: { flexDirection: "row", alignItems: "flex-start", gap: 10, padding: 14, backgroundColor: SUSPEND_LIGHT, borderRadius: 12, borderWidth: 1, borderColor: SUSPEND_COLOR + "50" },
  title: { fontSize: 13, fontWeight: "800", color: SUSPEND_DARK },
  body: { fontSize: 12, color: TEXT_BODY, lineHeight: 18 },
  bold: { fontWeight: "800", color: SUSPEND_DARK },
});

// ─── CreditInput ──────────────────────────────────────────────────────────────
const CreditInput = ({
  value, onChange, color, colorLight,
}: { value: string; onChange: (v: string) => void; color: string; colorLight: string }) => {
  const [focused, setFocused] = useState(false);
  const amount = Number(value);
  const valid = amount >= MIN_PAYG_CREDITS && amount <= MAX_PAYG_CREDITS;
  return (
    <View style={ci.wrapper}>
      <Text style={ci.label}>Number of credits</Text>
      <View style={[ci.row, (focused || valid) && { borderColor: color }]}>
        <View style={[ci.iconBox, { backgroundColor: valid ? colorLight : SURFACE_ALT }]}>
          <Ionicons name="flash" size={15} color={valid ? color : TEXT_MUTED} />
        </View>
        <TextInput
          style={ci.input}
          value={value}
          onChangeText={onChange}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          keyboardType="number-pad"
          placeholder={`Min ${MIN_PAYG_CREDITS} — Max ${MAX_PAYG_CREDITS.toLocaleString()}`}
          placeholderTextColor={TEXT_MUTED}
          selectionColor={color}
        />
        {valid && (
          <View style={[ci.pricePill, { backgroundColor: color }]}>
            <Text style={ci.priceText}>{fmtGHS(amount * GHS_PER_CREDIT)}</Text>
          </View>
        )}
      </View>
      <Text style={ci.hint}>
        {valid
          ? `${amount.toLocaleString()} credits · Total: ${fmtGHS(amount * GHS_PER_CREDIT)}`
          : `GHS ${GHS_PER_CREDIT.toFixed(2)} per credit`}
      </Text>
    </View>
  );
};
const ci = StyleSheet.create({
  wrapper: { gap: 7 },
  label: { fontSize: 11, fontWeight: "700", color: TEXT_LABEL, letterSpacing: 0.3 },
  row: { flexDirection: "row", alignItems: "center", borderWidth: 1.5, borderColor: BORDER, borderRadius: 12, backgroundColor: SURFACE, overflow: "hidden" },
  iconBox: { width: 44, height: 46, alignItems: "center", justifyContent: "center" },
  input: { flex: 1, paddingHorizontal: 10, paddingVertical: 13, fontSize: 15, color: TEXT_HEADING, ...(Platform.OS === "web" ? { outlineStyle: "none" } : {}) },
  pricePill: { paddingHorizontal: 14, paddingVertical: 13 },
  priceText: { fontSize: 13, fontWeight: "800", color: TEXT_WHITE },
  hint: { fontSize: 11, color: TEXT_MUTED },
});

// ─── QuantitySelector ─────────────────────────────────────────────────────────
const QuantitySelector = ({
  value, onChange, min, max, color, colorLight, unitLabel, unitPrice,
}: {
  value: number; onChange: (v: number) => void; min: number; max: number;
  color: string; colorLight: string; unitLabel: string; unitPrice: number;
}) => {
  const total = value * unitPrice;
  return (
    <View style={qs.wrapper}>
      <Text style={qs.label}>
        How many {unitLabel}s?{" "}
        <Text style={[qs.range, { color }]}>({min}–{max})</Text>
      </Text>
      <View style={qs.row}>
        <TouchableOpacity
          style={[qs.stepBtn, value <= min && qs.stepBtnDisabled, value > min && { borderColor: color, backgroundColor: colorLight }]}
          onPress={() => onChange(Math.max(min, value - 1))}
          disabled={value <= min}
          activeOpacity={0.7}
        >
          <Ionicons name="remove" size={18} color={value <= min ? TEXT_MUTED : color} />
        </TouchableOpacity>
        <View style={[qs.display, { borderColor: color }]}>
          <Text style={[qs.qty, { color }]}>{value}</Text>
          <Text style={qs.unit}>{unitLabel}{value !== 1 ? "s" : ""}</Text>
        </View>
        <TouchableOpacity
          style={[qs.stepBtn, value >= max && qs.stepBtnDisabled, value < max && { borderColor: color, backgroundColor: colorLight }]}
          onPress={() => onChange(Math.min(max, value + 1))}
          disabled={value >= max}
          activeOpacity={0.7}
        >
          <Ionicons name="add" size={18} color={value >= max ? TEXT_MUTED : color} />
        </TouchableOpacity>
        <View style={[qs.totalPill, { backgroundColor: color }]}>
          <Text style={qs.totalText}>{fmtGHS(total)}</Text>
        </View>
      </View>
      <Text style={qs.hint}>
        {value} {unitLabel}{value !== 1 ? "s" : ""} · {fmtGHS(unitPrice)} each · Total: {fmtGHS(total)}
      </Text>
    </View>
  );
};
const qs = StyleSheet.create({
  wrapper: { gap: 7 },
  label: { fontSize: 11, fontWeight: "700", color: TEXT_LABEL, letterSpacing: 0.3 },
  range: { fontWeight: "600" },
  row: { flexDirection: "row", alignItems: "center", gap: 8 },
  stepBtn: { width: 42, height: 46, borderRadius: 12, borderWidth: 1.5, borderColor: BORDER_MED, backgroundColor: SURFACE_ALT, alignItems: "center", justifyContent: "center" },
  stepBtnDisabled: { opacity: 0.4 },
  display: { flex: 1, height: 46, borderRadius: 12, borderWidth: 1.5, backgroundColor: SURFACE, alignItems: "center", justifyContent: "center", flexDirection: "row", gap: 5 },
  qty: { fontSize: 22, fontWeight: "900", letterSpacing: -0.5 },
  unit: { fontSize: 13, fontWeight: "600", color: TEXT_MUTED, marginTop: 2 },
  totalPill: { paddingHorizontal: 14, paddingVertical: 13, borderRadius: 12, height: 46, alignItems: "center", justifyContent: "center" },
  totalText: { fontSize: 13, fontWeight: "800", color: TEXT_WHITE },
  hint: { fontSize: 11, color: TEXT_MUTED },
});

// ─── OrderSummary ─────────────────────────────────────────────────────────────
const OrderSummary = ({
  cost, walletBalance, canAfford, color,
}: { cost: number; walletBalance: number; canAfford: boolean; color: string }) => (
  <View style={os.card}>
    <View style={os.row}>
      <Text style={os.label}>Order total</Text>
      <Text style={[os.value, { color }]}>{fmtGHS(cost)}</Text>
    </View>
    <View style={os.sep} />
    <View style={os.row}>
      <Text style={os.label}>Wallet balance</Text>
      <Text style={[os.value, { color: canAfford ? SUCCESS : ERROR }]}>{fmtGHS(walletBalance)}</Text>
    </View>
    {canAfford && (
      <>
        <View style={os.sep} />
        <View style={os.row}>
          <Text style={os.label}>Balance after purchase</Text>
          <Text style={[os.value, { color: TEXT_BODY }]}>{fmtGHS(walletBalance - cost)}</Text>
        </View>
      </>
    )}
  </View>
);
const os = StyleSheet.create({
  card: { backgroundColor: SURFACE_ALT, borderRadius: 12, borderWidth: 1, borderColor: BORDER, overflow: "hidden" },
  row: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingHorizontal: 14, paddingVertical: 11 },
  label: { fontSize: 12, color: TEXT_LABEL, fontWeight: "600" },
  value: { fontSize: 14, fontWeight: "800" },
  sep: { height: 1, backgroundColor: BORDER },
});

// ─── Main Screen ──────────────────────────────────────────────────────────────
export default function BuyResetCreditScreen() {
  //const { email } = useLocalSearchParams<{ email: string }>();
  const { userId, userName } = useContext(GlobalContext);

  useFocusEffect(
    useCallback(() => { if (!userName) router.replace("/"); }, [userName])
  );


  // ── Wallet balance — read from WALLET_DB.current_balance ──────────────────
  /**
   * Mirrors profile.tsx fetchWalletBalance():
   *   getDoc(doc(db, WALLET_DB, userId)) → data().current_balance
   * No transaction-history aggregation.
   */
  const [walletBalance, setWalletBalance] = useState(0);
  const [refreshing, setRefreshing] = useState(false);

  const fetchWalletBalance = useCallback(async (showSpinner = false) => {
    if (!userId) return;
    if (showSpinner) setRefreshing(true);
    try {
      const snap = await getDoc(doc(db, WALLET_DB, userId));
      if (snap.exists()) {
        const data = snap.data() as WalletDoc;
        setWalletBalance(data.current_balance ?? 0);
      }
    } catch (err) {
      console.error("fetchWalletBalance:", err);
    } finally {
      if (showSpinner) setRefreshing(false);
    }
  }, [userId]);

  useEffect(() => { fetchWalletBalance(); }, [fetchWalletBalance]);

  useFocusEffect(
    useCallback(() => { fetchWalletBalance(); }, [fetchWalletBalance])
  );

  // ── Profile / plan state ──────────────────────────────────────────────────
  const [loadingProfile, setLoadingProfile] = useState(true);
  const [activePlanId, setActivePlanId] = useState<string>("free_trial");
  const [planExpiresAt, setPlanExpiresAt] = useState<number | null>(null);
  const [paidAsYouGoCredits, setPaidAsYouGoCredits] = useState(0);
  const [freeCredits, setFreeCredits] = useState(FREE_TRIAL_CREDITS);
  const [monthlyTotalPurchases, setMonthlyTotalPurchases] = useState(0);
  const [monthlyExpiresAt, setMonthlyExpiresAt] = useState<number | null>(null);

  // ── Suspension state ───────────────────────────────────────────────────────
  const [isSuspended, setIsSuspended] = useState(false);
  const [suspensionStartedAt, setSuspensionStartedAt] = useState<number | null>(null);
  const [adjustedExpiresAt, setAdjustedExpiresAt] = useState<number | null>(null);

  // ── Toggle state ───────────────────────────────────────────────────────────
  const [isTogglingMonthly, setIsTogglingMonthly] = useState(false);

  // ── UI state ───────────────────────────────────────────────────────────────
  const [selectedPlan, setSelectedPlan] = useState<PlanKey | null>(null);
  const [paygCredits, setPaygCredits] = useState("");
  const [monthlyQty, setMonthlyQty] = useState(1);
  const [stage, setStage] = useState<PurchaseStage>("idle");
  const [successMsg, setSuccessMsg] = useState("");

  const isPlanExpired = activePlanId === "monthly" && planExpiresAt != null && Date.now() > planExpiresAt;
  const effectivePlanId = isPlanExpired ? "free_trial" : activePlanId;

  const paygAmount = Number(paygCredits);
  const paygValid = paygAmount >= MIN_PAYG_CREDITS && paygAmount <= MAX_PAYG_CREDITS;

  const getOrderGHS = (key: PlanKey): number => {
    if (key === "payg") return paygValid ? paygAmount * GHS_PER_CREDIT : 0;
    return MONTHLY_GHS * monthlyQty;
  };

  const orderGHS = selectedPlan ? getOrderGHS(selectedPlan) : 0;
  const canAfford = walletBalance >= orderGHS && orderGHS > 0;

  const monthlyIsActive =
    activePlanId === "monthly" &&
    monthlyExpiresAt != null &&
    Date.now() <= monthlyExpiresAt;

  // ── Guard: prevent concurrent suspension/resumption writes ────────────────
  const suspendResumeInFlightRef = useRef(false);

  // ── WALLET_DB real-time listener ──────────────────────────────────────────
  /**
   * Single onSnapshot on WALLET_DB doc.
   * Reads authoritative balance + subscription metadata.
   * Handles suspend / resume / stale-plan cleanup (same logic as before,
   * using the canonical WalletDoc shape).
   */
  const scoreboardUnsubRef = useRef<(() => void) | null>(null);

  const subscribeToWalletDoc = useCallback(() => {
    if (!userId || scoreboardUnsubRef.current) return;

    const memberRef = doc(db, WALLET_DB, userId as string);

    const unsub = onSnapshot(
      memberRef,
      async (snap) => {
        if (!snap.exists()) { setLoadingProfile(false); return; }

        const d = snap.data() as WalletDoc;

        // ── Read fields ────────────────────────────────────────────────────
        const rawPlanId = d.plan_id ?? "free_trial";
        const rawPlanExpiresAt = d.monthly_subscription_plan?.expires_at ?? null;
        const rawPayg = Number(d.pay_as_you_go_credits ?? 0);
        const rawFree = Number(d.free_reset_credit ?? FREE_TRIAL_CREDITS);
        const rawCurrentBalance = d.current_balance ?? 0;

        const sub = d.monthly_subscription_plan ?? {} as WalletDoc["monthly_subscription_plan"];
        const rawIsSuspended = sub.is_suspended ?? false;
        const rawSuspensionStartedAt = sub.suspension_started_at ?? null;
        const rawMonthlyExpiresAt = sub.expires_at ?? null;
        const rawTotalPurchases = sub.total_purchases ?? 0;

        const now = Date.now();

        // ── Stale plan cleanup ─────────────────────────────────────────────
        const isStale =
          rawPlanId === "monthly" &&
          rawPlanExpiresAt != null &&
          now > rawPlanExpiresAt &&
          !rawIsSuspended;

        if (isStale && !suspendResumeInFlightRef.current) {
          suspendResumeInFlightRef.current = true;
          try {
            await setDoc(
              memberRef,
              {
                plan_id: "free_trial",
                monthly_subscription_plan: {
                  ...sub,
                  expires_at: null,
                  is_active: false,
                  is_suspended: false,
                  suspension_started_at: null,
                },
              },
              { merge: true }
            );
          } finally {
            suspendResumeInFlightRef.current = false;
          }
          return;
        }

        const isMonthlyActive =
          rawPlanId === "monthly" &&
          rawMonthlyExpiresAt != null &&
          now <= rawMonthlyExpiresAt;

        // ── Auto-suspend ───────────────────────────────────────────────────
        const shouldSuspend = isMonthlyActive && rawPayg > 0 && !rawIsSuspended;
        const shouldResume = isMonthlyActive && rawPayg === 0 && rawIsSuspended;

        if (shouldSuspend && !suspendResumeInFlightRef.current) {
          suspendResumeInFlightRef.current = true;
          try {
            await setDoc(
              memberRef,
              {
                monthly_subscription_plan: {
                  ...sub,
                  is_suspended: true,
                  suspension_started_at: now,
                },
              },
              { merge: true }
            );
          } catch (err) {
            console.error("Suspension write error:", err);
          } finally {
            suspendResumeInFlightRef.current = false;
          }
          return;
        }

        if (shouldResume && !suspendResumeInFlightRef.current) {
          suspendResumeInFlightRef.current = true;
          try {
            const suspendedAt = rawSuspensionStartedAt ?? now;
            const remainingMs = Math.max(0, rawMonthlyExpiresAt! - suspendedAt);
            const newExpiry = now + remainingMs;
            await setDoc(
              memberRef,
              {
                monthly_subscription_plan: {
                  ...sub,
                  is_suspended: false,
                  suspension_started_at: null,
                  expires_at: newExpiry,
                },
              },
              { merge: true }
            );
          } catch (err) {
            console.error("Resume write error:", err);
          } finally {
            suspendResumeInFlightRef.current = false;
          }
          return;
        }

        // ── Commit local state ─────────────────────────────────────────────
        setWalletBalance(rawCurrentBalance);
        setActivePlanId(rawPlanId);
        setPlanExpiresAt(rawPlanExpiresAt);
        setPaidAsYouGoCredits(rawPayg);
        setFreeCredits(rawFree);
        setMonthlyTotalPurchases(rawTotalPurchases);
        setMonthlyExpiresAt(rawMonthlyExpiresAt);
        setIsSuspended(rawIsSuspended);
        setSuspensionStartedAt(rawSuspensionStartedAt);

        if (rawIsSuspended && rawSuspensionStartedAt && rawMonthlyExpiresAt) {
          const remainingMs = Math.max(0, rawMonthlyExpiresAt - rawSuspensionStartedAt);
          setAdjustedExpiresAt(now + remainingMs);
        } else {
          setAdjustedExpiresAt(null);
        }

        setLoadingProfile(false);
      },
      (err) => {
        console.error("WalletDoc snapshot error:", err);
        setLoadingProfile(false);
      }
    );

    scoreboardUnsubRef.current = unsub;
  }, [userId]);

  useEffect(() => {
    subscribeToWalletDoc();
    return () => { scoreboardUnsubRef.current?.(); scoreboardUnsubRef.current = null; };
  }, [subscribeToWalletDoc]);

  useFocusEffect(
    useCallback(() => {
      if (!scoreboardUnsubRef.current) subscribeToWalletDoc();
    }, [subscribeToWalletDoc])
  );

  // ── Manual refresh ────────────────────────────────────────────────────────
  const handleRefresh = () => fetchWalletBalance(true);

  // ── Monthly toggle (manual deactivation only) ─────────────────────────────
  const handleMonthlyToggle = useCallback(async () => {
    if (!monthlyIsActive || isSuspended || !userId || isTogglingMonthly) return;
    setIsTogglingMonthly(true);
    try {
      const memberRef = doc(db, WALLET_DB, userId as string);
      const snap = await getDoc(memberRef);
      const existing = snap.exists() ? (snap.data() as WalletDoc) : {} as WalletDoc;

      await setDoc(
        memberRef,
        {
          plan_id: "free_trial",
          is_subscribed: false,
          monthly_subscription_plan: {
            ...(existing.monthly_subscription_plan ?? {}),
            is_active: false,
            is_suspended: false,
            suspension_started_at: null,
          },
        },
        { merge: true }
      );

      setActivePlanId("free_trial");
      setPlanExpiresAt(null);
      setIsSuspended(false);
      setSuspensionStartedAt(null);
      setAdjustedExpiresAt(null);
    } catch (err) {
      console.error("Monthly toggle error:", err);
    } finally {
      setIsTogglingMonthly(false);
    }
  }, [monthlyIsActive, isSuspended, userId, isTogglingMonthly]);

  const handleSelectPlan = (key: PlanKey) => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    if (selectedPlan === key) {
      setSelectedPlan(null);
      setStage("idle");
    } else {
      setSelectedPlan(key);
      setStage("idle");
      setPaygCredits("");
      setMonthlyQty(1);
    }
  };

  // ── Purchase handler ──────────────────────────────────────────────────────
  /**
   * Uses the canonical TRANSACTION_WALLET_DB payload matching profile.tsx:
   *   { email, transaction_id, external_transaction_id,
   *     transaction_type, previous_balance, current_balance,
   *     transaction_amount, transaction_status, currency,
   *     payment_method, createdAt }
   *
   * After addDoc, updates WALLET_DB.current_balance so that
   * profile.tsx fetchWalletBalance() always reads the correct value.
   */
  const handlePurchase = async () => {
    if (!selectedPlan) return;
    if (selectedPlan === "payg" && !paygValid) return;

    const cost = getOrderGHS(selectedPlan);
    if (walletBalance < cost || cost <= 0) { setStage("insufficient"); return; }

    setStage("processing");

    try {
      const memberRef = doc(db, WALLET_DB, userId as string);
      const snap = await getDoc(memberRef);
      const existing = snap.exists() ? (snap.data() as WalletDoc) : {} as WalletDoc;

      const txRef = generateRef();
      const prevBalance = walletBalance;
      const newBalance = prevBalance - cost;
      const now = Date.now();

      // ── PAY AS YOU GO ────────────────────────────────────────────────────
      if (selectedPlan === "payg") {
        const currentPAYGCredits = Number(existing.pay_as_you_go_credits ?? 0);
        const newPAYGCredits = currentPAYGCredits + paygAmount;

        // 1. Update WALLET_DB — write new balance + updated PAYG credit count
        await setDoc(
          memberRef,
          {
            pay_as_you_go_credits: newPAYGCredits,
            transaction_type: "credit_purchase",
            previous_balance: prevBalance,
            current_balance: newBalance,
            transaction_amount: cost,
            currency: "GHS",
            payment_method: "system transfer",
          },
          { merge: true }
        );

        // 2. Write canonical transaction record
        await addDoc(collection(db, TRANSACTION_WALLET_DB), {
          email: userId,           // ← userId (matches profile.tsx)
          transaction_id: txRef,
          external_transaction_id: "none",
          transaction_type: "credit_purchase",
          previous_balance: prevBalance,
          current_balance: newBalance,
          transaction_amount: cost,
          transaction_status: "completed",
          currency: "GHS",
          payment_method: "system transfer",
          note: `PAYG purchase: ${paygAmount} credit${paygAmount !== 1 ? "s" : ""} @ GHS 0.20 each`,
          // Snapshot for profile.tsx TxCard display
          credit_snapshot: {
            plan: "payg",
            credits_purchased: paygAmount,
            credits_total_after: newPAYGCredits,
            price_per_credit: GHS_PER_CREDIT,
          },
          createdAt: serverTimestamp(),
        });

        // 3. Update local balance state immediately (snapshot will also update)
        setWalletBalance(newBalance);
        setSuccessMsg(`${paygAmount} credit${paygAmount !== 1 ? "s" : ""} added to your account.`);
      }

      // ── MONTHLY SUBSCRIPTION ─────────────────────────────────────────────
      else {
        const qty = monthlyQty;
        const durationMs = THIRTY_DAYS_MS * qty;

        const existingSub = existing.monthly_subscription_plan ?? {
          expires_at: null,
          is_active: false,
          is_suspended: false,
          last_purchased_at: null,
          started_at: null,
          suspension_started_at: null,
          total_purchases: 0,
        };

        const isCurrSuspended = existingSub.is_suspended ?? false;
        const suspStart = existingSub.suspension_started_at ?? null;
        const currentExpiry = existingSub.expires_at ?? null;

        const isCurrentlyActive =
          existing.plan_id === "monthly" &&
          currentExpiry != null &&
          now <= currentExpiry;

        // If suspended, stack onto the suspension point (not the clock-frozen expiry)
        let baseTime: number;
        if (isCurrentlyActive) {
          baseTime = (isCurrSuspended && suspStart) ? suspStart : currentExpiry!;
        } else {
          baseTime = now;
        }

        const newExpiry = baseTime + durationMs;

        const updatedSub: WalletDoc["monthly_subscription_plan"] = {
          is_active: true,
          is_suspended: isCurrSuspended,
          suspension_started_at: suspStart,
          started_at: isCurrentlyActive && existingSub.started_at
            ? existingSub.started_at : now,
          expires_at: newExpiry,
          last_purchased_at: now,
          total_purchases: (existingSub.total_purchases ?? 0) + qty,
        };

        // 1. Update WALLET_DB
        await setDoc(
          memberRef,
          {
            plan_id: "monthly",
            is_subscribed: true,
            monthly_subscription_plan: updatedSub,
            transaction_type: "subscription_purchase",
            previous_balance: prevBalance,
            current_balance: newBalance,
            transaction_amount: cost,
            currency: "GHS",
            payment_method: "system transfer",
          },
          { merge: true }
        );

        // 2. Canonical transaction record
        await addDoc(collection(db, TRANSACTION_WALLET_DB), {
          email: userId,
          transaction_id: txRef,
          external_transaction_id: "none",
          transaction_type: "subscription_purchase",
          previous_balance: prevBalance,
          current_balance: newBalance,
          transaction_amount: cost,
          transaction_status: "completed",
          currency: "GHS",
          payment_method: "system transfer",
          note: `Monthly subscription: ${qty} month${qty !== 1 ? "s" : ""} — expires ${fmtDate(newExpiry)}`,
          // Snapshot for profile.tsx TxCard display
          subscription_snapshot: {
            plan: "monthly",
            expires_at: newExpiry,
            stacked: isCurrentlyActive,
            total_purchases: updatedSub.total_purchases,
          },
          createdAt: serverTimestamp(),
        });

        // 3. Update local balance state immediately
        setWalletBalance(newBalance);
        setSuccessMsg(`${qty}-Month Plan active until ${fmtDate(newExpiry)}.`);
      }

      setStage("success");
    } catch (err) {
      console.error("Purchase error:", err);
      setStage("idle");
    }
  };

  const resetFlow = () => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setStage("idle");
    setSelectedPlan(null);
    setPaygCredits("");
    setMonthlyQty(1);
    setSuccessMsg("");
  };

  // ── Loading ────────────────────────────────────────────────────────────────
  if (loadingProfile) {
    return (
      <View style={s.loaderRoot}>
        <ActivityIndicator size="large" color={PRIMARY} />
        <Text style={s.loaderText}>Loading your account…</Text>
      </View>
    );
  }

  const activePlanCfg = PLANS.find((p) => p.key === effectivePlanId);

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <ReusableScreen>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        keyboardVerticalOffset={Platform.OS === "ios" ? 0 : 20}
      >

        <View style={s.root}>

          {/* ══ Top bar ══════════════════════════════════════════════════════════ */}
          <View style={s.topBar}>
            <TouchableOpacity onPress={() => router.back()} hitSlop={12} style={s.backBtn}>
              <Ionicons name="arrow-back" size={18} color="#fff" />
            </TouchableOpacity>

            <View style={{ flex: 1 }}>
              <Text style={s.topBarTitle}>Credits & Plans</Text>
              {userName ? <Text style={s.topBarSub} numberOfLines={1}>{userName}</Text> : null}
            </View>

            <TouchableOpacity
              style={s.historyBtn}
              onPress={() => router.navigate("./UserTransactionScreen")}
              activeOpacity={0.75}
            >
              <MaterialIcons name="receipt-long" size={14} color={PRIMARY} />
              <Text style={s.historyLabel}>History</Text>
            </TouchableOpacity>
          </View>

          {/* ══ Scroll ═══════════════════════════════════════════════════════════ */}
          <ScrollView
            style={{ flex: 1 }}
            contentContainerStyle={s.scrollContent}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
          >
            {/* ════════════════════════════════════════════════════════════════
              ACCOUNT SUMMARY CARD
          ════════════════════════════════════════════════════════════════ */}
            <View style={s.summaryCard}>

              {/* Header: wallet balance + plan chip + refresh */}
              <View style={s.summaryHeader}>
                <View style={s.summaryLeft}>

                  {/* Wallet balance — sourced from WALLET_DB.current_balance */}
                  <View style={s.summaryBalanceRow}>
                    <View style={s.summaryWalletIconWrap}>
                      <Ionicons name="wallet" size={16} color={PRIMARY} />
                    </View>
                    <View>
                      <Text style={s.summaryBalanceLabel}>Wallet Balance</Text>
                      <Text style={s.summaryBalanceValue}>{fmtGHS(walletBalance)}</Text>
                    </View>
                  </View>

                  {/* Plan chip */}
                  <View style={s.summaryPlanRow}>
                    <View
                      style={[
                        s.planDot,
                        { backgroundColor: isSuspended ? SUSPEND_COLOR : activePlanCfg ? activePlanCfg.color : TEXT_MUTED },
                      ]}
                    />
                    <Text
                      style={[
                        s.summaryPlanName,
                        { color: isSuspended ? SUSPEND_DARK : activePlanCfg ? activePlanCfg.colorDark : TEXT_LABEL },
                      ]}
                    >
                      {isSuspended
                        ? "Monthly Plan (Paused)"
                        : activePlanCfg ? activePlanCfg.name : "Free Trial"}
                    </Text>

                    {isSuspended && (
                      <View style={s.suspendedChip}>
                        <Ionicons name="pause-circle-outline" size={10} color={SUSPEND_DARK} />
                        <Text style={s.suspendedChipText}>PAYG Active</Text>
                      </View>
                    )}

                    {!isSuspended && planExpiresAt && !isPlanExpired && (
                      <View style={s.expiryChip}>
                        <Ionicons name="time-outline" size={10} color={SUB_DARK} />
                        <Text style={s.expiryChipText}>Until {fmtDate(planExpiresAt)}</Text>
                      </View>
                    )}

                    {isPlanExpired && !isSuspended && (
                      <View style={s.expiredBadge}>
                        <Ionicons name="warning-outline" size={11} color={WARNING} />
                        <Text style={s.expiredBadgeText}>Expired</Text>
                      </View>
                    )}
                  </View>
                </View>

                <TouchableOpacity
                  onPress={handleRefresh}
                  disabled={refreshing}
                  hitSlop={10}
                  style={s.refreshBtn}
                >
                  {refreshing
                    ? <ActivityIndicator size="small" color={PRIMARY} />
                    : <Ionicons name="refresh-outline" size={17} color={TEXT_LABEL} />}
                </TouchableOpacity>
              </View>

              <View style={s.summaryDivider} />

              {/* Stat grid: Free Credits | PAYG Credits */}
              <View style={s.summaryStats}>
                <StatBlock
                  label="Free Credits"
                  value={String(freeCredits)}
                  valueColor={PRIMARY}
                  icon="gift-outline"
                  iconColor={PRIMARY}
                  iconBg={PRIMARY_BG}
                />
                <View style={s.statDivider} />
                <StatBlock
                  label="PAYG Credits"
                  value={String(paidAsYouGoCredits)}
                  valueColor={paidAsYouGoCredits > 0 && monthlyIsActive ? SUSPEND_DARK : PAYG_DARK}
                  icon="flash"
                  iconColor={paidAsYouGoCredits > 0 && monthlyIsActive ? SUSPEND_COLOR : PAYG_COLOR}
                  iconBg={paidAsYouGoCredits > 0 && monthlyIsActive ? SUSPEND_LIGHT : PAYG_LIGHT}
                />
              </View>

              <View style={s.summaryDivider} />

              {/* Stat grid: Month Purchases | Monthly plan toggle */}
              <View style={s.summaryStats}>
                <StatBlock
                  label="Month Purchases"
                  value={String(monthlyTotalPurchases)}
                  valueColor={monthlyIsActive ? (isSuspended ? SUSPEND_DARK : SUB_DARK) : TEXT_MUTED}
                  icon="calendar-outline"
                  iconColor={monthlyIsActive ? (isSuspended ? SUSPEND_COLOR : SUB_COLOR) : TEXT_MUTED}
                  iconBg={monthlyIsActive ? (isSuspended ? SUSPEND_LIGHT : SUB_LIGHT) : SURFACE_ALT}
                />
                <View style={s.statDivider} />
                <MonthlyToggleBlock
                  monthlyIsActive={monthlyIsActive}
                  isSuspended={isSuspended}
                  monthlyExpiresAt={monthlyExpiresAt}
                  adjustedExpiresAt={adjustedExpiresAt}
                  isTogglingMonthly={isTogglingMonthly}
                  onToggle={handleMonthlyToggle}
                />
              </View>
            </View>

            {/* Suspension banner */}
            {isSuspended && monthlyIsActive && (
              <SuspensionBanner
                paygCredits={paidAsYouGoCredits}
                adjustedExpiresAt={adjustedExpiresAt}
              />
            )}

            {/* Free trial banner */}
            {effectivePlanId === "free_trial" && (
              <View style={s.freeTrialBanner}>
                <Ionicons name="gift-outline" size={18} color={PRIMARY} />
                <Text style={s.freeTrialText}>
                  You have{" "}
                  <Text style={s.freeTrialBold}>{FREE_TRIAL_CREDITS} free credits</Text>{" "}
                  on your first login. Purchase a plan below to get more.
                </Text>
              </View>
            )}

            <SectionDivider label="SELECT A PLAN" />

            {/* ── Plan cards ─────────────────────────────────────────────────── */}
            {PLANS.map((plan) => {
              const isSelected = selectedPlan === plan.key;
              const thisCost = plan.key === "payg"
                ? (paygValid ? paygAmount * GHS_PER_CREDIT : 0)
                : MONTHLY_GHS * monthlyQty;
              const thisCanAfford = walletBalance >= thisCost && thisCost > 0;

              return (
                <View key={plan.key}>
                  <Pressable
                    onPress={() => handleSelectPlan(plan.key)}
                    style={[
                      s.planCard,
                      isSelected && { borderColor: plan.color, borderWidth: 2 },
                    ]}
                  >
                    <View style={[s.accentBar, { backgroundColor: isSelected ? plan.color : "transparent" }]} />

                    <View style={s.planHeader}>
                      <View style={[s.planIconBox, { backgroundColor: isSelected ? plan.color : plan.colorLight }]}>
                        <Ionicons name={plan.icon} size={20} color={isSelected ? TEXT_WHITE : plan.color} />
                      </View>

                      <View style={{ flex: 1, gap: 3 }}>
                        <View style={{ flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                          <Text style={[s.planName, isSelected && { color: plan.colorDark }]}>{plan.name}</Text>
                          {plan.badge && (
                            <PlanBadge label={plan.badge} color={plan.color} colorLight={plan.colorLight} />
                          )}
                        </View>
                        <Text style={s.planTagline}>{plan.tagline}</Text>
                        <View style={{ flexDirection: "row", alignItems: "baseline", gap: 4, marginTop: 2 }}>
                          <Text style={[s.planPrice, isSelected && { color: plan.colorDark }]}>{plan.priceLabel}</Text>
                          <Text style={s.planPerUnit}>{plan.perUnit}</Text>
                        </View>
                      </View>

                      <View style={[s.radioOuter, isSelected && { borderColor: plan.color, backgroundColor: plan.colorLight }]}>
                        <View style={[s.radioDot, { backgroundColor: isSelected ? plan.color : "#999" }]} />
                      </View>
                    </View>

                    <View style={[
                      s.planFeatures,
                      { borderTopColor: isSelected ? plan.color + "30" : BORDER },
                      isSelected && { backgroundColor: plan.colorLight + "60" },
                    ]}>
                      {plan.features.map((f, i) => (
                        <FeatureRow key={i} text={f} color={plan.color} colorLight={plan.colorLight} />
                      ))}
                    </View>
                  </Pressable>

                  {/* ── Purchase panel ── */}
                  {isSelected && (
                    <View style={[s.purchasePanel, { borderColor: plan.color }]}>

                      {plan.key === "payg" && stage !== "success" && stage !== "insufficient" && (
                        <CreditInput
                          value={paygCredits}
                          onChange={setPaygCredits}
                          color={plan.color}
                          colorLight={plan.colorLight}
                        />
                      )}

                      {plan.key === "monthly" && stage !== "success" && stage !== "insufficient" && (
                        <QuantitySelector
                          value={monthlyQty}
                          onChange={(v) => {
                            LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
                            setMonthlyQty(v);
                          }}
                          min={MIN_SUB_QTY}
                          max={MAX_MONTHLY_QTY}
                          color={plan.color}
                          colorLight={plan.colorLight}
                          unitLabel="month"
                          unitPrice={MONTHLY_GHS}
                        />
                      )}

                      {stage !== "success" &&
                        stage !== "insufficient" &&
                        (plan.key !== "payg" || paygValid) && (
                          <OrderSummary
                            cost={thisCost}
                            walletBalance={walletBalance}
                            canAfford={thisCanAfford}
                            color={plan.color}
                          />
                        )}

                      {stage === "idle" && (plan.key !== "payg" || paygValid) && (
                        <TouchableOpacity
                          style={[
                            s.confirmBtn,
                            thisCanAfford ? { backgroundColor: plan.color } : s.confirmBtnDisabled,
                          ]}
                          onPress={handlePurchase}
                          activeOpacity={0.85}
                          disabled={!thisCanAfford}
                        >
                          <Ionicons
                            name={thisCanAfford ? "flash" : "lock-closed"}
                            size={15}
                            color={thisCanAfford ? TEXT_WHITE : TEXT_MUTED}
                          />
                          <Text style={[s.confirmBtnText, !thisCanAfford && { color: TEXT_MUTED }]}>
                            {thisCanAfford ? `Pay ${fmtGHS(thisCost)}` : "Insufficient Balance"}
                          </Text>
                        </TouchableOpacity>
                      )}

                      {stage === "processing" && (
                        <View style={s.processingRow}>
                          <ActivityIndicator color={plan.color} size="small" />
                          <Text style={[s.processingText, { color: plan.colorDark }]}>Processing payment…</Text>
                        </View>
                      )}

                      {stage === "success" && (
                        <View style={s.resultBox}>
                          <View style={[s.resultIcon, { backgroundColor: SUCCESS_BG, borderColor: SUCCESS }]}>
                            <Ionicons name="checkmark" size={28} color={SUCCESS} />
                          </View>
                          <Text style={s.resultTitle}>Payment Successful</Text>
                          <Text style={s.resultSub}>{successMsg}</Text>
                          <TouchableOpacity
                            style={[s.confirmBtn, { backgroundColor: plan.color, alignSelf: "stretch" }]}
                            onPress={resetFlow}
                            activeOpacity={0.85}
                          >
                            <Ionicons name="checkmark" size={15} color={TEXT_WHITE} />
                            <Text style={s.confirmBtnText}>Done</Text>
                          </TouchableOpacity>
                        </View>
                      )}

                      {stage === "insufficient" && (
                        <View style={s.resultBox}>
                          <View style={[s.resultIcon, { backgroundColor: ERROR_BG, borderColor: ERROR }]}>
                            <Ionicons name="wallet-outline" size={26} color={ERROR} />
                          </View>
                          <Text style={[s.resultTitle, { color: ERROR }]}>Insufficient Balance</Text>
                          <Text style={s.resultSub}>
                            Your wallet ({fmtGHS(walletBalance)}) is below the required {fmtGHS(orderGHS)}.
                            Please top up to continue.
                          </Text>
                          <View style={{ flexDirection: "row", gap: 10, alignSelf: "stretch" }}>
                            <TouchableOpacity
                              style={[s.confirmBtn, { flex: 1, backgroundColor: PRIMARY }]}
                              onPress={() => router.navigate("./profile")}
                              activeOpacity={0.85}
                            >
                              <Ionicons name="wallet-outline" size={15} color={TEXT_WHITE} />
                              <Text style={s.confirmBtnText}>Top Up Wallet</Text>
                            </TouchableOpacity>
                            <TouchableOpacity style={s.outlineBtn} onPress={() => setStage("idle")} activeOpacity={0.8}>
                              <Text style={s.outlineBtnText}>Back</Text>
                            </TouchableOpacity>
                          </View>
                        </View>
                      )}
                    </View>
                  )}
                </View>
              );
            })}

            {/* Disclaimer */}
            <View style={s.disclaimer}>
              <Ionicons name="information-circle-outline" size={25} color="red" style={{ marginTop: 1 }} />
              <Text style={s.disclaimerText}>
                All prices are in Ghanaian Cedi (GHS). Subscriptions are non-refundable once
                activated. Pay As You Go credits never expire. First-time users receive{" "}
                {FREE_TRIAL_CREDITS} free credits on login. Monthly plans are paused automatically
                while PAYG credits are available.
              </Text>
            </View>

            <View style={{ height: 48 }} />
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </ReusableScreen>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const s = StyleSheet.create({
  loaderRoot: { flex: 1, backgroundColor: BG, alignItems: "center", justifyContent: "center", gap: 14 },
  loaderText: { fontSize: 14, color: TEXT_LABEL, fontWeight: "600" },

  root: { flex: 1, backgroundColor: "#ddd" },

  topBar: {
    flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingVertical: 12,
    backgroundColor: SURFACE, borderBottomWidth: 1, borderBottomColor: BORDER, gap: 12,
    shadowColor: "#000", shadowOpacity: 0.05, shadowRadius: 4, shadowOffset: { width: 0, height: 2 }, elevation: 2,
  },
  backBtn: {
    width: 36, height: 36, borderRadius: 9, borderWidth: 1, borderColor: "#fff",
    backgroundColor: "#f99420", alignItems: "center", justifyContent: "center",
  },
  topBarTitle: { fontSize: 16, fontWeight: "700", color: TEXT_HEADING, letterSpacing: -0.2 },
  topBarSub: { fontSize: 11, color: TEXT_MUTED, marginTop: 1 },
  historyBtn: {
    flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 12, paddingVertical: 7,
    borderRadius: 8, backgroundColor: PRIMARY_BG, borderWidth: 1, borderColor: PRIMARY + "40",
  },
  historyLabel: { fontSize: 12, fontWeight: "700", color: PRIMARY },

  scrollContent: { paddingHorizontal: 9, paddingTop: 8, gap: 8, margin: 5, backgroundColor: "#eee" },

  freeTrialBanner: {
    flexDirection: "row", alignItems: "flex-start", gap: 10, padding: 14,
    backgroundColor: PRIMARY_BG, borderRadius: 12, borderWidth: 1, borderColor: PRIMARY + "40",
  },
  freeTrialText: { flex: 1, fontSize: 13, color: TEXT_BODY, lineHeight: 20 },
  freeTrialBold: { fontWeight: "800", color: PRIMARY },

  summaryCard: {
    backgroundColor: SURFACE, borderRadius: 16, borderWidth: 1.5, borderColor: "#dadada",
    overflow: "hidden", shadowColor: "#ddd", shadowOpacity: 0.06, shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 }, elevation: 3,
  },
  summaryHeader: { flexDirection: "row", alignItems: "flex-start", paddingHorizontal: 16, paddingVertical: 14, gap: 10 },
  summaryLeft: { flex: 1, gap: 10 },
  summaryBalanceRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  summaryWalletIconWrap: {
    width: 32, height: 32, borderRadius: 8, backgroundColor: PRIMARY_BG,
    alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: PRIMARY + "30",
  },
  summaryBalanceLabel: { fontSize: 11, fontWeight: "600", color: TEXT_MUTED, letterSpacing: 0.3 },
  summaryBalanceValue: { fontSize: 20, fontWeight: "900", color: TEXT_HEADING, letterSpacing: -0.5 },
  summaryPlanRow: { flexDirection: "row", alignItems: "center", gap: 6, flexWrap: "wrap" },
  planDot: { width: 8, height: 8, borderRadius: 4 },
  summaryPlanName: { fontSize: 13, fontWeight: "700", letterSpacing: -0.1 },

  suspendedChip: {
    flexDirection: "row", alignItems: "center", gap: 3, backgroundColor: SUSPEND_LIGHT,
    borderRadius: 6, paddingHorizontal: 7, paddingVertical: 2, borderWidth: 1, borderColor: SUSPEND_COLOR + "50",
  },
  suspendedChipText: { fontSize: 10, fontWeight: "700", color: SUSPEND_DARK },

  expiryChip: {
    flexDirection: "row", alignItems: "center", gap: 3, backgroundColor: SUB_LIGHT,
    borderRadius: 6, paddingHorizontal: 7, paddingVertical: 2, borderWidth: 1, borderColor: SUB_COLOR + "40",
  },
  expiryChipText: { fontSize: 10, fontWeight: "700", color: SUB_DARK },

  expiredBadge: {
    flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: WARNING_BG,
    borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3, borderWidth: 1, borderColor: WARNING + "55",
  },
  expiredBadgeText: { fontSize: 11, color: WARNING, fontWeight: "700" },

  refreshBtn: {
    width: 34, height: 34, borderRadius: 9, borderWidth: 1, borderColor: BORDER,
    backgroundColor: SURFACE_ALT, alignItems: "center", justifyContent: "center", flexShrink: 0,
  },

  summaryDivider: { height: 1, backgroundColor: BORDER },
  summaryStats: { flexDirection: "row" },
  statDivider: { width: 1, backgroundColor: BORDER, marginVertical: 10 },

  planCard: {
    backgroundColor: SURFACE, borderRadius: 14, borderWidth: 1.5, borderColor: "#dadada",
    overflow: "hidden", shadowColor: "#000", shadowOpacity: 0.04, shadowRadius: 4,
    shadowOffset: { width: 0, height: 1 }, elevation: 1,
  },
  accentBar: { position: "absolute", left: 0, top: 0, bottom: 0, width: 4, zIndex: 1 },
  planHeader: { flexDirection: "row", alignItems: "center", gap: 14, padding: 16, paddingLeft: 20 },
  planIconBox: { width: 46, height: 46, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  planName: { fontSize: 15, fontWeight: "800", color: TEXT_HEADING, letterSpacing: -0.2 },
  planTagline: { fontSize: 12, color: TEXT_LABEL, lineHeight: 17 },
  planPrice: { fontSize: 18, fontWeight: "900", color: TEXT_HEADING, letterSpacing: -0.5 },
  planPerUnit: { fontSize: 12, color: TEXT_MUTED, fontWeight: "500" },
  radioOuter: {
    width: 22, height: 22, borderRadius: 11, borderWidth: 2, borderColor: BORDER_MED,
    backgroundColor: SURFACE_ALT, alignItems: "center", justifyContent: "center",
  },
  radioDot: { width: 10, height: 10, borderRadius: 5 },
  planFeatures: { paddingHorizontal: 16, paddingLeft: 20, paddingBottom: 14, paddingTop: 12, borderTopWidth: 1 },

  purchasePanel: {
    borderLeftWidth: 2, borderRightWidth: 2, borderBottomWidth: 2,
    borderBottomLeftRadius: 14, borderBottomRightRadius: 14,
    backgroundColor: SURFACE, padding: 14, gap: 12, marginTop: -2,
    shadowColor: "#000", shadowOpacity: 0.04, shadowRadius: 4, shadowOffset: { width: 0, height: 2 },
  },

  confirmBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8,
    borderRadius: 12, paddingVertical: 15,
    shadowColor: "#000", shadowOpacity: 0.1, shadowRadius: 6, shadowOffset: { width: 0, height: 3 }, elevation: 2,
  },
  confirmBtnDisabled: { backgroundColor: SURFACE_ALT, borderWidth: 1, borderColor: BORDER, shadowOpacity: 0, elevation: 0 },
  confirmBtnText: { color: TEXT_WHITE, fontSize: 15, fontWeight: "800", letterSpacing: -0.2 },

  processingRow: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 10,
    paddingVertical: 15, backgroundColor: SURFACE_ALT, borderRadius: 12, borderWidth: 1, borderColor: BORDER,
  },
  processingText: { fontSize: 14, fontWeight: "700" },

  resultBox: { alignItems: "center", gap: 10, paddingVertical: 8 },
  resultIcon: { width: 68, height: 68, borderRadius: 34, borderWidth: 1.5, alignItems: "center", justifyContent: "center" },
  resultTitle: { fontSize: 17, fontWeight: "800", color: TEXT_HEADING, letterSpacing: -0.3 },
  resultSub: { fontSize: 13, color: TEXT_BODY, textAlign: "center", lineHeight: 20, paddingHorizontal: 8 },
  outlineBtn: { borderWidth: 1.5, borderColor: BORDER_MED, borderRadius: 12, paddingVertical: 15, paddingHorizontal: 20, alignItems: "center", justifyContent: "center", backgroundColor: SURFACE },
  outlineBtnText: { fontSize: 14, fontWeight: "700", color: TEXT_LABEL },

  disclaimer: {
    flexDirection: "row", gap: 8, padding: 14, backgroundColor: SURFACE,
    borderRadius: 12, borderWidth: 1, borderColor: "#d5d5d5", alignItems: "flex-start",
  },
  disclaimerText: { flex: 1, fontSize: 14, color: "#666", lineHeight: 22 },
});
