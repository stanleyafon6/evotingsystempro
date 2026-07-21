import { useEffect, useRef } from "react";
import { AppState, Platform } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { doc, serverTimestamp, setDoc } from "firebase/firestore";
import { db } from "@/firebase";
import { registerForPushNotifications } from "@/hooks/notifications";
import { UserStorageKeys } from "@/hooks/storageKeys";

/**
 * MUST MATCH backend VAPID public key EXACTLY
 */
const VAPID_PUBLIC_KEY =
    "BL1dK5OssbM41dRs6pUPlWlTx1WBi7yvHua6VCymQMbx5YqL15mezBdvJPasBcPgDyDhWF0Uu3MJP8ACxW_Gfmw";

function urlBase64ToUint8Array(base64String: string): Uint8Array {
    const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
    const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
    const rawData = atob(base64);
    return Uint8Array.from(rawData, (c) => c.charCodeAt(0));
}

/**
 * usePushNotification
 *
 * Registers the current device and saves the push token to Firestore under:
 *   push_notifications_db / {userId} / pushTokens / { android | ios | web }
 *
 * userId doubles as the Firestore document ID (it's the user's email in this app).
 *
 * Usage:
 *   usePushNotification(user.email);   // e.g. "akonnorprince23@gmail.com"
 */
export function usePushNotification(userId?: string) {
    const mountedRef = useRef(true);
    const hasRunRef = useRef<string | null>(null);

    useEffect(() => {
        if (!userId) return;
        if (hasRunRef.current === userId) return;

        hasRunRef.current = userId;
        mountedRef.current = true;

        const saveToken = async () => {
            try {
                // ── MOBILE (FCM) ────────────────────────────────────────────────────
                if (Platform.OS !== "web") {
                    const alreadyRegistered = await AsyncStorage.getItem(
                        UserStorageKeys.push_notification_saved(userId)
                    );

                    if (alreadyRegistered) {
                        console.log("🔁 Push token already registered — skipping");
                        return;
                    }

                    const token = await registerForPushNotifications(userId);
                    if (!token || !mountedRef.current) return;

                    const platformKey = Platform.OS === "android" ? "android" : "ios";

                    // userId IS the Firestore doc ID (email)
                    await setDoc(
                        doc(db, "push_notifications_db", userId),
                        {
                            pushTokens: { [platformKey]: token },
                            updatedAt: serverTimestamp(),
                        },
                        { merge: true }
                    );

                    await AsyncStorage.setItem(
                        UserStorageKeys.push_notification_saved(userId),
                        "true"
                    );

                    console.log(`✅ Push token saved [${platformKey}] for ${userId}`);
                    return;
                }

                // ── WEB PUSH ────────────────────────────────────────────────────────
                // Always re-subscribe — web subscriptions expire silently
                if (!("serviceWorker" in navigator) || !("PushManager" in window)) return;

                const registration = await navigator.serviceWorker.register("/sw.js");
                await navigator.serviceWorker.ready;

                const permission = await Notification.requestPermission();
                if (permission !== "granted") {
                    console.warn("❌ Notification permission denied");
                    return;
                }

                let subscription = await registration.pushManager.getSubscription();
                if (!subscription) {
                    subscription = await registration.pushManager.subscribe({
                        userVisibleOnly: true,
                        applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
                    });
                }

                if (!mountedRef.current) return;

                // userId IS the Firestore doc ID (email)
                await setDoc(
                    doc(db, "push_notifications_db", userId),
                    {
                        pushTokens: { web: subscription.toJSON() },
                        updatedAt: serverTimestamp(),
                    },
                    { merge: true }
                );

                console.log(`✅ Web push subscription saved for ${userId}`);
            } catch (err) {
                console.error("❌ Push registration error:", err);
            }
        };

        saveToken();

        // Refresh on mobile foreground — handles FCM token rotation
        const appStateSubscription = AppState.addEventListener("change", (state) => {
            if (state === "active" && Platform.OS !== "web") saveToken();
        });

        return () => {
            mountedRef.current = false;
            appStateSubscription.remove();
        };
    }, [userId]);
}
