import React, { useEffect, useState, useCallback, useContext, useMemo, useRef } from "react";
import {
    View,
    Text,
    TouchableOpacity,
    ScrollView,
    StyleSheet,
    Platform,
    ActivityIndicator,
    RefreshControl,
    TextInput,
    LayoutAnimation,
    UIManager,
    Image,
    Modal,
    Switch,
} from "react-native";
import { Ionicons, MaterialIcons } from "@expo/vector-icons";
import { router } from "expo-router";
import AsyncStorage from "@react-native-async-storage/async-storage";
import ReusableScreen from "@/components/ReusableScreen";
import { db } from "@/firebase";
import {
    collection,
    deleteDoc,
    doc,
    getDoc,
    getDocs,
    onSnapshot,
    query,
    orderBy,
    limit,
    startAfter,
    writeBatch,
    where,
    Timestamp,
    updateDoc,
} from "firebase/firestore";
import { GlobalContext } from "@/context";

if (Platform.OS === "android" && UIManager.setLayoutAnimationEnabledExperimental) {
    UIManager.setLayoutAnimationEnabledExperimental(true);
}

// ─── Types ────────────────────────────────────────────────────────────────────

interface PollSummary {
    pollId: string;
    docPath: string;
    title: string;
    pollType: "single" | "multiple";
    status: "active" | "closed";
    startDate: string | null;
    deadline: string | null;
    creatorEmail: string;
    creatorName: string;
    logoUrl?: string;
    aspirantCount: number;
    dateCreated: string;
    createdAt: number;
    showResults: boolean;
    isAnonymous: boolean;
    requires_voters_validation: "true" | "false";
    face_verification: "true" | "false";
    poll_verification_status: "verified" | "not_verified";
}

