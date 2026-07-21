import React, { useCallback, useContext, useEffect, useMemo, useState } from "react";
import {
    View,
    Text,
    TextInput,
    TouchableOpacity,
    ScrollView,
    StyleSheet,
    Platform,
    ActivityIndicator,
    Alert,
    Image,
} from "react-native";
import { Ionicons, MaterialIcons } from "@expo/vector-icons";
import { router, useFocusEffect, useLocalSearchParams } from "expo-router";
import * as FileSystem from "expo-file-system";
import * as Sharing from "expo-sharing";
import * as Print from "expo-print";
import {
    Document as DocxDocument,
    Packer,
    Paragraph,
    Table as DocxTable,
    TableRow as DocxTableRow,
    TableCell as DocxTableCell,
    TextRun,
    HeadingLevel,
    AlignmentType,
    WidthType,
    BorderStyle,
    ShadingType,
} from "docx";
import ReusableScreen from "@/components/ReusableScreen";
import { GlobalContext } from "@/context";
import { db } from "@/firebase";
import { collection, doc, getDoc, getDocs, query, where } from "firebase/firestore";

// ─── Data-shape assumptions ────────────────────────────────────────────────────
//
// This screen reads the same collections CreatePollScreen writes:
//   POLL_TITLE_DB/{pollId}
//   ASPIRANTS_DETAILS_DB/{pollId}_{aspirantEmail}
//   VALIDATED_VOTERS_DB/{pollId}/validatedVoterInfo/{code}
//     → arbitrary creator-named columns, keyed exactly as the creator typed
//       them. There's no fixed schema — this screen never hardcodes a field
//       name like "gender" or "department"; instead it statistically detects
//       which columns are identifiers (near-unique per voter, e.g. a code or
//       name) versus categorical attributes worth cross-tabulating (e.g.
//       department, faculty, gender), and buckets numeric-looking columns
//       (e.g. age) into human-friendly ranges. See `detectFields` below.
//
// Ballots (who voted for whom) come from PollLeaderboardScreen, which writes
// one doc per VOTER (not per ballot) to:
//   VOTERS_DB/{pollId}_{myVoterId}
//     - pollId, voterEmail, votersName, pollTitle, creatorEmail
//     - aspirantVoted: string | string[] | null
//         · single-vote polls  → a single aspirant email, or null once removed
//         · multiple-vote polls → an array with ONE ENTRY PER VOTE CAST,
//           duplicates intentional (["a@x","a@x","b@x"] = 2 votes for a, 1 for b)
//     - votedAt: Timestamp
//
// Per-aspirant vote totals still come straight from ASPIRANTS_DETAILS_DB's
// own `votes` counter (already the authoritative, transactionally-updated
// tally) — VOTERS_DB is only used here to attach a demographic identity to
// each ballot for cross-tabs.
//
// `voterEmail` in VOTERS_DB and the doc IDs in VALIDATED_VOTERS_DB are both
// keyed on the SAME canonical identifier — myVoterId, a sanitized userid —
// there's no separate "voter code" concept independent of a voter's account.
// So `sanitizeVoterCode(voterEmail)` below should always match a validated
// voter's doc ID exactly. A ballot that still fails to match (surfaced as
// `unmatchedBallots`) signals a genuine data-integrity issue — e.g. someone
// voted without ever appearing on the validated-voter list at the time of
// casting — worth investigating rather than an expected format mismatch.

// ─── Types ──────────────────────────────────────────────────────────────────

interface AspirantAnalytics {
    id: string;
    name: string;
    email: string;
    photo: string;
    votes: number;
    percentage: number;
}

interface VoterVoteRecord {
    code: string;
    fields: Record<string, string>;
    aspirantEmails: string[];
    hasVoted: boolean;
}

type FieldKind = "categorical" | "numeric_bucketed" | "identifier";

interface DetectedField {
    key: string;
    label: string;
    kind: FieldKind;
    categories: string[];
    valueOf: (record: VoterVoteRecord) => string | null;
}

interface CrossTabRow {
    category: string;
    totalVoters: number;
    votedCount: number;
    countsByAspirantId: Record<string, number>;
    leaderAspirantId: string | null;
    leaderShare: number;
}

interface PollSummary {
    pollId: string;
    title: string;
    pollType: "single" | "multiple";
    requiresValidation: boolean;
    isAnonymous: boolean;
    showResults: boolean;
    status: string;
    deadline: string | null;
    logoUrl: string;
}

interface AnalyticsBundle {
    poll: PollSummary;
    aspirants: AspirantAnalytics[];
    voterRecords: VoterVoteRecord[];
    totalBallots: number;
    totalValidatedVoters: number;
    unmatchedBallots: number; // ballots whose voter never appeared on the validated-voter list — a data-integrity flag, not an expected gap
}

// ─── Constants & small helpers ──────────────────────────────────────────────

// When a poll is anonymous, we still allow aggregate demographic analysis
// (it doesn't reveal any one voter's choice) but suppress any group whose
// size is below this threshold, since a very small group can effectively
// re-identify a voter. This is a lightweight k-anonymity style guard.
const MIN_ANON_GROUP_SIZE = 3;

const NUMERIC_RE = /^-?\d+(\.\d+)?$/;

const AVATAR_PALETTE = ["#1F9F4E", "#2563EB", "#D97706", "#7C3AED", "#DB2777", "#0D9488", "#DC2626", "#0891B2"];

const sanitizeVoterCode = (raw: string) => raw.trim().toLowerCase();

const humanizeKey = (key: string): string => {
    const spaced = key
        .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
        .replace(/[_\-]+/g, " ")
        .trim();
    return spaced
        .split(" ")
        .filter(Boolean)
        .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
        .join(" ");
};

const pct = (n: number, d: number) => (d > 0 ? Math.round((n / d) * 1000) / 10 : 0);

// Multiple-vote ballots store one array entry per vote cast, with
// duplicates intentional (see VOTERS_DB schema note above). This collapses
// those duplicates into a readable "Name ×3" form for the raw voter table.
const formatVoteChoices = (emails: string[], aspirants: AspirantAnalytics[]): string => {
    if (emails.length === 0) return "Not voted";
    const counts = new Map<string, number>();
    emails.forEach((email) => counts.set(email, (counts.get(email) || 0) + 1));
    return Array.from(counts.entries())
        .map(([email, count]) => {
            const name = aspirants.find((a) => a.email === email)?.name || email;
            return count > 1 ? `${name} ×${count}` : name;
        })
        .join(", ");
};

