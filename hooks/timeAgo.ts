// utils/timeAgo.ts

// ==================== TIME AGO UTILITY ====================
export const timeAgo = (time: any): string => {
    if (!time) return "";

    // ==================== NORMALIZE INPUT ====================
    // Supports Firestore Timestamp, Date, number (ms), or string
    const date =
        time?.toDate?.() ||
        (typeof time === "number" ? new Date(time) : new Date(time));

    const now = new Date();
    const seconds = Math.floor((now.getTime() - date.getTime()) / 1000);

    // ==================== FORMAT HELPERS ====================
    const plural = (value: number, unit: string) =>
        `${value}${unit}${value === 1 ? "" : "s"} ago`;

    // ==================== TIME RULES ====================
    if (seconds < 5) return "Just now";
    if (seconds < 60) return plural(seconds, "sec");

    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return plural(minutes, "min");

    const hours = Math.floor(minutes / 60);
    if (hours < 24) return plural(hours, "hr");

    const days = Math.floor(hours / 24);
    if (days === 1) return "Yesterday";
    if (days < 7) return plural(days, "day");

    // ==================== FALLBACK (OLDER THAN A WEEK) ====================
    return date.toLocaleDateString();
};
