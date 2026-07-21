// hooks/notifications.ts
import * as Notifications from "expo-notifications";
import * as Device from "expo-device";
import { Platform } from "react-native";
import { db } from "@/firebase";
import { doc, setDoc, serverTimestamp } from "firebase/firestore";

/**
 * ===========================
 * FOREGROUND NOTIFICATION HANDLER
 * Applies globally for all platforms
 * ===========================
 */
Notifications.setNotificationHandler({
    handleNotification: async () => ({
        shouldShowAlert: true,   // Show banner alert
        shouldPlaySound: true,   // Play default sound
        shouldSetBadge: false,   // Optional badge
    }),
});

/**
 * Registers the device for push notifications
 * - Android → FCM token + notification channel
 * - iOS → APNs token
 * - Web → Web push token
 * 
 * Saves the token to Firestore under `push_notifications_db`
 */
export async function registerForPushNotifications(userId: string | null) {
    if (!userId) return null;

    // Only physical devices for native push
    if ((Platform.OS === "android" || Platform.OS === "ios") && !Device.isDevice) {
        console.warn("Push notifications require a physical device on Android/iOS.");
        return null;
    }

    // Request permissions
    let finalStatus: Notifications.PermissionStatus;
    if (Platform.OS === "web") {
        const { status } = await Notifications.requestPermissionsAsync();
        finalStatus = status;
    } else {
        const { status: existingStatus } = await Notifications.getPermissionsAsync();
        finalStatus =
            existingStatus === "granted"
                ? existingStatus
                : (await Notifications.requestPermissionsAsync()).status;
    }

    if (finalStatus !== "granted") {
        console.warn("Push permission not granted");
        return null;
    }

    // Get device push token
    let token: string | null = null;
    try {
        token = (await Notifications.getDevicePushTokenAsync()).data;
        console.log(`Push token (${Platform.OS}):`, token);

        // Android → setup default notification channel
        if (Platform.OS === "android") {
            await Notifications.setNotificationChannelAsync("default", {
                name: "default",
                importance: Notifications.AndroidImportance.MAX,
                vibrationPattern: [0, 250, 250, 250],
                sound: "default",
            });
        }

        // Save token to Firestore
        if (token) {
            const platformKey =
                Platform.OS === "android"
                    ? "android"
                    : Platform.OS === "ios"
                        ? "ios"
                        : "web";

            await setDoc(
                doc(db, "push_notifications_db", userId),
                {
                    pushTokens: { [platformKey]: token },
                    updatedAt: serverTimestamp(),
                },
                { merge: true }
            );

            console.log(`Push token saved for ${platformKey}`);
        }
    } catch (err) {
        console.error("Failed to register for push notifications:", err);
    }

    return token;
}