// ─── Field detection ────────────────────────────────────────────────────────
//
// Runs purely on the values actually present in this poll's voter file, so
// it works regardless of what the creator named their columns.
const detectFields = (records: VoterVoteRecord[]): DetectedField[] => {
    if (records.length === 0) return [];

    const keys = new Set<string>();
    records.forEach((r) => Object.keys(r.fields).forEach((k) => keys.add(k)));

    const fields: DetectedField[] = [];

    keys.forEach((key) => {
        const values = records.map((r) => (r.fields[key] || "").trim()).filter((v) => v.length > 0);
        if (values.length === 0) return;

        const numericValues = values.filter((v) => NUMERIC_RE.test(v)).map(Number);
        const isMostlyNumeric = numericValues.length / values.length >= 0.8;
        const isPlausibleAgeRange =
            isMostlyNumeric && Math.min(...numericValues) >= 0 && Math.max(...numericValues) <= 120;

        if (isMostlyNumeric && isPlausibleAgeRange) {
            const bucketFor = (n: number) => {
                if (n < 18) return "Under 18";
                if (n < 25) return "18–24";
                if (n < 35) return "25–34";
                if (n < 45) return "35–44";
                if (n < 60) return "45–59";
                return "60+";
            };
            fields.push({
                key,
                label: humanizeKey(key),
                kind: "numeric_bucketed",
                categories: ["Under 18", "18–24", "25–34", "35–44", "45–59", "60+"],
                valueOf: (r) => {
                    const raw = (r.fields[key] || "").trim();
                    return NUMERIC_RE.test(raw) ? bucketFor(Number(raw)) : null;
                },
            });
            return;
        }

        // Every other column — regardless of how many distinct values it
        // has, or how unique those values are per voter — is treated as
        // categorical. Nothing gets classified as an identifier or
        // excluded from the breakdown; every uploaded column gets its own
        // tab, including things like name/email/code.
        fields.push({
            key,
            label: humanizeKey(key),
            kind: "categorical",
            categories: Array.from(new Set(values)).sort(),
            valueOf: (r) => (r.fields[key] || "").trim() || null,
        });
    });

    return fields.sort((a, b) => a.label.localeCompare(b.label));
};

const buildCrossTab = (
    field: DetectedField,
    records: VoterVoteRecord[],
    aspirants: AspirantAnalytics[]
): CrossTabRow[] => {
    const rows: CrossTabRow[] = field.categories.map((category) => {
        const inCategory = records.filter((r) => field.valueOf(r) === category);
        const voted = inCategory.filter((r) => r.hasVoted);

        const countsByAspirantId: Record<string, number> = {};
        aspirants.forEach((a) => (countsByAspirantId[a.id] = 0));
        voted.forEach((r) => {
            r.aspirantEmails.forEach((email) => {
                const a = aspirants.find((x) => x.email === email);
                if (a) countsByAspirantId[a.id] = (countsByAspirantId[a.id] || 0) + 1;
            });
        });

        let leaderAspirantId: string | null = null;
        let leaderVotes = 0;
        Object.entries(countsByAspirantId).forEach(([id, count]) => {
            if (count > leaderVotes) {
                leaderVotes = count;
                leaderAspirantId = id;
            }
        });
        const totalCategoryVotes = Object.values(countsByAspirantId).reduce((s, c) => s + c, 0);

        return {
            category,
            totalVoters: inCategory.length,
            votedCount: voted.length,
            countsByAspirantId,
            leaderAspirantId,
            leaderShare: totalCategoryVotes > 0 ? leaderVotes / totalCategoryVotes : 0,
        };
    });

    return rows.filter((r) => r.totalVoters > 0);
};

const generateInsights = (
    fields: DetectedField[],
    records: VoterVoteRecord[],
    aspirants: AspirantAnalytics[],
    isAnonymous: boolean
): string[] => {
    const insights: string[] = [];
    const nameById = new Map(aspirants.map((a) => [a.id, a.name]));
    const minGroup = isAnonymous ? MIN_ANON_GROUP_SIZE : 2;

    fields
        .filter((f) => f.kind !== "identifier")
        .forEach((field) => {
            const rows = buildCrossTab(field, records, aspirants).filter((r) => r.votedCount >= minGroup);
            rows
                .filter((r) => r.leaderAspirantId && r.leaderShare >= 0.6)
                .forEach((r) => {
                    const leaderName = nameById.get(r.leaderAspirantId!);
                    const leaderVotes = r.countsByAspirantId[r.leaderAspirantId!];
                    insights.push(
                        `${leaderVotes} of ${r.votedCount} voters in "${r.category}" (${field.label}) voted for ${leaderName} — ${Math.round(
                            r.leaderShare * 100
                        )}% of that group.`
                    );
                });
        });

    return insights.slice(0, 8);
};

// ─── Firestore fetch ────────────────────────────────────────────────────────