interface CreatorGroup {
    creatorEmail: string;
    creatorName: string;
    polls: PollSummary[];
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const isExpired = (deadline: string | null) =>
    deadline ? new Date(deadline) < new Date() : false;

// Older polls do not have a start date, so they remain available immediately.
const hasPollNotStarted = (startDate: string | null) => {
    if (!startDate) return false;
    const startTime = new Date(startDate).getTime();
    return !Number.isNaN(startTime) && startTime > Date.now();
};

const isPollClosed = (p: PollSummary) =>
    p.status === "closed" || isExpired(p.deadline);

const AVATAR_PALETTE = ["#1F9F4E", "#2563EB", "#D97706", "#7C3AED", "#DB2777", "#0D9488"];
const avatarColorFor = (key: string) => {
    let hash = 0;
    for (let i = 0; i < key.length; i++) hash = (hash * 31 + key.charCodeAt(i)) >>> 0;
    return AVATAR_PALETTE[hash % AVATAR_PALETTE.length];
};

// Same derivation used in PollLeaderboardScreen for myVoterId — kept
// identical so a lookup here and a lookup there always hit the same
// VALIDATED_VOTERS_DB doc.
const sanitizeVoterCode = (raw: string) => raw.trim().toLowerCase();

const PAGE_SIZE = 20;
const POLLS_CACHE_KEY = "@evoting_polls_cache_v1";

// ─── Cache + mapping helpers ────────────────────────────────────────────────

async function readPollsCache(): Promise<PollSummary[] | null> {
    try {
        const raw = await AsyncStorage.getItem(POLLS_CACHE_KEY);
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? (parsed as PollSummary[]) : null;
    } catch (err) {
        console.error("readPollsCache:", err);
        return null;
    }
}

async function writePollsCache(polls: PollSummary[]) {
    try {
        await AsyncStorage.setItem(POLLS_CACHE_KEY, JSON.stringify(polls.slice(0, 300)));
    } catch (err) {
        console.error("writePollsCache:", err);
    }
}

function mapDocToPoll(pd: any): PollSummary {
    const d = pd.data();
    return {
        pollId: d.pollId ?? pd.id,
        docPath: pd.ref.path,
        title: d.title ?? "Untitled Poll",
        pollType: d.pollType ?? "single",
        status: d.status ?? "active",
        startDate: d.startDate ?? null,
        deadline: d.deadline ?? null,
        creatorEmail: d.creatorEmail ?? "unknown",
        creatorName: d.creatorName ?? "Unknown",
        logoUrl: d.logoUrl,
        aspirantCount: d.aspirantCount ?? 0,
        dateCreated: d.dateCreated ?? "",
        createdAt: d.createdAt?.toMillis?.() ?? 0,
        showResults: d.showResults ?? true,
        isAnonymous: d.isAnonymous ?? false,
        requires_voters_validation: d.requires_voters_validation ?? "false",
        face_verification: d.face_verification ?? "false",
        poll_verification_status: d.poll_verification_status ?? "not_verified",
    };
}

// Deletes all docs in a collection matching pollId, in batches of ≤450
// (Firestore batch limit is 500 ops; 450 leaves headroom).
async function deleteWhereField(
    collectionName: string,
    field: string,
    pollId: string
): Promise<number> {
    let totalDeleted = 0;
    // Loop because a single query can return more docs than one batch can hold.
    while (true) {
        const snap = await getDocs(
            query(collection(db, collectionName), where(field, "==", pollId), limit(450))
        );
        if (snap.empty) break;

        const batch = writeBatch(db);
        snap.docs.forEach((d) => batch.delete(d.ref));
        await batch.commit();

        totalDeleted += snap.docs.length;
        if (snap.docs.length < 450) break; // last page
    }
    return totalDeleted;
}

const byVerifiedThenRecency = (a: PollSummary, b: PollSummary) => {
    const aVerified = a.poll_verification_status === "verified" ? 0 : 1;
    const bVerified = b.poll_verification_status === "verified" ? 0 : 1;
    if (aVerified !== bVerified) return aVerified - bVerified;
    return b.createdAt - a.createdAt;
};

function mergePolls(existing: PollSummary[], incoming: PollSummary[]): PollSummary[] {
    const byPath = new Map(existing.map((p) => [p.docPath, p]));
    for (const p of incoming) byPath.set(p.docPath, p);
    return Array.from(byPath.values()).sort(byVerifiedThenRecency);
}

function groupPolls(polls: PollSummary[]): CreatorGroup[] {
    const byCreator = new Map<string, PollSummary[]>();
    const names = new Map<string, string>();
    for (const p of polls) {
        if (!byCreator.has(p.creatorEmail)) byCreator.set(p.creatorEmail, []);
        byCreator.get(p.creatorEmail)!.push(p);
        names.set(p.creatorEmail, p.creatorName);
    }
    const groups: CreatorGroup[] = Array.from(byCreator.entries()).map(([creatorEmail, list]) => ({
        creatorEmail,
        creatorName: names.get(creatorEmail) ?? "Unknown",
        polls: list.sort(byVerifiedThenRecency),
    }));
    groups.sort((a, b) => byVerifiedThenRecency(a.polls[0], b.polls[0]));
    return groups;
}

// ─── Data hook: cache-first load, background sync, realtime tail listener ──

function usePollsData() {
    const [polls, setPolls] = useState<PollSummary[]>([]);
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const [loadingMore, setLoadingMore] = useState(false);
    const [hasMore, setHasMore] = useState(true);

    const lastDocRef = useRef<any>(null);
    const newestKnownRef = useRef<number>(0);
    const unsubscribeRef = useRef<() => void>();

    const applyIncoming = useCallback((incoming: PollSummary[], persist = true) => {
        setPolls((prev) => {
            const next = mergePolls(prev, incoming);
            if (next.length) {
                newestKnownRef.current = Math.max(newestKnownRef.current, next[0].createdAt);
            }
            if (persist) writePollsCache(next);
            return next;
        });
    }, []);

    const attachRealtimeListener = useCallback(() => {
        unsubscribeRef.current?.();
        const cursorMillis = newestKnownRef.current;
        const q = cursorMillis > 0
            ? query(
                collection(db, "POLL_TITLE_DB"),
                orderBy("createdAt", "desc"),
                where("createdAt", ">", Timestamp.fromMillis(cursorMillis)),
                limit(PAGE_SIZE)
            )
            : query(collection(db, "POLL_TITLE_DB"), orderBy("createdAt", "desc"), limit(PAGE_SIZE));

        unsubscribeRef.current = onSnapshot(
            q,
            (snap) => {
                const added = snap
                    .docChanges()
                    .filter((c) => c.type === "added")
                    .map((c) => mapDocToPoll(c.doc));
                if (added.length) {
                    applyIncoming(added);
                    attachRealtimeListener(); // advance the cursor window
                }
            },
            (err) => console.error("polls realtime listener:", err)
        );
    }, [applyIncoming]);

    const bootstrap = useCallback(async () => {
        const cached = await readPollsCache();
        if (cached && cached.length > 0) {
            setPolls(cached);
            newestKnownRef.current = cached[0]?.createdAt ?? 0;
            setLoading(false);
            setHasMore(cached.length >= PAGE_SIZE);
        }

        try {
            if (!cached || cached.length < PAGE_SIZE) {
                const snap = await getDocs(
                    query(collection(db, "POLL_TITLE_DB"), orderBy("createdAt", "desc"), limit(PAGE_SIZE))
                );
                applyIncoming(snap.docs.map(mapDocToPoll));
                lastDocRef.current = snap.docs[snap.docs.length - 1] ?? null;
                setHasMore(snap.docs.length === PAGE_SIZE);
            } else {
                const snap = await getDocs(
                    query(
                        collection(db, "POLL_TITLE_DB"),
                        orderBy("createdAt", "desc"),
                        where("createdAt", ">", Timestamp.fromMillis(newestKnownRef.current)),
                        limit(PAGE_SIZE)
                    )
                );
                if (snap.docs.length > 0) applyIncoming(snap.docs.map(mapDocToPoll));
            }
        } catch (err) {
            console.error("bootstrap polls fetch:", err);
        } finally {
            setLoading(false);
            attachRealtimeListener();
        }
    }, [applyIncoming, attachRealtimeListener]);

    const loadMorePolls = useCallback(async () => {
        if (!hasMore || loadingMore) return;
        setLoadingMore(true);
        try {
            let q;
            if (lastDocRef.current) {
                q = query(
                    collection(db, "POLL_TITLE_DB"),
                    orderBy("createdAt", "desc"),
                    startAfter(lastDocRef.current),
                    limit(PAGE_SIZE)
                );
            } else {
                const oldestKnown = polls.length ? polls[polls.length - 1].createdAt : Date.now();
                q = query(
                    collection(db, "POLL_TITLE_DB"),
                    orderBy("createdAt", "desc"),
                    startAfter(Timestamp.fromMillis(oldestKnown)),
                    limit(PAGE_SIZE)
                );
            }
            const snap = await getDocs(q);
            if (snap.docs.length > 0) {
                applyIncoming(snap.docs.map(mapDocToPoll));
                lastDocRef.current = snap.docs[snap.docs.length - 1];
            }
            setHasMore(snap.docs.length === PAGE_SIZE);
        } catch (err) {
            console.error("loadMorePolls:", err);
        } finally {
            setLoadingMore(false);
        }
    }, [hasMore, loadingMore, polls, applyIncoming]);

    const onRefresh = useCallback(async () => {
        setRefreshing(true);
        try {
            const snap = await getDocs(
                query(collection(db, "POLL_TITLE_DB"), orderBy("createdAt", "desc"), limit(PAGE_SIZE))
            );
            const fresh = snap.docs.map(mapDocToPoll);
            setPolls(fresh);
            newestKnownRef.current = fresh[0]?.createdAt ?? 0;
            lastDocRef.current = snap.docs[snap.docs.length - 1] ?? null;
            setHasMore(snap.docs.length === PAGE_SIZE);
            await writePollsCache(fresh);
            attachRealtimeListener();
        } catch (err) {
            console.error("onRefresh:", err);
        } finally {
            setRefreshing(false);
        }
    }, [attachRealtimeListener]);

    const updatePollLocal = useCallback((docPath: string, patch: Partial<PollSummary>) => {
        setPolls((prev) => {
            const next = prev.map((p) => (p.docPath === docPath ? { ...p, ...patch } : p));
            writePollsCache(next);
            return next;
        });
    }, []);

    const removePollLocal = useCallback((docPath: string) => {
        setPolls((prev) => {
            const next = prev.filter((p) => p.docPath !== docPath);
            writePollsCache(next);
            return next;
        });
    }, []);

    useEffect(() => {
        bootstrap();
        return () => unsubscribeRef.current?.();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const groups = useMemo(() => groupPolls(polls), [polls]);

    return { groups, loading, refreshing, loadingMore, hasMore, onRefresh, loadMorePolls, removePollLocal, updatePollLocal };
}

// ─── Main Screen ──────────────────────────────────────────────────────────────

export default function PollsListScreen() {

    const [showLoader, setShowLoader] = useState(true);

    useEffect(() => {
        const t = setTimeout(() => setShowLoader(false), 500);
        return () => clearTimeout(t);
    }, []);

    const { rawUserEmail, userId, userName } = useContext(GlobalContext);
    const voterEmail = userId || rawUserEmail || "unknown";

    const myVoterIdRaw = sanitizeVoterCode(String(rawUserEmail || ""));
    const myVoterId = userName ? (myVoterIdRaw.match(/^[^@]+/)?.[0] ?? "") : "";

    const {
        groups, loading, refreshing, loadingMore, hasMore,
        onRefresh, loadMorePolls, removePollLocal, updatePollLocal,
    } = usePollsData();

    const [filtered, setFiltered] = useState<CreatorGroup[]>([]);
    const [search, setSearch] = useState("");
    const [searchActive, setSearchActive] = useState(false);
    const [filter, setFilter] = useState<"all" | "active" | "closed">("all");
    const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
    const icons: any = ["person-outline", "sync-outline", "close-circle-outline"];
    const [deletingIds, setDeletingIds] = useState<Set<string>>(new Set());
    const [confirmTarget, setConfirmTarget] = useState<{ docPath: string; title: string; pollId: string } | null>(null);
    const [startNoticeTarget, setStartNoticeTarget] = useState<PollSummary | null>(null);

    // Single guard used by BOTH the icon-toggle button and the Switch, since
    // they write to the exact same field on the exact same poll — keeping
    // them on one guard/one updater means they can never show conflicting
    // on/off states after a write.
    const [facialTogglingPaths, setFacialTogglingPaths] = useState<Set<string>>(new Set());

    const [checkingFaceGate, setCheckingFaceGate] = useState<string | null>(null); // pollId currently being checked

    // Generic single-button notice modal — cross-platform replacement for
    // Alert.alert (Alert.alert doesn't render reliably on web).
    const [notice, setNotice] = useState<{ title: string; message: string } | null>(null);

    // ── Filter / search ───────────────────────────────────────────────────────

    const applyFilters = (
        source: CreatorGroup[],
        q: string,
        f: "all" | "active" | "closed"
    ) => {
        const term = q.toLowerCase().trim();
        const result: CreatorGroup[] = [];
        for (const group of source) {
            const polls = group.polls.filter((p) => {
                const matchSearch =
                    !term ||
                    p.title.toLowerCase().includes(term) ||
                    group.creatorName.toLowerCase().includes(term);
                const matchFilter =
                    f === "all" ||
                    (f === "active" && !isPollClosed(p)) ||
                    (f === "closed" && isPollClosed(p));
                return matchSearch && matchFilter;
            });
            if (polls.length > 0) result.push({ ...group, polls });
        }
        setFiltered(result);
    };

    useEffect(() => {
        applyFilters(groups, search, filter);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [search, filter, groups]);

    // ── Validated-voter lookup — shared by the face-verification gate ────────

    const checkVoterValidated = async (
        pollId: string,
        voterId: string
    ): Promise<{ isValidated: boolean; voterPhoto: string }> => {
        const trimmed = voterId.trim();
        if (!pollId || !trimmed) return { isValidated: false, voterPhoto: "" };
        try {
            const code = sanitizeVoterCode(trimmed);
            const snap = await getDoc(doc(db, "VALIDATED_VOTERS_DB", pollId, "validatedVoterInfo", code));
            return {
                isValidated: snap.exists(),
                voterPhoto: snap.exists() && typeof snap.data()?.voterPhoto === "string"
                    ? snap.data().voterPhoto
                    : "",
            };
        } catch (err) {
            console.error("checkVoterValidated:", err);
            return { isValidated: false, voterPhoto: "" };
        }
    };

    // ── Open poll — gates on facial verification when the creator has it on ──

    const openPoll = async (poll: PollSummary) => {
        if (hasPollNotStarted(poll.startDate)) {
            setStartNoticeTarget(poll);
            return;
        }

        if (checkingFaceGate) return; // ignore taps while a check is already in flight

        // Facial verification only ever applies to VIP/validated polls — a poll
        // open to everyone has no VALIDATED_VOTERS_DB list to check a photo
        // against, so face_verification is only meaningful when
        // requires_voters_validation is also "true".
        const needsFaceGate =
            poll.requires_voters_validation === "true" &&
            poll.face_verification === "true" &&
            !!myVoterId;

        if (needsFaceGate) {
            setCheckingFaceGate(poll.pollId);
            try {
                const { isValidated, voterPhoto } = await checkVoterValidated(poll.pollId, myVoterId);

                if (isValidated) {
                    if (!voterPhoto) {
                        setNotice({
                            title: "Photo required",
                            message: "This poll requires facial verification, but your validated voter profile has no photo. Ask the poll creator to add one.",
                        });
                        return;
                    }
                    router.navigate({
                        pathname: "./facial_verfication_screen",
                        params: {
                            pollId: poll.pollId,
                            voterId: myVoterId,
                            creatorEmail: poll.creatorEmail,
                        },
                    });
                    return;
                }
                // Not a validated voter → falls through to the leaderboard;
                // requires_voters_validation ("members only") is enforced there.
            } finally {
                setCheckingFaceGate(null);
            }
        }

        router.navigate({
            pathname: "./poll_leaderboard",
            params: { pollId: poll.pollId, creatorEmail: poll.creatorEmail },
        });
    };

    const openVoteAnalysesScreen = (poll: PollSummary) => {
        router.navigate({
            pathname: "./VoteAnalysesScreen",
            params: { pollId: poll.pollId },
        });
    };

    const openValidatedVotersScreen = (poll: PollSummary) => {
        router.navigate({
            pathname: "./validated_voters_screen",
            params: { pollId: poll.pollId, creatorEmail: poll.creatorEmail },
        });
    };

    const openSearch = () => {
        if (Platform.OS !== "web") {
            LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
        }
        setSearchActive(true);
    };

    const closeSearch = () => {
        if (Platform.OS !== "web") {
            LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
        }
        setSearch("");
        setSearchActive(false);
    };

    const totalPolls = filtered.reduce((s, g) => s + g.polls.length, 0);
    const livePolls = filtered.reduce(
        (s, g) => s + g.polls.filter((p) => !isPollClosed(p)).length, 0
    );

    const truncateMiddle = useCallback(
        (value?: string, start = 12, end = 12): string | undefined => {
            if (!value || value.length <= start + end) return value;
            return `${value.slice(0, start)}...${value.slice(-end)}`;
        },
        []
    );

    const formatDeadline = (deadline: string | null) => {
        if (!deadline) return null;
        return new Date(deadline).toLocaleDateString("en-GB");
    };

    // --- DELETE POLL ---
    const deletePoll = useCallback((docPath: string, pollTitle: string, pollId: string) => {
        setConfirmTarget({ docPath, title: pollTitle, pollId });
    }, []);

    const confirmDeletePoll = useCallback(async () => {
        if (!confirmTarget) return;
        const { docPath, pollId } = confirmTarget;

        setConfirmTarget(null);
        setDeletingIds((prev) => new Set(prev).add(docPath));

        try {
            // Cascade: wipe associated records first, then the poll doc itself.
            // Swap "COMMENTS_DB" for your real comments collection name if different.
            await Promise.all([
                deleteWhereField("ASPIRANTS_DETAILS_DB", "pollId", pollId),
                deleteWhereField("VOTERS_DB", "pollId", pollId),
                deleteWhereField("COMMENTS_DB", "pollId", pollId),
            ]);
            await deleteDoc(doc(db, docPath));
            removePollLocal(docPath);
        } catch (err) {
            console.error("deletePoll cascade:", err);
        } finally {
            setDeletingIds((prev) => {
                const next = new Set(prev);
                next.delete(docPath);
                return next;
            });
        }
    }, [confirmTarget, removePollLocal]);

    // ── Facial verification toggle — single source of truth for BOTH the
    // icon button on the card and the Switch in the expanded row. Both call
    // this with the poll + the desired next boolean, so there's exactly one
    // write path and one optimistic-local-update path.
    const setFaceVerification = useCallback(
        async (poll: PollSummary, enabled: boolean) => {
            if (voterEmail !== poll.creatorEmail) return;
            if (facialTogglingPaths.has(poll.docPath)) return;

            const nextValue: "true" | "false" = enabled ? "true" : "false";

            setFacialTogglingPaths((prev) => new Set(prev).add(poll.docPath));
            try {
                await updateDoc(doc(db, "POLL_TITLE_DB", poll.pollId), {
                    face_verification: nextValue,
                });
                // Optimistic local update — the realtime listener only reacts to
                // "added" doc changes, not "modified", so without this the UI
                // would keep showing the stale value until the next full refresh.
                updatePollLocal(poll.docPath, { face_verification: nextValue });
            } catch (err) {
                console.error("setFaceVerification:", err);
                setNotice({
                    title: "Could not update facial recognition",
                    message: "Please try again.",
                });
            } finally {
                setFacialTogglingPaths((prev) => {
                    const next = new Set(prev);
                    next.delete(poll.docPath);
                    return next;
                });
            }
        },
        [facialTogglingPaths, voterEmail, updatePollLocal]
    );

    // ── Loading ───────────────────────────────────────────────────────────────

    if (showLoader) {
        return (
            <ReusableScreen>
                <View style={styles.loaderContainer}>
                    <ActivityIndicator size="large" color="#1f9b11ff" />
                </View>
            </ReusableScreen>
        );
    }

    // ── Render ────────────────────────────────────────────────────────────────

    return (
        <ReusableScreen>
            {/* Poll-not-yet-open notice */}
            <Modal
                visible={!!startNoticeTarget}
                transparent
                animationType="fade"
                onRequestClose={() => setStartNoticeTarget(null)}
            >
                <View style={styles.modalOverlay}>
                    <View style={styles.scheduleModalCard}>
                        <View style={styles.scheduleModalIconWrap}>
                            <Ionicons name="time-outline" size={26} color="#D97706" />
                        </View>
                        <Text style={styles.modalTitle}>Poll not open yet</Text>
                        <Text style={styles.modalDesc}>
                            Sorry, this poll would open on{" "}
                            <Text style={styles.scheduleModalDate}>
                                {startNoticeTarget?.startDate
                                    ? new Date(startNoticeTarget.startDate).toLocaleString()
                                    : "the scheduled date"}
                            </Text>.
                        </Text>
                        <TouchableOpacity
                            style={styles.scheduleModalButton}
                            onPress={() => setStartNoticeTarget(null)}
                            activeOpacity={0.8}
                        >
                            <Text style={styles.scheduleModalButtonText}>Okay</Text>
                        </TouchableOpacity>
                    </View>
                </View>
            </Modal>

            {/* Delete-poll confirmation */}
            <Modal
                visible={!!confirmTarget}
                transparent
                animationType="fade"
                onRequestClose={() => setConfirmTarget(null)}
            >
                <View style={styles.modalOverlay}>
                    <View style={styles.modalCard}>
                        <View style={styles.modalIconWrap}>
                            <Ionicons name="trash" size={24} color="#EF4444" />
                            <View>
                                <Text style={styles.modalTitle}>Delete Poll</Text>
                            </View>
                        </View>

                        <View><Text style={styles.modalDesc}>
                            Are you sure you want to delete{" "}
                            <Text style={{ fontWeight: "700" }}>"{confirmTarget?.title}"</Text>?
                            This cannot be undone.
                        </Text></View>

                        <View style={styles.modalActions}>
                            <TouchableOpacity
                                style={styles.modalCancelBtn}
                                onPress={() => setConfirmTarget(null)}
                            >
                                <View><Text style={styles.modalCancelText}>Cancel</Text></View>
                            </TouchableOpacity>
                            <TouchableOpacity
                                style={styles.modalDeleteBtn}
                                onPress={confirmDeletePoll}
                            >
                                <View><Text style={styles.modalDeleteText}>Delete</Text></View>
                            </TouchableOpacity>
                        </View>
                    </View>
                </View>
            </Modal>

            {/* Generic single-button notice — cross-platform Alert.alert replacement */}
            <Modal
                visible={!!notice}
                transparent
                animationType="fade"
                onRequestClose={() => setNotice(null)}
            >
                <View style={styles.modalOverlay}>
                    <View style={styles.scheduleModalCard}>
                        <View style={styles.scheduleModalIconWrap}>
                            <Ionicons name="alert-circle-outline" size={26} color="#D97706" />
                        </View>
                        <Text style={styles.modalTitle}>{notice?.title}</Text>
                        <Text style={styles.modalDesc}>{notice?.message}</Text>
                        <TouchableOpacity
                            style={styles.scheduleModalButton}
                            onPress={() => setNotice(null)}
                            activeOpacity={0.8}
                        >
                            <Text style={styles.scheduleModalButtonText}>Okay</Text>
                        </TouchableOpacity>
                    </View>
                </View>
            </Modal>

            <View style={styles.header}>
                {!searchActive ? (
                    <>
                        <View style={styles.headerLeftGroup}>
                            <TouchableOpacity onPress={() => router.navigate("./members_list")} style={styles.backBtn}
                                hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
                                <Ionicons name="arrow-back" size={20} color="#666" />
                            </TouchableOpacity>
                            <TouchableOpacity
                                onPress={openSearch}
                                style={styles.searchIconBtn}
                                hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                            >
                                <Ionicons name="search-outline" size={19} color="#374151" />
                            </TouchableOpacity>
                        </View>

                        <View><Text style={[styles.headerTitle, styles.headerTitleCentered]} numberOfLines={1}>
                            All Polls
                        </Text></View>
                        <View style={{ flexDirection: "row", gap: 2 }}>
                            <View style={styles.liveBadge}>
                                <View style={styles.liveBadgeDot} />
                                <Text style={styles.liveBadgeText}>{livePolls} Live</Text>
                            </View>

                            <View style={styles.headerCountPill}>
                                <Text style={styles.headerCountText}>{totalPolls}</Text>
                            </View>
                        </View>
                    </>
                ) : (
                    <View style={styles.headerSearchExpanded}>
                        <Ionicons name="search-outline" size={20} color="#000" />
                        <TextInput
                            autoFocus
                            style={styles.searchInput}
                            placeholder="Search polls or creators..."
                            placeholderTextColor="#73767dff"
                            value={search}
                            onChangeText={setSearch}
                            returnKeyType="search"
                            clearButtonMode="while-editing"
                            {...(Platform.OS === "web" && { outlineStyle: "none" } as any)}
                        />
                        {search.length > 0 && Platform.OS !== "ios" && (
                            <TouchableOpacity
                                onPress={() => setSearch("")}
                                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                            >
                                <Ionicons name="close-circle" size={18} color="#9CA3AF" />
                            </TouchableOpacity>
                        )}
                        <TouchableOpacity
                            onPress={closeSearch}
                            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                            style={styles.cancelBtn}
                        ><Text style={styles.cancelText}>Cancel</Text></TouchableOpacity>
                    </View>
                )}
            </View>

            {/* List */}
            <ScrollView
                style={styles.scroll}
                contentContainerStyle={[
                    styles.scrollContent,
                    filtered.length === 0 && styles.scrollEmpty,
                ]}
                showsVerticalScrollIndicator={false}
                keyboardShouldPersistTaps="handled"
                refreshControl={
                    <RefreshControl
                        refreshing={refreshing}
                        onRefresh={onRefresh}
                        tintColor="#1F9F4E"
                        colors={["#1F9F4E"]}
                    />
                }
            >
                {filtered.length === 0 ? (
                    <View style={styles.emptyWrap}>
                        <View style={styles.emptyIconWrap}>
                            <MaterialIcons name="how-to-vote" size={40} color="#9CA3AF" />
                        </View>
                        <Text style={styles.emptyTitle}>No polls found</Text>
                        <Text style={styles.emptyDesc}>
                            {search
                                ? "Try a different search term or filter."
                                : "No polls have been created yet."}
                        </Text>
                    </View>
                ) : (
                    <>
                        {filtered.map((group) => {
                            const isCollapsed = collapsed.has(group.creatorEmail);
                            const liveInGroup = group.polls.filter((p) => !isPollClosed(p)).length;
                            const avatarColor = avatarColorFor(group.creatorEmail);

                            return (
                                <View key={group.creatorEmail} style={styles.groupCard}>
                                    <TouchableOpacity
                                        style={styles.creatorHeader}
                                        activeOpacity={0.7}
                                    >
                                        <View style={styles.creatorInfo}>
                                            <View style={{ flexDirection: "row", alignItems: "center" }}>
                                                <View>
                                                    <Text style={[styles.creatorName, { textTransform: "capitalize" }]} numberOfLines={1}>
                                                        {group.creatorName}
                                                    </Text>
                                                </View>
                                                <View>
                                                    <Text>: POLL</Text>
                                                </View>
                                            </View>

                                            <View>
                                                <Text style={styles.creatorEmail} numberOfLines={1}>
                                                    {truncateMiddle(group.creatorEmail, 15, 10)}
                                                </Text>
                                            </View>
                                        </View>

                                        <View style={styles.creatorRight}>
                                            {liveInGroup > 0 && <View style={styles.miniLiveDot} />}
                                            <Text style={styles.creatorPollCount}>
                                                {group.polls.length}{group.polls.length > 1 ? " Polls" : " Poll"}
                                            </Text>
                                            <Ionicons
                                                name={isCollapsed ? "chevron-down" : "chevron-up"}
                                                size={18}
                                                color="#9CA3AF"
                                            />
                                        </View>
                                    </TouchableOpacity>

                                    {!isCollapsed && (
                                        <View style={styles.pollsWrap}>
                                            {group.polls.map((poll) => {
                                                const closed = isPollClosed(poll);
                                                const expired = isExpired(poll.deadline);
                                                const requiresVoterValidation = poll.requires_voters_validation === "true";
                                                const verified = poll.poll_verification_status === "verified";
                                                const isFaceToggling = facialTogglingPaths.has(poll.docPath);
                                                const isCheckingGate = checkingFaceGate === poll.pollId;

                                                return (
                                                    <TouchableOpacity
                                                        key={poll.pollId}
                                                        style={styles.pollCard}
                                                        onPress={() => openPoll(poll)}
                                                        activeOpacity={0.6}
                                                        disabled={isCheckingGate}
                                                    >
                                                        <View style={styles.pollTopSection}>
                                                            <View style={styles.pollLogoWrapper}>
                                                                <Ionicons style={styles.avatarPlaceholder} name="stats-chart" size={20} color="#9CA3AF" />
                                                                {poll.logoUrl ? (<Image
                                                                    source={{ uri: poll.logoUrl }}
                                                                    style={styles.pollLogoInner}
                                                                    resizeMode="cover"
                                                                />) : (null)}
                                                            </View>

                                                            <View style={styles.pollDetailsBody}>

                                                                <View style={styles.pollHeader}>
                                                                    <Text style={styles.pollTitle} numberOfLines={3}>
                                                                        {poll.title}
                                                                    </Text>

                                                                    {isCheckingGate && (
                                                                        <ActivityIndicator size="small" color="#1F9F4E" style={{ marginHorizontal: 4 }} />
                                                                    )}

                                                                    <View style={[
                                                                        styles.statusBadge,
                                                                        closed ? styles.badgeClosed : styles.badgeActive, { backgroundColor: expired ? "#FEE2EE" : closed ? "#F3F4F6" : "#D1FAE5" }
                                                                    ]}>
                                                                        <Text style={[
                                                                            styles.badgeText,
                                                                            closed ? styles.badgeTextClosed : styles.badgeTextActive, { color: expired ? "#EF4444" : "#1F9F4E" }
                                                                        ]}>
                                                                            {closed ? (expired ? "Expired" : "Closed") : "Live"}
                                                                        </Text>
                                                                    </View>
                                                                </View>
                                                                <View style={{ flexDirection: "row" }}>
                                                                    <View style={styles.pollMetaRow}>
                                                                        {poll.deadline ? (
                                                                            <Text style={styles.metaText}>
                                                                                {poll.deadline ? `Ex: ${formatDeadline(poll.deadline)}` : "No deadline"}
                                                                            </Text>
                                                                        ) : null}

                                                                        <View style={styles.metaIconGroup}>
                                                                            <Ionicons name="people" size={14} color="#6B7280" />
                                                                            <Text style={styles.metaText}>
                                                                                {poll.aspirantCount} Aspirant{poll.aspirantCount !== 1 ? "s" : ""}
                                                                            </Text>
                                                                        </View>
                                                                    </View>
                                                                </View>
                                                                <View style={{ flexDirection: "row" }}>
                                                                    {poll.pollType === "multiple" ? (
                                                                        <View style={styles.metaIconGroup}>
                                                                            <Ionicons name="layers" size={14} color="#6B7280" />
                                                                            <Text style={styles.metaText}>Multi</Text>
                                                                        </View>
                                                                    ) : (
                                                                        <View style={styles.metaIconGroup}>
                                                                            <Ionicons name="trail-sign-outline" size={14} color="#6B7280" />
                                                                            <Text style={styles.metaText}>Single</Text>
                                                                        </View>
                                                                    )}

                                                                    <View style={{ zIndex: 1, flexDirection: "row", alignItems: "center", gap: 4, marginLeft: 8, }}>
                                                                        <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>



                                                                            <View style={{ alignItems: "center", flexDirection: "row", }}>
                                                                                {voterEmail === poll.creatorEmail && (<TouchableOpacity
                                                                                    onPress={() => setFaceVerification(poll, poll.face_verification !== "true")}
                                                                                    style={{ borderBottomWidth: 1, borderColor: "#ddd" }}
                                                                                    disabled={isFaceToggling}
                                                                                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8, }}
                                                                                >
                                                                                    {isFaceToggling ? (
                                                                                        <ActivityIndicator size="small" color="#9a9898ff" />
                                                                                    ) : (
                                                                                        <View style={{ flexDirection: "row", gap: 9, alignItems: "center" }}>

                                                                                            <Ionicons
                                                                                                name={poll.face_verification === "true" ? "toggle" : "toggle-outline"}
                                                                                                size={23}
                                                                                                color={poll.face_verification === "true" ? "#1F9F4E" : "#b6bcc7ff"}
                                                                                            />
                                                                                            <View><Text>Add facial</Text></View>

                                                                                        </View>
                                                                                    )}
                                                                                </TouchableOpacity>)}


                                                                            </View>




                                                                        </View>
                                                                    </View>

                                                                </View>
                                                                <View style={{ flexDirection: "row", alignItems: "center", marginRight: 5, }}>
                                                                    <TouchableOpacity
                                                                        onPress={() => openValidatedVotersScreen(poll)}
                                                                    >
                                                                        <View style={{ flexDirection: "row", gap: 3, alignItems: "center", paddingVertical: 3, borderBottomWidth: 1, borderColor: "#ddd", width: 100 }}>
                                                                            <Ionicons name="people" size={18} color="#40980dff" /><View><Text>View-voters</Text></View>

                                                                        </View>
                                                                    </TouchableOpacity>

                                                                    {voterEmail === poll.creatorEmail && <TouchableOpacity
                                                                        onPress={() => deletePoll(poll.docPath, poll.title, poll.pollId)} disabled={deletingIds.has(poll.docPath)}
                                                                        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                                                                    >
                                                                        {deletingIds.has(poll.docPath) ? (
                                                                            <ActivityIndicator size="small" color="#9a9898ff" />
                                                                        ) : (
                                                                            <View style={{ flexDirection: "row", alignItems: "center", gap: 6, paddingVertical: 3, borderBottomWidth: 1, borderColor: "#ddd", width: 100 }}>
                                                                                <Ionicons
                                                                                    style={{ position: "relative", left: 3 }}
                                                                                    name="trash"
                                                                                    size={16}
                                                                                    color="#9a9898ff"
                                                                                /> <View><Text>Delete poll</Text></View></View>

                                                                        )}
                                                                    </TouchableOpacity>}
                                                                </View>
                                                            </View>

                                                        </View>

                                                        <View style={styles.pollFooter}>
                                                            <View style={styles.badgeGroup}>
                                                                {requiresVoterValidation ? (
                                                                    <View style={styles.tagVIP}>
                                                                        <Ionicons name="shield-checkmark" size={12} color="#D97706" />
                                                                        <Text style={styles.tagTextVIP}>VIP Only</Text>
                                                                    </View>
                                                                ) : (
                                                                    <View style={styles.tagStandard}>
                                                                        <Ionicons name="globe-outline" size={12} color="#4B5563" />
                                                                        <Text style={styles.tagTextStandard}>Open to all</Text>
                                                                    </View>
                                                                )}

                                                                {verified ? (
                                                                    <View style={styles.tagVerified}>
                                                                        <Ionicons name="checkmark-circle" size={12} color="#1F9F4E" />
                                                                        <Text style={styles.tagTextVerified}>Verified Poll</Text>
                                                                    </View>
                                                                ) : (
                                                                    <View style={styles.tagUnverified}>
                                                                        <Ionicons name="alert-circle" size={12} color="#EF4444" />
                                                                        <Text style={styles.tagTextUnverified}>Unverified Poll</Text>
                                                                    </View>
                                                                )}
                                                            </View>

                                                            <View style={{ zIndex: 1, flexDirection: "row", alignItems: "center", gap: 2 }}>

                                                                <TouchableOpacity onPress={() => openVoteAnalysesScreen(poll)} style={{ flexDirection: "row", gap: 3 }}>
                                                                    <Ionicons name="eye" size={16} color="blue" />
                                                                    <View><Text style={{ color: "blue", fontSize: 14, }}>Analytics</Text></View>
                                                                </TouchableOpacity>
                                                            </View>
                                                        </View>
                                                        {voterEmail === poll.creatorEmail && requiresVoterValidation && (
                                                            <View style={styles.faceVerificationRow}>
                                                                <View style={styles.faceVerificationLabel}>
                                                                    <Ionicons name="scan-outline" size={15} color="#6B7280" />
                                                                    <Text style={styles.faceVerificationText}>Facial recognition</Text>
                                                                </View>
                                                                {isFaceToggling ? (
                                                                    <ActivityIndicator size="small" color="#1F9F4E" />
                                                                ) : (
                                                                    <Switch
                                                                        value={poll.face_verification === "true"}
                                                                        onValueChange={(enabled) => setFaceVerification(poll, enabled)}
                                                                        trackColor={{ false: "#D1D5DB", true: "#A2E0B8" }}
                                                                        thumbColor={poll.face_verification === "true" ? "#1F9F4E" : "#FFFFFF"}
                                                                    />
                                                                )}
                                                            </View>
                                                        )}
                                                    </TouchableOpacity>
                                                );
                                            })}
                                        </View>
                                    )}
                                </View>
                            );
                        })}

                        {hasMore && (
                            <TouchableOpacity
                                style={styles.loadMoreBtn}
                                onPress={loadMorePolls}
                                disabled={loadingMore}
                            >
                                {loadingMore ? (
                                    <ActivityIndicator size="small" color="#1F9F4E" />
                                ) : (
                                    <Text style={styles.loadMoreText}>Load more polls</Text>
                                )}
                            </TouchableOpacity>
                        )}
                    </>
                )}
            </ScrollView>
            <View style={styles.bottomNav}>
                {["all", "active", "closed"].map((f: any, index) => {
                    return (<TouchableOpacity
                        key={f}
                        style={[styles.navItem, { backgroundColor: filter === f ? "#f0f0f0ff" : "#f9fafbff" }]}
                        onPress={() => setFilter(f)}
                    >
                        <Ionicons name={icons[index]} size={20} color={"#555"} />
                        <Text style={[styles.navText, { color: "#555" }]}>
                            {f.charAt(0).toUpperCase() + f.slice(1)}
                        </Text>
                    </TouchableOpacity>)
                })}

                <TouchableOpacity
                    style={styles.navItem}
                    onPress={() => router.replace("./create_poll_screen")}
                >
                    <Ionicons
                        name="create-outline"
                        size={20}
                    />
                    <Text style={[styles.navText]}>
                        Create Poll
                    </Text>
                </TouchableOpacity>
            </View>
        </ReusableScreen>
    );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
    centered: { flex: 1, alignItems: "center", justifyContent: "center", gap: 16, backgroundColor: '#F9FAFB' },
    loadingText: { fontSize: 14, color: "#6B7280", fontWeight: "500" },

    header: {
        flexDirection: "row", alignItems: "center", justifyContent: "space-between",
        backgroundColor: "#FFFFFF", paddingHorizontal: 16, paddingTop: Platform.OS === "ios" ? 16 : 12,
        paddingBottom: 12,
    },
    headerLeftGroup: {
        flexDirection: "row", alignItems: "center", gap: 8,
    },
    searchIconBtn: {
        width: 36, height: 36, borderRadius: 18,
        backgroundColor: "#F3F4F6", alignItems: "center", justifyContent: "center",
    },
    backBtn: {
        width: 36, height: 36, borderRadius: 18,
        backgroundColor: "#e4e4e7ff", alignItems: "center", justifyContent: "center",
    },
    headerTitle: { fontSize: 18, fontWeight: "700", color: "#111827", letterSpacing: -0.3 },
    headerTitleCentered: { flex: 1, textAlign: "center", marginHorizontal: 8 },
    headerCountPill: {
        minWidth: 32, height: 28, paddingHorizontal: 10, borderRadius: 14,
        backgroundColor: "#F3F4F6", alignItems: "center", justifyContent: "center",
    },
    headerCountText: { fontSize: 13, fontWeight: "700", color: "#4B5563" },

    headerSearchExpanded: {
        flex: 1,
        flexDirection: "row", alignItems: "center", gap: 8,
        backgroundColor: "#eaeaf6ff", borderRadius: 20,
        paddingHorizontal: 14, paddingVertical: Platform.OS === "ios" ? 10 : 8,
    },
    cancelBtn: { paddingLeft: 4 },
    cancelText: { fontSize: 14, fontWeight: "600", color: "#d91f1fff" },

    searchInput: {
        flex: 1, fontSize: 15, color: "#111827",
        ...(Platform.OS === "web" && { outlineStyle: "none" } as any),
    },

    filterSection: {
        backgroundColor: "#FFFFFF",
        paddingBottom: 12,
        borderBottomWidth: 2,
        borderBottomColor: "#d2ddd0ff",
        borderTopWidth: 2,
        borderTopColor: "#ecf5eaff",
    },
    filterRow: {
        flexDirection: "row", alignItems: "center", justifyContent: "space-between",
        paddingHorizontal: 16, paddingTop: 8,
    },
    filterPillGroup: { flexDirection: "row", gap: 8 },
    filterTab: {
        paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20,
        backgroundColor: "#FFFFFF",
        borderWidth: 1, borderColor: "#E5E7EB",
    },
    filterTabActive: { backgroundColor: "#1F9F4E", borderColor: "#1F9F4E" },
    filterTabText: { fontSize: 13, fontWeight: "600", color: "#6B7280" },
    filterTabTextActive: { color: "#FFFFFF" },

    liveBadge: {
        flexDirection: "row", alignItems: "center", gap: 6,
        paddingHorizontal: 10, paddingVertical: 6, borderRadius: 20,
        backgroundColor: "#DEF7EC",
    },
    liveBadgeDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: "#046C4E" },
    liveBadgeText: { fontSize: 12, fontWeight: "700", color: "#046C4E" },

    scroll: { flex: 1, backgroundColor: "#e5ece3ff" },
    scrollContent: { paddingHorizontal: 10, paddingTop: 8, paddingBottom: 10, gap: 6 },
    scrollEmpty: { flex: 1 },

    emptyWrap: { flex: 1, alignItems: "center", justifyContent: "center", paddingTop: 80, gap: 16 },
    emptyIconWrap: {
        width: 80, height: 80, borderRadius: 40, backgroundColor: "#F3F4F6",
        alignItems: "center", justifyContent: "center",
    },
    emptyTitle: { fontSize: 18, fontWeight: "700", color: "#111827" },
    emptyDesc: { fontSize: 14, color: "#6B7280", textAlign: "center", paddingHorizontal: 40, lineHeight: 20 },

    groupCard: {
        backgroundColor: "#ffffff",
        borderRadius: 16,
        borderWidth: 2,
        borderColor: "#ccdcc8ff",
        overflow: "hidden",
        paddingBottom: 8,
    },
    creatorHeader: {
        flexDirection: "row", alignItems: "center", gap: 12,
        paddingHorizontal: 16, paddingTop: 8,
        backgroundColor: "#ffffff",
    },
    creatorAvatar: {
        width: 40, height: 40, borderRadius: 20,
        alignItems: "center", justifyContent: "center"
    },
    creatorAvatarText: { color: "#FFFFFF", fontWeight: "700", fontSize: 16 },
    creatorInfo: { flex: 1, justifyContent: "center" },
    creatorName: { fontSize: 15, fontWeight: "700", color: "#111827", marginBottom: 2 },
    creatorEmail: { fontSize: 13, color: "#6B7280" },

    creatorRight: { flexDirection: "row", alignItems: "center", gap: 10 },
    creatorPollCount: {
        fontSize: 13, fontWeight: "600", color: "#4B5563",
        backgroundColor: "#F3F4F6", paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12,
    },
    miniLiveDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: "#10B981" },

