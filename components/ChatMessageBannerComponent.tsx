// components/MessageBanner.tsx
import React, { useEffect, useRef, useState } from "react";
import {
  Animated, TouchableOpacity, View,
  Text, Image, StyleSheet, Platform,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";

export type BannerMessage = {
  senderName: string;
  senderEmail: string;
  senderPhoto?: string;
  senderLetter?: string;
  senderColor?: string;
  text: string;
};

type Props = {
  message: BannerMessage | null;
  onReply: () => void;
  onDismiss: () => void;
};

export default function ChatMessageBannerComponent({ message, onReply, onDismiss }: Props) {
  const translateY = useRef(new Animated.Value(-200)).current;
  const opacity = useRef(new Animated.Value(0)).current;
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [mounted, setMounted] = useState(false); // ✅ triggers re-render unlike useRef

  useEffect(() => {
    if (!message) {
      slideOut();
      return;
    }
    setMounted(true); // ✅ mount before animating in
    slideIn();
    timerRef.current = setTimeout(() => slideOut(), 5000);
    return () => { if (timerRef.current) clearTimeout(timerRef.current); };
  }, [message]);

  const slideIn = () =>
    Animated.parallel([
      Animated.spring(translateY, {
        toValue: Platform.OS === "ios" ? 54 : 14,
        damping: 15, mass: 0.8, stiffness: 180,
        useNativeDriver: true,
      }),
      Animated.timing(opacity, {
        toValue: 1, duration: 250,
        useNativeDriver: true,
      }),
    ]).start();

  const slideOut = () =>
    Animated.parallel([
      Animated.timing(translateY, {
        toValue: -200, duration: 280,
        useNativeDriver: true,
      }),
      Animated.timing(opacity, {
        toValue: 0, duration: 200,
        useNativeDriver: true,
      }),
    ]).start(() => {
      setMounted(false); // ✅ triggers re-render → return null fires correctly
    });

  const handleReply = () => {
    if (timerRef.current) clearTimeout(timerRef.current);
    slideOut();
    setTimeout(onReply, 300);
  };

  const handleDismiss = () => {
    if (timerRef.current) clearTimeout(timerRef.current);
    slideOut();
    setTimeout(onDismiss, 300);
  };

  // ✅ Truly unmounts after slide-out animation completes
  if (!mounted && !message) return null;

  return (
    <Animated.View
      pointerEvents={message ? "auto" : "none"}
      style={[styles.banner, { transform: [{ translateY }], opacity }]}
    >
      {/* CLOSE BUTTON */}
      <TouchableOpacity style={styles.closeBtn} onPress={handleDismiss}>
        <Ionicons name="close-circle" size={22} color="#ccc" />
      </TouchableOpacity>

      {/* HEADER ROW */}
      <View style={styles.headerRow}>
        <View style={styles.avatarWrap}>
          {message?.senderPhoto ? (
            <Image source={{ uri: message.senderPhoto }} style={styles.avatar} />
          ) : (
            <View style={[
              styles.avatar,
              styles.avatarFallback,
              { backgroundColor: message?.senderColor || "#fe2c55" },
            ]}>
              <Text style={styles.avatarLetter}>
                {message?.senderLetter || message?.senderName?.[0]?.toUpperCase() || "?"}
              </Text>
            </View>
          )}
          <View style={styles.onlineDot} />
        </View>

        <View style={styles.headerText}>
          <View style={styles.badgeRow}>
            <View style={styles.badge}>
              <Text style={styles.badgeText}>New message</Text>
            </View>
            <Text style={styles.time}>now</Text>
          </View>
          <Text style={styles.name} numberOfLines={1}>
            {message?.senderName}
          </Text>
          <Text style={styles.email} numberOfLines={1}>
            {message?.senderEmail}
          </Text>
        </View>
      </View>

      {/* MESSAGE PREVIEW */}
      <View style={styles.msgBox}>
        <Text style={styles.msgText} numberOfLines={2}>
          {message?.text}
        </Text>
      </View>

      {/* ACTION BUTTONS */}
      <View style={styles.actions}>
        <TouchableOpacity style={styles.dismissBtn} onPress={handleDismiss} activeOpacity={0.8}>
          <Text style={styles.dismissText}>Dismiss</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.replyBtn} onPress={handleReply} activeOpacity={0.8}>
          <Ionicons name="arrow-undo-outline" size={14} color="#fff" />
          <Text style={styles.replyText}>Reply</Text>
        </TouchableOpacity>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  banner: {
    position: "absolute",
    top: 0, left: 12, right: 12,
    zIndex: 9999,
    backgroundColor: "#fff",
    borderRadius: 20,
    borderWidth: 0.5,
    borderColor: "#e5e5e5",
    padding: 14,
    shadowColor: "#000",
    shadowOpacity: 0.12,
    shadowOffset: { width: 0, height: 6 },
    shadowRadius: 16,
    elevation: 10,
  },
  closeBtn: {
    position: "absolute",
    top: 10, right: 10,
    zIndex: 10,
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    marginBottom: 10,
    marginRight: 28,
  },
  avatarWrap: { position: "relative" },
  avatar: { width: 48, height: 48, borderRadius: 24 },
  avatarFallback: { alignItems: "center", justifyContent: "center" },
  avatarLetter: { color: "#fff", fontSize: 20, fontWeight: "500" },
  onlineDot: {
    position: "absolute", bottom: 1, right: 1,
    width: 13, height: 13, borderRadius: 7,
    backgroundColor: "#25d366",
    borderWidth: 2, borderColor: "#fff",
  },
  headerText: { flex: 1 },
  badgeRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8, marginBottom: 3,
  },
  badge: {
    backgroundColor: "#fff0f3",
    borderRadius: 20,
    paddingHorizontal: 8, paddingVertical: 2,
    borderWidth: 0.5,
    borderColor: "#ffc0cb",
  },
  badgeText: { fontSize: 11, color: "#fe2c55", fontWeight: "500" },
  time: { fontSize: 11, color: "#aaa" },
  name: { fontSize: 15, fontWeight: "500", color: "#111" },
  email: { fontSize: 11, color: "#aaa", marginTop: 1 },
  msgBox: {
    backgroundColor: "#f7f7f7",
    borderRadius: 12,
    padding: 10,
    marginBottom: 12,
    borderWidth: 0.5,
    borderColor: "#efefef",
  },
  msgText: { fontSize: 13, color: "#555", lineHeight: 19 },
  actions: { flexDirection: "row", gap: 8 },
  dismissBtn: {
    flex: 1,
    paddingVertical: 8,
    borderRadius: 10,
    borderWidth: 0.5,
    borderColor: "#e0e0e0",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#f9f9f9",
  },
  dismissText: { fontSize: 13, color: "#999", fontWeight: "500" },
  replyBtn: {
    flex: 1,
    flexDirection: "row",
    paddingVertical: 8,
    borderRadius: 10,
    backgroundColor: "#fe2c55",
    alignItems: "center",
    justifyContent: "center",
    gap: 5,
  },
  replyText: { fontSize: 13, color: "#fff", fontWeight: "500" },
});