const fetchPollAnalytics = async (pollId: string): Promise<AnalyticsBundle> => {
    const pollSnap = await getDoc(doc(db, "POLL_TITLE_DB", pollId));
    if (!pollSnap.exists()) throw new Error("Poll not found");
    const p = pollSnap.data() as any;

    const poll: PollSummary = {
        pollId,
        title: p.title || "Untitled poll",
        pollType: p.pollType === "multiple" ? "multiple" : "single",
        requiresValidation: p.requires_voters_validation === "true" || p.requires_voters_validation === true,
        isAnonymous: !!p.isAnonymous,
        showResults: p.showResults !== false,
        status: p.status || "active",
        deadline: p.deadline || null,
        logoUrl: p.logoUrl || "",
    };

    const aspirantsSnap = await getDocs(
        query(collection(db, "ASPIRANTS_DETAILS_DB"), where("pollId", "==", pollId))
    );
    // `votes` here comes straight from Firestore's own counter, which
    // PollLeaderboardScreen updates transactionally (increment / decrement) —
    // this is the authoritative tally; we don't recompute it from ballots.
    const aspirants: AspirantAnalytics[] = aspirantsSnap.docs.map((d) => {
        const a = d.data() as any;
        return {
            id: d.id,
            name: a.name || "Unnamed aspirant",
            email: a.aspirantEmail || "",
            photo: a.photo || "",
            votes: typeof a.votes === "number" ? a.votes : 0,
            percentage: 0,
        };
    });

    let voterFieldsByCode: Record<string, Record<string, string>> = {};
    if (poll.requiresValidation) {
        const votersSnap = await getDocs(collection(db, "VALIDATED_VOTERS_DB", pollId, "validatedVoterInfo"));
        votersSnap.docs.forEach((d) => {
            voterFieldsByCode[d.id] = d.data() as Record<string, string>;
        });
    }

    // Ballots live in VOTERS_DB, one doc per VOTER (not per ballot), keyed by
    // {pollId}_{voterEmail}. See the schema note at the top of this file.
    const ballotsSnap = await getDocs(query(collection(db, "VOTERS_DB"), where("pollId", "==", pollId)));

    const voterRecordsByCode = new Map<string, VoterVoteRecord>();
    Object.entries(voterFieldsByCode).forEach(([code, fields]) => {
        voterRecordsByCode.set(code, { code, fields, aspirantEmails: [], hasVoted: false });
    });

    let totalBallots = 0;
    let unmatchedBallots = 0;

    ballotsSnap.docs.forEach((d) => {
        const v = d.data() as any;
        const raw = v.aspirantVoted;
        // Single-vote polls store one email (or null once a vote is removed);
        // multiple-vote polls store an array with one entry per vote cast,
        // duplicates intentional — see the schema note above.
        const emails: string[] = Array.isArray(raw) ? raw.filter(Boolean) : raw ? [String(raw)] : [];
        if (emails.length === 0) return; // hasn't voted, or removed their only vote

        totalBallots += 1;

        const voterEmail = v.voterEmail || "";
        const code = sanitizeVoterCode(String(voterEmail));

        const existing = voterRecordsByCode.get(code);
        if (existing) {
            // Matches a validated-voter record — attach the ballot to it.
            existing.aspirantEmails = emails;
            existing.hasVoted = true;
        } else if (poll.requiresValidation) {
            // Both VOTERS_DB and VALIDATED_VOTERS_DB key off the same canonical
            // identifier (myVoterId), so this really shouldn't happen — it means
            // someone cast a ballot without ever appearing on the validated-voter
            // list (e.g. they were added after voting closed, or removed since).
            // Their vote still counts toward the aspirant tally above; it's just
            // flagged here instead of silently excluded from demographics.
            unmatchedBallots += 1;
        } else {
            // No voter validation on this poll, so there's no demographic file to
            // join against anyway — keep a bare record so raw vote data still shows.
            voterRecordsByCode.set(code, { code, fields: {}, aspirantEmails: emails, hasVoted: true });
        }
    });

    const totalVotes = aspirants.reduce((sum, a) => sum + a.votes, 0);
    aspirants.forEach((a) => {
        a.percentage = totalVotes > 0 ? (a.votes / totalVotes) * 100 : 0;
    });
    aspirants.sort((a, b) => b.votes - a.votes);

    return {
        poll,
        aspirants,
        voterRecords: Array.from(voterRecordsByCode.values()),
        totalBallots,
        totalValidatedVoters: Object.keys(voterFieldsByCode).length,
        unmatchedBallots,
    };
};

// ─── Report builders (shared content for PDF + Word) ───────────────────────

const buildReportHtml = (
    data: AnalyticsBundle,
    fields: DetectedField[],
    insights: string[]
): string => {
    const { poll, aspirants, voterRecords, totalBallots, totalValidatedVoters } = data;
    const turnout = poll.requiresValidation ? pct(totalBallots, totalValidatedVoters) : null;
    const generatedAt = new Date().toLocaleString();

    const distributionRows = aspirants
        .map(
            (a) => `<tr><td>${a.name}</td><td>${a.votes}</td><td>${a.percentage.toFixed(1)}%</td></tr>`
        )
        .join("");

    const fieldSections = fields
        .filter((f) => f.kind !== "identifier")
        .map((field) => {
            const rows = buildCrossTab(field, voterRecords, aspirants).filter(
                (r) => !poll.isAnonymous || r.votedCount >= MIN_ANON_GROUP_SIZE
            );
            const header = `<tr><th>${field.label}</th><th>Voted</th>${aspirants
                .map((a) => `<th>${a.name}</th>`)
                .join("")}</tr>`;
            const body = rows
                .map(
                    (r) =>
                        `<tr><td>${r.category}</td><td>${r.votedCount}/${r.totalVoters}</td>${aspirants
                            .map((a) => `<td>${r.countsByAspirantId[a.id] || 0}</td>`)
                            .join("")}</tr>`
                )
                .join("");
            return `<h3>${field.label} breakdown</h3><table>${header}${body}</table>`;
        })
        .join("");

    const insightItems = insights.map((i) => `<li>${i}</li>`).join("");

    return `<!DOCTYPE html>
<html><head><meta charset="utf-8" />
<style>
  body { font-family: -apple-system, Helvetica, Arial, sans-serif; color: #1a1a1a; padding: 24px; }
  h1 { color: #1F9F4E; margin-bottom: 4px; }
  h2 { color: #1F9F4E; margin-top: 28px; border-bottom: 2px solid #EAF6EE; padding-bottom: 6px; }
  h3 { margin-top: 20px; color: #374151; }
  .meta { color: #6b7280; font-size: 13px; margin-bottom: 20px; }
  table { border-collapse: collapse; width: 100%; margin-top: 8px; font-size: 13px; }
  th, td { border: 1px solid #e5e7eb; padding: 6px 10px; text-align: left; }
  th { background: #EAF6EE; color: #1F9F4E; }
  tr:nth-child(even) { background: #fafbfc; }
  .stat-row { display: flex; gap: 16px; margin: 16px 0; }
  .stat { background: #EAF6EE; border-radius: 8px; padding: 10px 16px; }
  .stat b { display: block; font-size: 20px; color: #1F9F4E; }
  ul { line-height: 1.6; }
  .footer { margin-top: 30px; font-size: 11px; color: #9ca3af; }
</style></head>
<body>
  <h1>${poll.title}</h1>
  <div class="meta">Vote analytics report · generated ${generatedAt}${poll.isAnonymous ? " · anonymous poll (small groups suppressed)" : ""}</div>

  <div class="stat-row">
    <div class="stat"><b>${totalBallots}</b>Ballots cast</div>
    ${turnout !== null ? `<div class="stat"><b>${turnout}%</b>Turnout</div>` : ""}
    <div class="stat"><b>${aspirants[0]?.name || "—"}</b>Leading aspirant</div>
  </div>

  <h2>Vote distribution</h2>
  <table><tr><th>Aspirant</th><th>Votes</th><th>Share</th></tr>${distributionRows}</table>

  ${insights.length ? `<h2>Key insights</h2><ul>${insightItems}</ul>` : ""}

  ${fieldSections ? `<h2>Demographic breakdown</h2>${fieldSections}` : ""}

  <div class="footer">Generated by the poll analytics dashboard. Figures reflect data available at the time of export.</div>
</body></html>`;
};