    pollsWrap: {
        paddingHorizontal: 12, paddingBottom: 12, gap: 8, backgroundColor: "#FFFFFF",
        paddingTop: 8
    },

    pollCard: {
        backgroundColor: "#FFFFFF",
        borderRadius: 12,
        padding: 4,
        borderWidth: 1,
        borderColor: "#E5E7EB",
        shadowColor: "#000",
        shadowOffset: { width: 0, height: 1 },
        shadowOpacity: 0.03,
        shadowRadius: 2,
        elevation: 1,
    },

    pollTopSection: {
        flexDirection: "row",
        alignItems: "flex-start",
        gap: 12,
        marginBottom: 12, padding: 2,
    },

    pollLogo: {
        width: 52,
        height: 52,
        borderRadius: 48,
        backgroundColor: "#F3F4F6",
        borderWidth: 1,
        borderColor: "#E5E7EB",
    },
    pollLogoPlaceholder: {
        width: 52,
        height: 52,
        borderRadius: 8,
        backgroundColor: "#F3F4F6",
        alignItems: "center",
        justifyContent: "center",
        borderWidth: 1,
        borderColor: "#E5E7EB",
    },

    pollDetailsBody: {
        flex: 1,
        gap: 6, flexDirection: "column",
    },

    pollHeader: {
        flexDirection: "row",
        alignItems: "flex-start",
        justifyContent: "space-between",
        gap: 12,
    },
    pollTitle: { flex: 1, fontSize: 14, fontWeight: "500", color: "#374460ff", lineHeight: 20 },

