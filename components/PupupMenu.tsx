import React, { useContext } from "react";
import { View, Text, Alert, Platform, Share } from "react-native";
import { Menu, MenuOptions, MenuOption, MenuTrigger } from "react-native-popup-menu";
import { Ionicons, AntDesign, MaterialIcons } from "@expo/vector-icons";
import { router } from "expo-router";
import * as Clipboard from "expo-clipboard";
import { GlobalContext } from "@/context";
import { useLogout } from "@/hooks/useLogout";


export default function PopupMenu() {

  const { logout } = useLogout();

  const {
    userId, app_update_version
  } = useContext(GlobalContext);
  const shareMessage =
    "The best e-voting system for smart people. Discover how here: https://evotingsystempro.expo.app";

  const PupupMenuBuyResetCreditFun = (email: string) => {
    if (!email) { alert("Unable to open purchase screen. Email not found."); return; }
    router.push({ pathname: "/chat/buy_reset_credit_screen", params: { email } });
  };


  const handleShare = async () => {
    try {
      if (Platform.OS === "web") {
        if (navigator.share) {
          await navigator.share({
            title: "Evoting System Pro",
            text: shareMessage,
            url: "https://evotingsystempro.expo.app",
          });
        } else {
          await navigator.clipboard.writeText(shareMessage);
          alert("Link copied!");
        }
        return;
      }
      await Share.share({ message: shareMessage });
    } catch (error) {
      console.log("Share error:", error);
    }
  };

  const handleCopy = async () => {
    try {
      if (Platform.OS === "web") {
        await navigator.clipboard.writeText(shareMessage);
        alert("Copied!");
      } else {
        await Clipboard.setStringAsync(shareMessage);
        Alert.alert("Copied!", "Message copied to clipboard.");
      }
    } catch (err) {
      console.log("Copy error:", err);
    }
  };

  return (
    <Menu>
      <MenuTrigger>
        <Ionicons style={{ marginRight: 5, }} name="ellipsis-vertical" size={25} color="#27af15ff" />
      </MenuTrigger>

      <MenuOptions
        customStyles={{
          optionsContainer: {
            borderRadius: 10,
            minWidth: 230,
            backgroundColor: "#fff",
            shadowColor: "#000",
            shadowOpacity: 0.25,
            shadowRadius: 6,
            shadowOffset: { width: 0, height: 4 },
            elevation: 8,
            right: 0, // aligns menu to left of trigger
            top: 35,  // vertical offset from trigger
          },
        }}
      >
        <MenuOption onSelect={() => router.navigate("./profile")} style={menuStyle.option}>
          <Ionicons name="person-circle-outline" size={20} color="#333" style={menuStyle.icon} />
          <Text style={menuStyle.text}>Wallet</Text>
        </MenuOption>

        <MenuOption onSelect={handleShare} style={menuStyle.option}>
          <AntDesign name="sharealt" size={20} color="#333" style={menuStyle.icon} />
          <Text style={menuStyle.text}>Tell a Friend</Text>
        </MenuOption>

        <MenuOption onSelect={handleCopy} style={menuStyle.option}>
          <Ionicons name="copy-outline" size={20} color="#333" style={menuStyle.icon} />
          <Text style={menuStyle.text}>Tell a Friend (Copy)</Text>
        </MenuOption>

        <MenuOption onSelect={() => router.navigate("./UserTransactionScreen")} style={menuStyle.option}>
          <Ionicons name="trail-sign" size={20} color="#333" style={menuStyle.icon} />
          <Text style={menuStyle.text}>Transactions</Text>
        </MenuOption>

        <MenuOption onSelect={() => router.navigate("./PollsListScreen")} style={menuStyle.option}>
          <Ionicons name="trophy-outline" size={20} color="#333" style={menuStyle.icon} />
          <Text style={menuStyle.text}>Polls</Text>
        </MenuOption>

        {userId === "stanleyafon@gmail.com" ? (<MenuOption onSelect={() => router.navigate("./admin_reset_credit_transaction_screen")} style={[menuStyle.option,]}>
          <MaterialIcons name="admin-panel-settings" size={20} color="#0272a9ff" style={menuStyle.icon} />
          <Text style={[menuStyle.text, { color: "#0272a9ff", fontWeight: "bold" }]}>Admin</Text>
        </MenuOption>) : null}

        <MenuOption style={menuStyle.option}>
          <Ionicons name="logo-vercel" size={20} color="#333" style={menuStyle.icon} />
          {/*  <Text style={menuStyle.text}>Version: {app_update_version}</Text> */}
          <Text style={menuStyle.text}>Version: 1.2.2</Text>
        </MenuOption>

        <View style={menuStyle.divider} />

        <MenuOption onSelect={logout} style={menuStyle.option}>
          <AntDesign name="delete" size={20} color="red" style={menuStyle.icon} />
          <Text style={[menuStyle.text, { color: "red" }]}>Logout</Text>
        </MenuOption>
      </MenuOptions>
    </Menu>
  );
}

const menuStyle = {
  option: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    paddingVertical: 10,
    paddingHorizontal: 12,
  },
  icon: {
    marginRight: 10,
  },
  text: {
    fontSize: 15,
    color: "#333",
  },
  divider: {
    height: 1,
    backgroundColor: "#ddd",
    marginVertical: 5,
  },
};