const buildDocxDocument = (
    data: AnalyticsBundle,
    fields: DetectedField[],
    insights: string[]
): DocxDocument => {
    const { poll, aspirants, voterRecords, totalBallots, totalValidatedVoters } = data;
    const turnout = poll.requiresValidation ? pct(totalBallots, totalValidatedVoters) : null;

    const headerCellShading = { fill: "1F9F4E", type: ShadingType.CLEAR, color: "auto" };
    const cellBorder = {
        top: { style: BorderStyle.SINGLE, size: 2, color: "D9DAD9" },
        bottom: { style: BorderStyle.SINGLE, size: 2, color: "D9DAD9" },
        left: { style: BorderStyle.SINGLE, size: 2, color: "D9DAD9" },
        right: { style: BorderStyle.SINGLE, size: 2, color: "D9DAD9" },
    };

    const textCell = (text: string, header = false) =>
        new DocxTableCell({
            shading: header ? headerCellShading : undefined,
            borders: cellBorder,
            children: [
                new Paragraph({
                    children: [new TextRun({ text, bold: header, color: header ? "FFFFFF" : "1a1a1a" })],
                }),
            ],
        });

    const distributionTable = new DocxTable({
        width: { size: 100, type: WidthType.PERCENTAGE },
        rows: [
            new DocxTableRow({ children: [textCell("Aspirant", true), textCell("Votes", true), textCell("Share", true)] }),
            ...aspirants.map(
                (a) =>
                    new DocxTableRow({
                        children: [textCell(a.name), textCell(String(a.votes)), textCell(`${a.percentage.toFixed(1)}%`)],
                    })
            ),
        ],
    });

    const fieldTables: (Paragraph | DocxTable)[] = [];
    fields
        .filter((f) => f.kind !== "identifier")
        .forEach((field) => {
            const rows = buildCrossTab(field, voterRecords, aspirants).filter(
                (r) => !poll.isAnonymous || r.votedCount >= MIN_ANON_GROUP_SIZE
            );
            if (rows.length === 0) return;

            fieldTables.push(
                new Paragraph({ text: `${field.label} breakdown`, heading: HeadingLevel.HEADING_3, spacing: { before: 240 } })
            );
            fieldTables.push(
                new DocxTable({
                    width: { size: 100, type: WidthType.PERCENTAGE },
                    rows: [
                        new DocxTableRow({
                            children: [
                                textCell(field.label, true),
                                textCell("Voted", true),
                                ...aspirants.map((a) => textCell(a.name, true)),
                            ],
                        }),
                        ...rows.map(
                            (r) =>
                                new DocxTableRow({
                                    children: [
                                        textCell(r.category),
                                        textCell(`${r.votedCount}/${r.totalVoters}`),
                                        ...aspirants.map((a) => textCell(String(r.countsByAspirantId[a.id] || 0))),
                                    ],
                                })
                        ),
                    ],
                })
            );
        });

    return new DocxDocument({
        sections: [
            {
                children: [
                    new Paragraph({ text: poll.title, heading: HeadingLevel.TITLE }),
                    new Paragraph({
                        children: [
                            new TextRun({
                                text: `Vote analytics report · generated ${new Date().toLocaleString()}${poll.isAnonymous ? " · anonymous poll (small groups suppressed)" : ""
                                    }`,
                                color: "6b7280",
                                size: 20,
                            }),
                        ],
                        spacing: { after: 300 },
                    }),
                    new Paragraph({
                        children: [
                            new TextRun({ text: `Ballots cast: ${totalBallots}`, bold: true }),
                            new TextRun({ text: turnout !== null ? `   |   Turnout: ${turnout}%` : "" }),
                            new TextRun({ text: `   |   Leading: ${aspirants[0]?.name || "—"}` }),
                        ],
                        spacing: { after: 200 },
                    }),
                    new Paragraph({ text: "Vote distribution", heading: HeadingLevel.HEADING_2, spacing: { before: 200 } }),
                    distributionTable,
                    ...(insights.length
                        ? [
                            new Paragraph({ text: "Key insights", heading: HeadingLevel.HEADING_2, spacing: { before: 300 } }),
                            ...insights.map(
                                (i) => new Paragraph({ text: i, bullet: { level: 0 }, spacing: { after: 80 } })
                            ),
                        ]
                        : []),
                    ...(fieldTables.length
                        ? [new Paragraph({ text: "Demographic breakdown", heading: HeadingLevel.HEADING_2, spacing: { before: 300 } }), ...fieldTables]
                        : []),
                ],
            },
        ],
    });
};

// ─── Screen ─────────────────────────────────────────────────────────────────

