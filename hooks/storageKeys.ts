//storageKeys.ts
/**
 * Storage Key Registry
 * --------------------
 * Rules:
 * - App keys → survive logout
 * - User keys → namespaced by userId
 * - Never hardcode strings elsewhere
 */

const VERSION = "v1";

export const AppStorageKeys = {
    onboardingComplete: `app:onboarding:${VERSION}`,
    theme: `app:theme:${VERSION}`,
    appVersion: `app:version:${VERSION}`,
};

export const UserStorageKeys = {
    credentials_saved: (userId: string) =>
        `user:${userId}:credentials:${VERSION}`,

    push_notification_saved: (userId: string) =>
        `user:${userId}:push_notification_saved:${VERSION}`,

    commentDataCache: (userId: string) =>
        `user:${userId}:commentDataCache:${VERSION}`,

    pendingComments: (userId: string) =>
        `user:${userId}:pendingComments:${VERSION}`,

    lastVisibleCommentDocId: (userId: string) =>
        `user:${userId}:lastVisibleCommentDocId:${VERSION}`,

    dayCounterData: (userId: string) =>
        `user:${userId}:dayCounterData:${VERSION}`,

    readComments: (userId: string) =>
        `user:${userId}:readComments:${VERSION}`,

    memberData: (userId: string) =>
        `user:${userId}:memberData:${VERSION}`,

    xxx: (userId: string) =>
        `user:${userId}:xxx:${VERSION}`,

    lastTransaction: (userId: string) =>
        `user:${userId}:lastTransaction:${VERSION}`,

    estimatedTotalScore: (userId: string) =>
        `user:${userId}:estimatedTotalScore:${VERSION}`,

    savedUserCredentials: () =>
        `savedUserCredentials`,

    SCOREBOARD_CACHE: (userId: string) =>
        `user:${userId}:SCOREBOARD_CACHE:${VERSION}`,

    SCOREBOARD_LAST_CURSOR: (userId: string) =>
        `user:${userId}:SCOREBOARD_LAST_CURSOR:${VERSION}`,

    offline_comments_cache: (userId: string) =>
        `user:${userId}:offline_comments_cache:${VERSION}`,

    offline_comments_last_timestamp: (userId: string) =>
        `user:${userId}:offline_comments_last_timestamp:${VERSION}`,

    CACHED_MEMBERS: (userId: string) =>
        `user:${userId}:CACHED_MEMBERS:${VERSION}`,

    LAST_MEMBER_CURSOR: (userId: string) =>
        `user:${userId}:LAST_MEMBER_CURSOR:${VERSION}`,

    savedMessages: (userId: string) =>
        `user:${userId}:savedMessages:${VERSION}`,

    savedMsgIds: (userId: string) =>
        `user:${userId}:savedMsgIds:${VERSION}`,

    lastDocId: (userId: string) =>
        `user:${userId}:lastDocId:${VERSION}`,

    smartlearners_scoreboard_cache: (userId: string) =>
        `user:${userId}:smartlearners_scoreboard_cache:${VERSION}`,

    smartlearners_last_doc: (userId: string) =>
        `user:${userId}:smartlearners_last_doc:${VERSION}`,

    smartlearners_scores_db2: (userId: string) =>
        `user:${userId}:smartlearners_scores_db2:${VERSION}`,

    comment_messages: (userId: string) =>
        `user:${userId}:comment_messages:${VERSION}`,

    chat_cache_saved: (userId: string) =>
        `user:${userId}:chat_cache_saved:${VERSION}`,


    userScores: (userId: string) =>
        `user:${userId}:userScores:${VERSION}`,

    ESTIMATED_SCORE: (userId: string) =>
        `user:${userId}:ESTIMATED_SCORE:${VERSION}`,


    settings_saved: (userId: string) =>
        `user:${userId}:settings:${VERSION}`,
};
