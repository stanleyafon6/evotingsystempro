import React, { useContext, useEffect } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Image,
  Platform,
} from "react-native";
import { Ionicons, Entypo } from "@expo/vector-icons";
import { router, usePathname } from "expo-router";
import { GlobalContext } from "@/context";

// 🔹 Shared hook for profile + presence logic
function useClientProfile() {
  const {
    clientId,
    clientName,
    statusMap,
    watchUserStatus,
    currentUser,
    userProfiles,
  } = useContext(GlobalContext);

  // Watch presence updates
  useEffect(() => {
    if (!clientId || clientId === currentUser?.id) return;
    const unsub = watchUserStatus(clientId);
    return () => unsub && unsub();
  }, [clientId, currentUser, watchUserStatus]);

  // Presence text
  const presence = statusMap?.[clientId];
  let subtitle = "offline";

  if (clientId === currentUser?.id) {
    subtitle = "This is you";
  } else if (presence?.status === "online") {
    subtitle = "online";
  } else if (presence?.lastSeen) {
    const lastSeen = new Date(presence.lastSeen).toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
    });
    subtitle = `last seen at ${lastSeen}`;
  }

  // Name & photo
  const name = clientId === currentUser?.id ? "You" : clientName || clientId;
  const profileImage =
    userProfiles?.[clientId]?.photoURL || require("@/assets/images/image1.jpg");

  return { clientId, name, subtitle, profileImage };
}

// 🔹 Left side: Back button + profile info
export function ClientHeaderProfile() {
  const { name, subtitle, profileImage } = useClientProfile();
  const pathname = usePathname();

  // Works both on native & web
  //On web after refresh, it will return false
  const handleBack = () => {
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace("../chat/members_list");// or wherever your home/index is
    }
  };

  return (
    <View style={styles.left}>
      <TouchableOpacity onPress={handleBack} style={styles.backButton}>
        <Ionicons name="arrow-back" size={22} color="green" />
      </TouchableOpacity>

      <Image
        source={
          typeof profileImage === "string"
            ? { uri: profileImage }
            : profileImage
        }
        style={styles.avatar}
      />

      <View style={styles.info}>
        <Text style={styles.name} numberOfLines={1} ellipsizeMode="tail">
          {name}
        </Text>
        <Text style={styles.status}>{subtitle}</Text>
      </View>
    </View>
  );
}

// 🔹 Right side: Call / Video / Menu buttons
export function ClientCallHeader() {
  const { clientId } = useContext(GlobalContext);

  const handleCall = () => {
    router.push(`../call/`);
  };

  const handleVideo = () => {
    router.push(`../video/${clientId}`);
  };

  return (
    <View style={styles.right}>
      <TouchableOpacity onPress={handleCall} style={styles.iconButton}>
        <Ionicons name="call-outline" size={22} color="#555" />
      </TouchableOpacity>
      <TouchableOpacity onPress={handleVideo} style={styles.iconButton}>
        <Ionicons name="videocam-outline" size={22} color="#555" />
      </TouchableOpacity>
      <TouchableOpacity style={styles.iconButton}>
        <Entypo name="dots-three-vertical" size={18} color="#555" />
      </TouchableOpacity>
    </View>
  );
}

export function ClienName() {
  const { clientId } = useContext(GlobalContext);
  return (
    <View style={styles.right}>
      <Text>{clientId}</Text>
    </View>
  );
}

// 🔹 Styles
const styles = StyleSheet.create({
  left: {
    marginLeft: 10,
    flexDirection: "row",
    alignItems: "center",
    flexShrink: 1,
  },
  backButton: {
    marginRight: 8,
  },
  avatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    marginRight: 10,
    backgroundColor: "#ccc",
  },
  info: {
    flexShrink: 1,
  },
  name: {
    fontSize: 16,
    fontWeight: "600",
    color: "#333",
    maxWidth: 100,
  },
  status: {
    fontSize: 12,
    color: "green",
  },
  right: {
    marginRight: 10,
    flexDirection: "row",
    alignItems: "center",
  },
  iconButton: {
    marginLeft: 18,
  },
});