export default function VoteAnalysesScreen() {
    const { userName } = useContext(GlobalContext);
    useFocusEffect(
        useCallback(() => {
            if (!userName) router.navigate("./PollsListScreen");
        }, [userName])
    );
    const params = useLocalSearchParams<{ pollId?: string }>();
    const pollId = typeof params.pollId === "string" ? params.pollId : "";

    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const [loadError, setLoadError] = useState<string | null>(null);
    const [data, setData] = useState<AnalyticsBundle | null>(null);

    const [selectedFieldKey, setSelectedFieldKey] = useState<string | null>(null);
    const [voterSearch, setVoterSearch] = useState("");
    const [exporting, setExporting] = useState<"pdf" | "word" | null>(null);

    const loadData = async (isRefresh = false) => {
        if (!pollId) {
            setLoadError("No poll was specified.");
            setLoading(false);
            return;
        }
        isRefresh ? setRefreshing(true) : setLoading(true);
        setLoadError(null);
        try {
            const bundle = await fetchPollAnalytics(pollId);
            setData(bundle);
        } catch (err) {
            console.error("Failed to load analytics:", err);
            setLoadError("Could not load analytics for this poll. Please try again.");
        } finally {
            setLoading(false);
            setRefreshing(false);
        }
    };

    useEffect(() => {
        loadData();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [pollId]);

    const detectedFields = useMemo(
        () => (data ? detectFields(data.voterRecords) : []),
        [data]
    );

    const groupableFields = useMemo(
        () => detectedFields.filter((f) => f.kind !== "identifier"),
        [detectedFields]
    );

    useEffect(() => {
        if (!selectedFieldKey && groupableFields.length > 0) {
            setSelectedFieldKey(groupableFields[0].key);
        }
    }, [groupableFields, selectedFieldKey]);

    const selectedField = groupableFields.find((f) => f.key === selectedFieldKey) || null;

    const crossTab = useMemo(() => {
        if (!data || !selectedField) return [];
        const rows = buildCrossTab(selectedField, data.voterRecords, data.aspirants);
        return rows.filter((r) => !data.poll.isAnonymous || r.votedCount >= MIN_ANON_GROUP_SIZE);
    }, [data, selectedField]);

    const insights = useMemo(() => {
        if (!data) return [];
        return generateInsights(groupableFields, data.voterRecords, data.aspirants, data.poll.isAnonymous);
    }, [data, groupableFields]);

    const identifierFields = useMemo(() => detectedFields.filter((f) => f.kind === "identifier"), [detectedFields]);

    const filteredVoterRecords = useMemo(() => {
        if (!data) return [];
        const q = voterSearch.trim().toLowerCase();
        if (!q) return data.voterRecords;
        return data.voterRecords.filter((r) => {
            const haystack = [r.code, ...Object.values(r.fields)].join(" ").toLowerCase();
            return haystack.includes(q);
        });
    }, [data, voterSearch]);

    const canShowRawTable = data ? !data.poll.isAnonymous && data.poll.requiresValidation : false;

    const turnout = data && data.poll.requiresValidation ? pct(data.totalBallots, data.totalValidatedVoters) : null;

    // ── Export handlers ──────────────────────────────────────────────────────

    const exportPdf = async () => {
        if (!data) return;
        setExporting("pdf");
        try {
            const html = buildReportHtml(data, detectedFields, insights);

            if (Platform.OS === "web") {
                const win = window.open("", "_blank");
                if (!win) throw new Error("popup-blocked");
                win.document.write(html);
                win.document.close();
                win.focus();
                setTimeout(() => win.print(), 350);
            } else {
                const { uri } = await Print.printToFileAsync({ html });
                const canShare = await Sharing.isAvailableAsync();
                if (canShare) {
                    await Sharing.shareAsync(uri, {
                        mimeType: "application/pdf",
                        dialogTitle: "Share analytics report",
                        UTI: "com.adobe.pdf",
                    });
                } else {
                    Alert.alert("Saved", `Report saved to:\n${uri}`);
                }
            }
        } catch (err) {
            console.error("PDF export failed:", err);
            const popupBlocked = err instanceof Error && err.message === "popup-blocked";
            Alert.alert(
                "Export failed",
                popupBlocked
                    ? "Your browser blocked the report window. Please allow pop-ups and try again."
                    : "Could not generate the PDF report. Please try again."
            );
        } finally {
            setExporting(null);
        }
    };

    const exportWord = async () => {
        if (!data) return;
        setExporting("word");
        try {
            const docxFile = buildDocxDocument(data, detectedFields, insights);
            const base64 = await Packer.toBase64String(docxFile);
            const fileName = `${data.poll.title.replace(/[^a-z0-9]+/gi, "_").slice(0, 40) || "poll"}_analytics.docx`;
            const mimeType = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

            if (Platform.OS === "web") {
                const byteChars = atob(base64);
                const byteNumbers = new Array(byteChars.length);
                for (let i = 0; i < byteChars.length; i++) byteNumbers[i] = byteChars.charCodeAt(i);
                const blob = new Blob([new Uint8Array(byteNumbers)], { type: mimeType });
                const url = URL.createObjectURL(blob);
                const link = window.document.createElement("a");
                link.href = url;
                link.download = fileName;
                window.document.body.appendChild(link);
                link.click();
                window.document.body.removeChild(link);
                URL.revokeObjectURL(url);
            } else {
                const fileUri = `${FileSystem.cacheDirectory}${fileName}`;
                await FileSystem.writeAsStringAsync(fileUri, base64, { encoding: FileSystem.EncodingType.Base64 });
                const canShare = await Sharing.isAvailableAsync();
                if (canShare) {
                    await Sharing.shareAsync(fileUri, {
                        mimeType,
                        dialogTitle: "Share analytics report",
                        UTI: "org.openxmlformats.wordprocessingml.document",
                    });
                } else {
                    Alert.alert("Saved", `Report saved to:\n${fileUri}`);
                }
            }
        } catch (err) {
            console.error("Word export failed:", err);
            Alert.alert("Export failed", "Could not generate the Word report. Please try again.");
        } finally {
            setExporting(null);
        }
    };

    // ── Render states ────────────────────────────────────────────────────────

    if (loading) {
        return (
            <ReusableScreen>
                <View style={styles.centerFill}>
                    <ActivityIndicator size="large" color="#1F9F4E" />
                    <Text style={styles.loadingText}>Loading analytics…</Text>
                </View>
            </ReusableScreen>
        );
    }

    if (loadError || !data) {
        return (
            <ReusableScreen>
                <View style={styles.centerFill}>
                    <Ionicons name="alert-circle-outline" size={36} color="#ef4444" />
                    <Text style={styles.errorTitle}>{loadError || "Something went wrong."}</Text>
                    <TouchableOpacity style={styles.retryBtn} onPress={() => loadData()}>
                        <Text style={styles.retryBtnText}>Try again</Text>
                    </TouchableOpacity>
                </View>
            </ReusableScreen>
        );
    }

    const { poll, aspirants, totalBallots, totalValidatedVoters } = data;

    return (
        <ReusableScreen>
            {/* ── Header ── */}
            <View style={styles.header}>
                <TouchableOpacity onPress={() => router.back()} style={styles.backBtn} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
                    <Ionicons name="arrow-back" size={18} color="#fff" />
                </TouchableOpacity>
                <Text style={styles.headerTitle} numberOfLines={1}>Vote Analytics</Text>
                <TouchableOpacity
                    onPress={() => loadData(true)}
                    style={styles.refreshBtn}
                    hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                >
                    {refreshing ? (
                        <ActivityIndicator size="small" color="#1F9F4E" />
                    ) : (
                        <Ionicons name="refresh-outline" size={18} color="#1F9F4E" />
                    )}
                </TouchableOpacity>
            </View>

            <ScrollView
                style={styles.scroll}
                contentContainerStyle={styles.scrollContent}
                showsVerticalScrollIndicator={false}
            >
                {/* ── Overview card ── */}
                <View style={styles.card}>
                    <View style={styles.overviewTopRow}>
                        <View style={{ marginRight: 10 }}>
                            {poll.logoUrl ? (
                                <Image source={{ uri: poll.logoUrl }} style={styles.pollLogo} resizeMode="cover" />
                            ) : (
                                <View style={[styles.pollLogo, styles.pollLogoPlaceholder]}>
                                    <MaterialIcons name="how-to-vote" size={20} color="#1F9F4E" />
                                </View>
                            )}
                        </View>
                        <View style={{ flex: 1 }}>
                            <Text style={styles.pollTitle} numberOfLines={2}>{poll.title}</Text>
                            <View style={styles.badgeRow}>
                                <View style={[styles.badge, poll.status === "active" ? styles.badgeActive : styles.badgeNeutral]}>
                                    <Text style={[styles.badgeText, poll.status === "active" && styles.badgeTextActive]}>
                                        {poll.status === "active" ? "Active" : poll.status}
                                    </Text>
                                </View>
                                <View style={styles.badgeNeutral}>
                                    <Text style={styles.badgeText}>{poll.pollType === "multiple" ? "Multi-vote" : "Single-vote"}</Text>
                                </View>
                                {poll.isAnonymous && (
                                    <View style={styles.badgeNeutral}>
                                        <Text style={styles.badgeText}>Anonymous</Text>
                                    </View>
                                )}
                            </View>
                        </View>
                    </View>

                    <View style={styles.dividerThin} />

                    <View style={styles.statRow}>
                        <View style={styles.statBox}>
                            <Text style={[styles.statValue, { fontSize: 22 }]}>{totalBallots}</Text>
                            <Text style={styles.statLabel}>Ballots cast</Text>
                        </View>
                        {turnout !== null && (
                            <View style={styles.statBox}>
                                <Text style={styles.statValue}>{turnout}%</Text>
                                <Text style={styles.statLabel}>Turnout ({totalBallots}/{totalValidatedVoters})</Text>
                            </View>
                        )}
                        <View style={styles.statBox}>
                            <Text style={styles.statValue} numberOfLines={1}>{totalBallots === 0 ? "None" : aspirants[0]?.name || "—"}</Text>
                            <Text style={styles.statLabel}>Leading aspirant</Text>
                        </View>
                    </View>
                </View>

                {/* ── Vote distribution card ── */}
                <View style={styles.card}>
                    <View style={styles.sectionHeaderRow}>
                        <View style={[styles.sectionIconWrap, { backgroundColor: "#EAF6EE" }]}>
                            <Ionicons name="bar-chart-outline" size={15} color="#1F9F4E" />
                        </View>
                        <Text style={styles.sectionLabel}>Vote Distribution</Text>
                    </View>

                    {aspirants.map((a, index) => {
                        const color = AVATAR_PALETTE[index % AVATAR_PALETTE.length];
                        return (
                            <View key={a.id} style={styles.distRow}>
                                <View style={styles.distTopRow}>
                                    {a.photo ? (
                                        <Image source={{ uri: a.photo }} style={styles.distAvatar} />
                                    ) : (
                                        <View style={[styles.distAvatar, { backgroundColor: color, alignItems: "center", justifyContent: "center" }]}>
                                            <Text style={styles.distAvatarInitial}>{a.name.charAt(0).toUpperCase()}</Text>
                                        </View>
                                    )}
                                    <Text style={styles.distName} numberOfLines={1}>{a.name}</Text>
                                    {index === 0 && a.votes > 0 && <Ionicons name="trophy" size={14} color="#D97706" />}
                                    <Text style={styles.distCount}>{a.votes} votes</Text>
                                </View>
                                <View style={styles.distBarTrack}>
                                    <View style={[styles.distBarFill, { width: `${Math.max(a.percentage, a.votes > 0 ? 3 : 0)}%`, backgroundColor: color }]} />
                                </View>
                                <Text style={styles.distPercent}>{a.percentage.toFixed(1)}%</Text>
                            </View>
                        );
                    })}
                </View>

                {/* ── Insights card ── */}
                {insights.length > 0 && (
                    <View style={styles.card}>
                        <View style={styles.sectionHeaderRow}>
                            <View style={[styles.sectionIconWrap, { backgroundColor: "#FEF6E7" }]}>
                                <Ionicons name="bulb-outline" size={15} color="#D97706" />
                            </View>
                            <Text style={[styles.sectionLabel, { color: "#D97706" }]}>Key Insights</Text>
                        </View>
                        {insights.map((insight, i) => (
                            <View key={i} style={styles.insightRow}>
                                <View style={styles.insightBullet} />
                                <Text style={styles.insightText}>{insight}</Text>
                            </View>
                        ))}
                        {poll.isAnonymous && (
                            <Text style={styles.insightFootnote}>
                                Groups smaller than {MIN_ANON_GROUP_SIZE} voters are omitted to protect anonymity.
                            </Text>
                        )}
                    </View>
                )}

                {/* ── Demographic breakdown card ── */}
                {groupableFields.length > 0 ? (
                    <View style={styles.card}>
                        <View style={styles.sectionHeaderRow}>
                            <View style={[styles.sectionIconWrap, { backgroundColor: "#EAF6EE" }]}>
                                <Ionicons name="people-circle-outline" size={15} color="#1F9F4E" />
                            </View>
                            <Text style={styles.sectionLabel}>Demographic Breakdown</Text>
                        </View>

                        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.fieldTabsScroll}>
                            {groupableFields.map((f) => (
                                <TouchableOpacity
                                    key={f.key}
                                    style={[styles.fieldTab, selectedFieldKey === f.key && styles.fieldTabActive]}
                                    onPress={() => setSelectedFieldKey(f.key)}
                                >
                                    <Text style={[styles.fieldTabText, selectedFieldKey === f.key && styles.fieldTabTextActive]}>
                                        {f.label}
                                    </Text>
                                </TouchableOpacity>
                            ))}
                        </ScrollView>

                        {selectedField && (
                            <ScrollView horizontal showsHorizontalScrollIndicator style={styles.crossTabScroll}>
                                <View>
                                    <View style={styles.crossTabHeaderRow}>
                                        <Text style={[styles.crossTabHeaderCell, styles.crossTabFirstCol]}>{selectedField.label}</Text>
                                        <Text style={styles.crossTabHeaderCell}>Voted</Text>
                                        {aspirants.map((a) => (
                                            <Text key={a.id} style={styles.crossTabHeaderCell} numberOfLines={1}>{a.name}</Text>
                                        ))}
                                    </View>
                                    {crossTab.length === 0 ? (
                                        <Text style={styles.emptyCrossTabText}>Not enough data to show this breakdown yet.</Text>
                                    ) : (
                                        crossTab.map((row, i) => (
                                            <View key={row.category} style={[styles.crossTabRow, i % 2 === 1 && styles.crossTabRowAlt]}>
                                                <Text style={[styles.crossTabCell, styles.crossTabFirstCol, { fontWeight: "700" }]}>{row.category}</Text>
                                                <Text style={styles.crossTabCell}>{row.votedCount}/{row.totalVoters}</Text>
                                                {aspirants.map((a) => (
                                                    <Text
                                                        key={a.id}
                                                        style={[
                                                            styles.crossTabCell,
                                                            row.leaderAspirantId === a.id && row.countsByAspirantId[a.id] > 0 && styles.crossTabCellLeader,
                                                        ]}
                                                    >
                                                        {row.countsByAspirantId[a.id] || 0}
                                                    </Text>
                                                ))}
                                            </View>
                                        ))
                                    )}
                                </View>
                            </ScrollView>
                        )}
                    </View>
                ) : (
                    <View style={styles.card}>
                        <View style={styles.sectionHeaderRow}>
                            <View style={[styles.sectionIconWrap, { backgroundColor: "#EAF6EE" }]}>
                                <Ionicons name="people-circle-outline" size={15} color="#1F9F4E" />
                            </View>
                            <Text style={styles.sectionLabel}>Demographic Breakdown</Text>
                        </View>
                        <Text style={styles.noticeText}>
                            {poll.requiresValidation
                                ? "The uploaded voter file doesn't have enough shared attributes to break down yet."
                                : "Enable voter validation with an uploaded file (including columns like department, faculty, or gender) to unlock demographic analytics for this poll."}
                        </Text>
                    </View>
                )}

                {/* ── Raw voter table / privacy notice ── */}
                <View style={styles.card}>
                    <View style={styles.sectionHeaderRow}>
                        <View style={[styles.sectionIconWrap, { backgroundColor: "#EAF6EE" }]}>
                            <Ionicons name="list-outline" size={15} color="#1F9F4E" />
                        </View>
                        <Text style={styles.sectionLabel}>Voter-Level Detail</Text>
                    </View>

                    {data.unmatchedBallots > 0 && (
                        <View style={styles.unmatchedNotice}>
                            <Ionicons name="warning-outline" size={14} color="#92702a" />
                            <Text style={styles.unmatchedNoticeText}>
                                {data.unmatchedBallots} ballot{data.unmatchedBallots !== 1 ? "s" : ""} came from someone not on the
                                validated-voter list at the time of this check — possibly added or removed after they voted. Counted
                                in totals above, but excluded from demographic breakdowns; worth a look.
                            </Text>
                        </View>
                    )}

                    {!canShowRawTable ? (
                        <Text style={styles.noticeText}>
                            {poll.isAnonymous
                                ? "This poll is anonymous — individual voter choices are hidden here, in line with the poll's settings."
                                : "Enable voter validation to see a per-voter breakdown."}
                        </Text>
                    ) : (
                        <View>
                            <View style={styles.searchRow}>
                                <Ionicons name="search-outline" size={15} color="#9ca3af" />
                                <TextInput
                                    style={styles.searchInput}
                                    placeholder="Search by code or attribute…"
                                    placeholderTextColor="#b0b0b0"
                                    value={voterSearch}
                                    onChangeText={setVoterSearch}
                                />
                            </View>

                            <ScrollView horizontal showsHorizontalScrollIndicator style={styles.crossTabScroll}>
                                <View>
                                    <View style={styles.crossTabHeaderRow}>
                                        <Text style={[styles.crossTabHeaderCell, styles.crossTabFirstCol]}>Code</Text>
                                        {identifierFields.filter((f) => f.key !== "validatedVoterCode").map((f) => (
                                            <Text key={f.key} style={styles.crossTabHeaderCell}>{f.label}</Text>
                                        ))}
                                        {groupableFields.map((f) => (
                                            <Text key={f.key} style={styles.crossTabHeaderCell}>{f.label}</Text>
                                        ))}
                                        <Text style={styles.crossTabHeaderCell}>Voted For</Text>
                                    </View>
                                    {filteredVoterRecords.slice(0, 200).map((r, i) => (
                                        <View key={r.code} style={[styles.crossTabRow, i % 2 === 1 && styles.crossTabRowAlt]}>
                                            <Text style={[styles.crossTabCell, styles.crossTabFirstCol]}>{r.code}</Text>
                                            {identifierFields.filter((f) => f.key !== "validatedVoterCode").map((f) => (
                                                <Text key={f.key} style={styles.crossTabCell}>{r.fields[f.key] || "—"}</Text>
                                            ))}
                                            {groupableFields.map((f) => (
                                                <Text key={f.key} style={styles.crossTabCell}>{f.valueOf(r) || "—"}</Text>
                                            ))}
                                            <Text style={styles.crossTabCell}>
                                                {r.hasVoted ? formatVoteChoices(r.aspirantEmails, aspirants) : "Not voted"}
                                            </Text>
                                        </View>
                                    ))}
                                </View>
                            </ScrollView>
                            {filteredVoterRecords.length > 200 && (
                                <Text style={styles.tableMoreText}>
                                    Showing 200 of {filteredVoterRecords.length} voters — refine your search to narrow results.
                                </Text>
                            )}
                        </View>
                    )}
                </View>

                {/* ── Export card ── */}
                <View style={styles.card}>
                    <View style={styles.sectionHeaderRow}>
                        <View style={[styles.sectionIconWrap, { backgroundColor: "#EAF6EE" }]}>
                            <Ionicons name="download-outline" size={15} color="#1F9F4E" />
                        </View>
                        <Text style={styles.sectionLabel}>Export Report</Text>
                    </View>
                    <Text style={styles.fieldHint}>
                        Download this analysis to share with stakeholders or archive alongside the poll results.
                    </Text>

                    <View style={styles.exportRow}>
                        <TouchableOpacity
                            style={[styles.exportBtn, styles.exportBtnPdf]}
                            onPress={exportPdf}
                            disabled={exporting !== null}
                            activeOpacity={0.85}
                        >
                            {exporting === "pdf" ? (
                                <ActivityIndicator color="#fff" size="small" />
                            ) : (
                                <>
                                    <Ionicons name="document-text-outline" size={16} color="#fff" />
                                    <Text style={styles.exportBtnText}>Export PDF</Text>
                                </>
                            )}
                        </TouchableOpacity>

                        <TouchableOpacity
                            style={[styles.exportBtn, styles.exportBtnWord]}
                            onPress={exportWord}
                            disabled={exporting !== null}
                            activeOpacity={0.85}
                        >
                            {exporting === "word" ? (
                                <ActivityIndicator color="#fff" size="small" />
                            ) : (
                                <>
                                    <MaterialIcons name="description" size={16} color="#fff" />
                                    <Text style={styles.exportBtnText}>Export Word</Text>
                                </>
                            )}
                        </TouchableOpacity>
                    </View>
                </View>

                <Text style={styles.footerNote}>
                    Report generated for {userName || "creator"} · figures reflect data available at the time of viewing.
                </Text>
            </ScrollView>
        </ReusableScreen>
    );
}

