// hooks/device_uuid.ts
import { Platform } from "react-native";
import * as Crypto from "expo-crypto";

let SecureStore: typeof import("expo-secure-store") | null = null;

// Dynamically import SecureStore ONLY on native
if (Platform.OS !== "web") {
  SecureStore = require("expo-secure-store");
}

export const getDeviceId = async (): Promise<string> => {
  const KEY = "device_uuid";

  // ---- WEB FALLBACK ----
  if (Platform.OS === "web") {
    let id = localStorage.getItem(KEY);

    if (!id) {
      id = Crypto.randomUUID();
      localStorage.setItem(KEY, id);
    }

    return id;
  }

  // ---- NATIVE (iOS / Android) ----
  let id = await SecureStore!.getItemAsync(KEY);

  if (!id) {
    id = Crypto.randomUUID();
    await SecureStore!.setItemAsync(KEY, id);
  }

  return id;
};
