// components/ChatBanner.tsx
import React, { useState, useEffect, useContext, useMemo } from "react";
import {
    View,
    Text,
    Image,
    TouchableOpacity,
    StyleSheet,
    Animated,
} from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { router } from "expo-router";
import { GlobalContext } from "@/context/index";
import { useChatListListener } from "@/hooks/useChatListListener";

export default function ChatBanner() {
    const { userId } = useContext(GlobalContext);
    const { contacts } = useChatListListener(userId);

    const unreadChatsCount = useMemo(
        () => contacts.filter((c) => c.unreadCount).length,
        [contacts]
    );

    const TxtMsgId = contacts[0]?.txtMsgId;
    const [dismissedMsgIds, setDismissedMsgIds] = useState<Set<string>>(new Set());

    useEffect(() => {
        AsyncStorage.getItem("DISMISSED_BANNERS").then((val) => {
            if (val) setDismissedMsgIds(new Set(JSON.parse(val)));
        });
    }, []);

    const handleDismissBanner = async () => {
        if (!TxtMsgId) return;
        const updated = new Set(dismissedMsgIds);
        updated.add(TxtMsgId);
        setDismissedMsgIds(updated);
        await AsyncStorage.setItem("DISMISSED_BANNERS", JSON.stringify([...updated]));
    };

    const navigateToChatRoom = () => {
        handleDismissBanner();
        router.navigate({
            pathname: "/chat/chat_room",
            params: {
                clientName: contacts[0]?.peerName,
                clientIconUri: contacts[0]?.peerIconUrl,
                clientEmail: contacts[0]?.peerEmail,
            },
        });
    };

    const shouldShowBanner = unreadChatsCount > 0 && !dismissedMsgIds.has(TxtMsgId);

    if (!shouldShowBanner) return null;

    return (
        <Animated.View style={styles.banner}>
            <TouchableOpacity onPress={navigateToChatRoom} activeOpacity={1} style={styles.inner}>

                {/* AVATAR */}
                <View style={styles.avatarWrap}>
                    <View style={styles.avatarRing}>
                        <View style={styles.avatarImgWrap}>
                            <Image
                                source={{ uri: contacts[0]?.peerIconUrl }}
                                style={{ width: "100%", height: "100%", borderRadius: 50 }}
                                resizeMode="cover"
                            />
                            <Image
                                source={require("@/assets/images/userImagePlaceHolder.png")}
                                style={styles.avatarImg}
                                resizeMode="cover"
                            />
                        </View>
                    </View>
                    <View style={styles.onlineDot} />
                </View>

                {/* TEXT */}
                <View style={styles.textWrap}>
                    <Text style={styles.name} numberOfLines={1}>
                        Sender: {contacts[0]?.peerName}
                    </Text>
                    <Text style={styles.msg} numberOfLines={1}>
                        Message: {contacts[0]?.lastMessage}
                    </Text>
                </View>

                {/* ACTIONS */}
                <View style={styles.actions}>
                    <Text style={styles.time}>now</Text>
                    <TouchableOpacity
                        onPress={(e) => {
                            e.stopPropagation();
                            handleDismissBanner();
                        }}
                        style={styles.dismissBtn}
                    >
                        <Text style={styles.dismissText}>✕</Text>
                    </TouchableOpacity>
                </View>

            </TouchableOpacity>
        </Animated.View>
    );
}

const styles = StyleSheet.create({
    banner: {
        position: "absolute",
        top: 8, left: 12, right: 12,
        zIndex: 9999,
        backgroundColor: "rgba(0, 0, 0, 1)",
        borderRadius: 20,
        borderWidth: 0.5,
        borderColor: "rgba(255,255,255,0.1)",
        paddingHorizontal: 14, paddingVertical: 10,
        shadowColor: "#000",
        shadowOpacity: 0.4,
        shadowOffset: { width: 0, height: 6 },
        shadowRadius: 16,
        elevation: 10,
    },
    inner: { flexDirection: "row", alignItems: "center", gap: 10 },
    avatarWrap: { position: "relative" },
    avatarRing: {
        width: 48, height: 48, borderRadius: 24,
        borderWidth: 2, borderColor: "#1ad201ff",
        padding: 3, alignItems: "center", justifyContent: "center",
    },
    avatarImgWrap: { width: "100%", height: "100%", borderRadius: 22, overflow: "hidden" },
    avatarImg: { width: "100%", height: "100%" },
    onlineDot: {
        position: "absolute", bottom: 1, right: 1,
        width: 13, height: 13, borderRadius: 7,
        backgroundColor: "#25d366", borderWidth: 2,
        borderColor: "rgba(22,22,22,0.97)",
    },
    textWrap: { flex: 1 },
    name: { fontSize: 16, fontWeight: "500", color: "#fff" },
    msg: { fontSize: 14, color: "#ccc", marginTop: 2 },
    actions: { alignItems: "flex-end", gap: 10 },
    time: { fontSize: 15, color: "#1eff00ff" },
    dismissBtn: {
        borderWidth: 1,
        borderColor: "#555",
        paddingHorizontal: 5,
        paddingVertical: 3,
    },
    dismissText: { fontSize: 18, color: "#1eff00ff", fontWeight: "900" },
});