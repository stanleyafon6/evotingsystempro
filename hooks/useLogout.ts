import { Platform } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { router } from "expo-router";
import { useAuth } from "@/context/auth";
import { useContext } from "react";
import { GlobalContext } from "@/context";
import { UserStorageKeys } from "./storageKeys";

export function useLogout() {
    const { signOut } = useAuth();
    const {
        userId, setTraditionalAuth
    } = useContext(GlobalContext);

    const logout = async () => {
        try {
            // Safety guard
            if (!userId) {
                await signOut?.();
                router.replace("/");
                return;
            }

            // Firebase/Auth sign out

            setTraditionalAuth({});
            await signOut?.();

            // Clear ONLY user-scoped storage
            const keysToRemove = [
                // auth
                UserStorageKeys.credentials_saved(userId),
                UserStorageKeys.savedUserCredentials(),

                // push
                UserStorageKeys.push_notification_saved(userId),

                // comments & feeds
                UserStorageKeys.commentDataCache(userId),
                UserStorageKeys.pendingComments(userId),
                UserStorageKeys.lastVisibleCommentDocId(userId),
                UserStorageKeys.readComments(userId),
                UserStorageKeys.comment_messages(userId),

                // offline
                UserStorageKeys.offline_comments_cache(userId),
                UserStorageKeys.offline_comments_last_timestamp(userId),

                // members
                UserStorageKeys.memberData(userId),
                UserStorageKeys.CACHED_MEMBERS(userId),
                UserStorageKeys.LAST_MEMBER_CURSOR(userId),

                // scoreboard
                UserStorageKeys.SCOREBOARD_CACHE(userId),
                UserStorageKeys.SCOREBOARD_LAST_CURSOR(userId),
                UserStorageKeys.smartlearners_scoreboard_cache(userId),
                UserStorageKeys.smartlearners_last_doc(userId),
                UserStorageKeys.smartlearners_scores_db2(userId),
                UserStorageKeys.estimatedTotalScore(userId),
                UserStorageKeys.lastTransaction(userId),
                UserStorageKeys.userScores(userId),

                // chat
                UserStorageKeys.chat_cache_saved(userId),
                UserStorageKeys.savedMessages(userId),
                UserStorageKeys.savedMsgIds(userId),
                UserStorageKeys.lastDocId(userId),

                UserStorageKeys.ESTIMATED_SCORE(userId),

                // misc
                UserStorageKeys.dayCounterData(userId),
            ];

            await AsyncStorage.multiRemove(keysToRemove);
            //savedUserCredentials

            //Reset in-memory state

            // ---------------- WEB ----------------
            if (Platform.OS === "web" && typeof window !== "undefined") {

                localStorage.clear();
                sessionStorage.clear();

                document.cookie.split(";").forEach((cookie) => {
                    document.cookie = cookie
                        .replace(/^ +/, "")
                        .replace(/=.*/, `=;expires=${new Date(0).toUTCString()};path=/`);
                });

                /* localStorage.removeItem(UserStorageKeys.savedUserCredentials(userId));
                 localStorage.removeItem(UserStorageKeys.credentials_saved(userId)); */

                window.location.reload();
                return;
            }

            // ---------------- MOBILE ----------------

            router.replace("/");
        } catch (error) {
            console.error("Failed to logout:", error);
        }
    };

    return { logout };
}