    statusBadge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12, flexShrink: 0 },
    badgeActive: { backgroundColor: "#DEF7EC" },
    badgeClosed: { backgroundColor: "#F3F4F6" },
    badgeText: { fontSize: 12, fontWeight: "700" },
    badgeTextActive: { color: "#046C4E" },
    badgeTextClosed: { color: "#6B7280" },

    pollMetaRow: {
        flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 8,
        marginTop: 2,
    },
    metaIconGroup: { flexDirection: "row", alignItems: "center", gap: 4 },
    metaText: { fontSize: 13, color: "#6B7280", fontWeight: "500" },

    pollFooter: {
        flexDirection: "row", alignItems: "center", gap: 5, justifyContent: "space-between",
        borderTopWidth: 1, borderTopColor: "#F3F4F6", paddingTop: 12,
    },
    faceVerificationRow: {
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        marginTop: 10,
        paddingTop: 8,
        borderTopWidth: 1,
        borderTopColor: "#F3F4F6",
    },
    faceVerificationLabel: { flexDirection: "row", alignItems: "center", gap: 5 },
    faceVerificationText: { fontSize: 12.5, color: "#4B5563", fontWeight: "600" },
    badgeGroup: { flexDirection: "row", alignItems: "center", gap: 3 },

    tagStandard: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6, backgroundColor: "#F3F4F6" },
    tagTextStandard: { fontSize: 12, color: "#4B5563", fontWeight: "600" },

    tagVIP: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6, backgroundColor: "#FEF3C7" },
    tagTextVIP: { fontSize: 12, color: "#B45309", fontWeight: "600" },

    tagVerified: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6, backgroundColor: "#ECFDF5" },
    tagTextVerified: { fontSize: 12, color: "#047857", fontWeight: "600" },

    tagUnverified: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6, backgroundColor: "#FEF2F2" },
    tagTextUnverified: { fontSize: 12, color: "#B91C1C", fontWeight: "600" },
    bottomNav: {
        flexDirection: "row",
        justifyContent: "space-around",
        paddingVertical: 10,
        borderTopWidth: 0.5,
        borderTopColor: "#ccc",
        backgroundColor: "#fff",
    },
    navItem: { alignItems: "center", paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8 },
    navText: { fontSize: 13, marginTop: 2, fontWeight: "600" },

    modalOverlay: {
        flex: 1,
        backgroundColor: "rgba(0,0,0,0.45)",
        alignItems: "center",
        justifyContent: "center",
        paddingHorizontal: 24,
    },
    modalCard: {
        width: "100%",
        maxWidth: 340,
        backgroundColor: "#FFFFFF",
        borderRadius: 16,
        padding: 10,
        alignItems: "center",
    },
    scheduleModalCard: {
        width: "100%",
        maxWidth: 340,
        backgroundColor: "#FFFFFF",
        borderRadius: 16,
        padding: 20,
        alignItems: "center",
    },
    scheduleModalIconWrap: {
        width: 52,
        height: 52,
        borderRadius: 26,
        backgroundColor: "#FEF3C7",
        alignItems: "center",
        justifyContent: "center",
        marginBottom: 12,
    },
    scheduleModalDate: { fontWeight: "700", color: "#374151" },
    scheduleModalButton: {
        width: "100%",
        paddingVertical: 12,
        borderRadius: 10,
        alignItems: "center",
        backgroundColor: "#1F9F4E",
    },
    scheduleModalButtonText: { fontSize: 14, fontWeight: "700", color: "#FFFFFF" },
    modalIconWrap: {
        height: 39,
        borderRadius: 24,
        backgroundColor: "#FEF2F2",
        marginBottom: 8,
        paddingHorizontal: 12,
        flexDirection: "row", justifyContent: "center", alignItems: "center",
        gap: 8,
    },
    modalTitle: {
        fontSize: 16,
        fontWeight: "700",
        color: "#111827",
    },
    modalDesc: {
        fontSize: 14,
        color: "#6B7280",
        textAlign: "center",
        lineHeight: 20,
        marginBottom: 20,
    },
    modalActions: {
        flexDirection: "row",
        gap: 10,
        width: "100%",
    },
    modalCancelBtn: {
        flex: 1,
        paddingVertical: 12,
        borderRadius: 10,
        backgroundColor: "#F3F4F6",
        alignItems: "center",
    },
    modalCancelText: {
        fontSize: 14,
        fontWeight: "600",
        color: "#374151",
    },
    modalDeleteBtn: {
        flex: 1,
        paddingVertical: 12,
        borderRadius: 10,
        backgroundColor: "#EF4444",
        alignItems: "center",
    },
    modalDeleteText: {
        fontSize: 14,
        fontWeight: "600",
        color: "#FFFFFF",
    },

    pollLogoWrapper: {
        width: 60,
        height: 60,
        borderRadius: 40,
        backgroundColor: "#F3F4F6",
        borderWidth: 1,
        borderColor: "#E5E7EB",
        alignItems: "center",
        justifyContent: "center",
        overflow: "hidden",
    },
    pollLogoInner: {
        width: "90%",
        height: "90%",
        borderRadius: 50,
    },
    loadMoreBtn: {
        marginTop: 8,
        marginBottom: 4,
        paddingVertical: 12,
        borderRadius: 10,
        backgroundColor: "#FFFFFF",
        borderWidth: 1,
        borderColor: "#E5E7EB",
        alignItems: "center",
    },
    loadMoreText: { fontSize: 14, fontWeight: "600", color: "#1F9F4E" },
    avatarPlaceholder: { position: "absolute" },
    loaderContainer: { flex: 1, justifyContent: "center", alignItems: "center", backgroundColor: "#fff" },
});