// ─── Styles ─────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
    centerFill: { flex: 1, alignItems: "center", justifyContent: "center", gap: 12, padding: 24 },
    loadingText: { fontSize: 13, color: "#6b7280" },
    errorTitle: { fontSize: 14, fontWeight: "600", color: "#374151", textAlign: "center" },
    retryBtn: { backgroundColor: "#1F9F4E", borderRadius: 10, paddingVertical: 10, paddingHorizontal: 20, marginTop: 4 },
    retryBtnText: { color: "#fff", fontWeight: "700", fontSize: 13 },

    header: {
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        backgroundColor: "#fff",
        paddingHorizontal: 16,
        paddingVertical: 12,
        borderBottomWidth: 0.5,
        borderBottomColor: "#e5e7eb",
    },
    backBtn: { width: 32, height: 32, borderRadius: 16, backgroundColor: "#1F9F4E", alignItems: "center", justifyContent: "center" },
    refreshBtn: { width: 32, height: 32, borderRadius: 16, backgroundColor: "#EAF6EE", alignItems: "center", justifyContent: "center" },
    headerTitle: { flex: 1, textAlign: "center", fontSize: 17, fontWeight: "700", color: "#1a1a1a", letterSpacing: -0.2 },

    scroll: { flex: 1, backgroundColor: "#e5ece3ff", margin: 5 },
    scrollContent: { paddingHorizontal: 7, paddingTop: 9, paddingBottom: 30 },

    card: { backgroundColor: "#fff", borderRadius: 16, padding: 12, borderWidth: 1.4, borderColor: "#d9dad9ff", marginBottom: 8 },

    sectionHeaderRow: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 12 },
    sectionIconWrap: { width: 26, height: 26, borderRadius: 8, alignItems: "center", justifyContent: "center" },
    sectionLabel: { fontSize: 13, fontWeight: "700", color: "#1F9F4E", textTransform: "uppercase", letterSpacing: 0.8, flex: 1 },
    fieldHint: { fontSize: 12.5, color: "#6b7280", marginBottom: 12, marginTop: -4 },

    overviewTopRow: { flexDirection: "row", },
    pollLogo: { width: 52, height: 52, borderRadius: 12, backgroundColor: "#f3f4f6" },
    pollLogoPlaceholder: { alignItems: "center", justifyContent: "center", backgroundColor: "#EAF6EE" },
    pollTitle: { maxWidth: 230, fontSize: 14, fontWeight: "700", color: "#1a1a1a", marginBottom: 6 },
    badgeRow: { flexDirection: "row", gap: 6, flexWrap: "wrap" },
    badge: { paddingHorizontal: 9, paddingVertical: 3, borderRadius: 20 },
    badgeActive: { backgroundColor: "#EAF6EE" },
    badgeNeutral: { paddingHorizontal: 9, paddingVertical: 3, borderRadius: 20, backgroundColor: "#f3f4f6" },
    badgeText: { fontSize: 11, fontWeight: "700", color: "#6b7280" },
    badgeTextActive: { color: "#1F9F4E" },

    statRow: { flexDirection: "row", justifyContent: "space-between", marginTop: 4 },
    statBox: { flex: 1, alignItems: "center", paddingHorizontal: 4 },
    statValue: { fontSize: 14, fontWeight: "600", color: "#1F9F4E" },
    statLabel: { fontSize: 11, color: "#9ca3af", marginTop: 2, textAlign: "center" },

    distRow: { marginBottom: 14 },
    distTopRow: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 6 },
    distAvatar: { width: 26, height: 26, borderRadius: 13 },
    distAvatarInitial: { color: "#fff", fontSize: 12, fontWeight: "700" },
    distName: { flex: 1, fontSize: 13.5, fontWeight: "600", color: "#374151" },
    distCount: { fontSize: 12, color: "#6b7280", fontWeight: "600" },
    distBarTrack: { height: 8, borderRadius: 4, backgroundColor: "#f3f4f6", overflow: "hidden" },
    distBarFill: { height: "100%", borderRadius: 4 },
    distPercent: { fontSize: 11, color: "#9ca3af", marginTop: 3, textAlign: "right" },

    insightRow: { flexDirection: "row", alignItems: "flex-start", gap: 8, marginBottom: 8 },
    insightBullet: { width: 6, height: 6, borderRadius: 3, backgroundColor: "#D97706", marginTop: 6 },
    insightText: { flex: 1, fontSize: 13, color: "#374151", lineHeight: 18 },
    insightFootnote: { fontSize: 11, color: "#9ca3af", marginTop: 4, fontStyle: "italic" },

    noticeText: { fontSize: 13, color: "#6b7280", lineHeight: 18 },
    unmatchedNotice: {
        flexDirection: "row",
        alignItems: "flex-start",
        gap: 6,
        backgroundColor: "#FEF6E7",
        borderWidth: 1,
        borderColor: "#F5D999",
        borderRadius: 10,
        padding: 10,
        marginBottom: 10,
    },
    unmatchedNoticeText: { flex: 1, fontSize: 12, lineHeight: 16, color: "#92702a" },

    fieldTabsScroll: { marginBottom: 12 },
    fieldTab: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 20, backgroundColor: "#f3f4f6", marginRight: 8 },
    fieldTabActive: { backgroundColor: "#1F9F4E" },
    fieldTabText: { fontSize: 12.5, fontWeight: "600", color: "#6b7280" },
    fieldTabTextActive: { color: "#fff" },

    crossTabScroll: { borderWidth: 1, borderColor: "#eef0f2", borderRadius: 10 },
    crossTabHeaderRow: { flexDirection: "row", backgroundColor: "#EAF6EE" },
    crossTabHeaderCell: { width: 110, paddingVertical: 9, paddingHorizontal: 10, fontSize: 11.5, fontWeight: "700", color: "#1F9F4E" },
    crossTabFirstCol: { width: 140 },
    crossTabRow: { flexDirection: "row", borderTopWidth: 1, borderTopColor: "#f3f4f6" },
    crossTabRowAlt: { backgroundColor: "#fafbfc" },
    crossTabCell: { width: 110, paddingVertical: 9, paddingHorizontal: 10, fontSize: 12, color: "#374151" },
    crossTabCellLeader: { fontWeight: "800", color: "#1F9F4E", backgroundColor: "#EAF6EE" },
    emptyCrossTabText: { padding: 14, fontSize: 12.5, color: "#9ca3af", fontStyle: "italic" },

    searchRow: {
        flexDirection: "row",
        alignItems: "center",
        gap: 8,
        borderWidth: 1,
        borderColor: "#e0e1e3ff",
        borderRadius: 10,
        paddingHorizontal: 12,
        paddingVertical: 9,
        backgroundColor: "#f0f1f2ff",
        marginBottom: 10,
    },
    searchInput: { flex: 1, fontSize: 13, color: "#1a1a1a", padding: 0 },
    tableMoreText: { fontSize: 11.5, color: "#9ca3af", marginTop: 8, textAlign: "center", fontStyle: "italic" },

    exportRow: { flexDirection: "row", gap: 10 },
    exportBtn: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, borderRadius: 12, paddingVertical: 13 },
    exportBtnPdf: { backgroundColor: "#DC2626" },
    exportBtnWord: { backgroundColor: "#2563EB" },
    exportBtnText: { color: "#fff", fontWeight: "700", fontSize: 13.5 },

    dividerThin: { height: 0.5, backgroundColor: "#f3f4f6", marginVertical: 12 },

    footerNote: { fontSize: 12, color: "#9ca3af", textAlign: "center", marginTop: 10, marginBottom: 10, marginHorizontal: "10%" },
});
