import React, { memo } from "react";
import {
  View,
  Text,
  StyleSheet,
  Image,
  TouchableOpacity,
} from "react-native";
import {
  FontAwesome,
  Ionicons,
} from "@expo/vector-icons";

/** 🕒 Format timestamp into relative time */
const formatRelativeTime = (timestamp?: { seconds: number }) => {
  if (!timestamp?.seconds) return "";

  const date = new Date(timestamp.seconds * 1000);
  const diffInSeconds = (Date.now() - date.getTime()) / 1000;

  const minutes = Math.floor(diffInSeconds / 60);
  const hours = Math.floor(diffInSeconds / 3600);
  const days = Math.floor(diffInSeconds / 86400);

  if (diffInSeconds < 60) return "now";
  if (minutes < 60) return `${minutes} min${minutes > 1 ? "s" : ""} ago`;
  if (hours < 24) return `${hours} hr${hours > 1 ? "s" : ""} ago`;
  if (days === 1) return "yesterday";
  return `${days} days ago`;
};

const MessageItem = (props: {
  id?: any;
  iconUrl?: string;
  imageUrl?: string;
  client_nickname?: string;
  text?: string;
  status?: string;
  reloadStatus?: string;
  timestamp?: any;
  onReply?: any;
  toggleLike?: () => void;
  toggleDislike?: () => void;
  toggleLove?: () => void;
  handleDelete?: () => void;
}) => {
  const relativeTime = formatRelativeTime(props.timestamp);

  return (
    <View style={styles.container}>
      {/* 👤 Avatar */}
      {props.iconUrl ? (
        <Image source={{ uri: props.iconUrl }} style={styles.avatar} />
      ) : (
        <FontAwesome name="user-circle" size={40} color="#bdbdbd" style={styles.avatar} />
      )}

      {/* 💬 Message Content */}
      <View style={styles.contentWrapper}>
        <View style={styles.messageBubble}>

          {/* 🔄 Retry Loader */}
          {props.reloadStatus !== "Sent" && (
            <View style={styles.loaderContainer}>
              <TouchableOpacity
                activeOpacity={0.5}
                style={styles.retryButton}
              >
                <FontAwesome name="upload" size={25} color="#fff" />
                <Text style={styles.retryText}>Retry</Text>
              </TouchableOpacity>
            </View>
          )}

          {/* Message + Media */}
          <View style={{ flexDirection: "column" }}>
            <Text style={styles.senderName}>{props.client_nickname}</Text>

            {props.imageUrl && (
              <View>
                <Image source={{ uri: props.imageUrl }} style={styles.messageImage} />
              </View>

//at-outline
            )}

            {props.text && (
              <View style={styles.messageRow}>
                {/* message bubble content wrapper (relative so icon can be absolute) */}
                <View style={styles.textWithIcon}>
                  <Text style={styles.messageText}>
                    {props.text}
                  </Text>
                </View>
                <View style={{ flexDirection: "row" }}>
                  <Text style={styles.timeLabel}>{relativeTime}{ }</Text>
                  <Ionicons
                    name={
                      props.status === "Sent"
                        ? "checkmark-outline"
                        : props.status === "Delivered"
                          ? "checkmark-done-outline"
                          : props.status === "Read"
                            ? "checkmark-done"
                            : "at-outline"
                    }
                    size={15}
                    color={
                      props.status === "Read"
                        ? "#34B7F1"
                        : props.status === "Sent" || props.status === "Delivered"
                          ? "#9ca3af"
                          : "#999"
                    }
                    style={styles.statusIcon}
                  />
                </View>
              </View>
            )}
          </View>
        </View>

        {/* Footer (time, actions, likes, etc.) */}
        <View style={styles.footerRow}>
          <View style={styles.metaRow}>
            <TouchableOpacity style={styles.metaButton} onPress={props.onReply}>
              <Text style={styles.metaText}>Reply</Text>
            </TouchableOpacity>

            <TouchableOpacity style={styles.iconButton} onPress={props.toggleLike}>
              <Ionicons name="thumbs-up" size={18} color="#666" />
              <Text style={styles.metaText}>0</Text>
            </TouchableOpacity>

            <TouchableOpacity style={styles.iconButton} onPress={props.toggleDislike}>
              <Ionicons name="thumbs-down" size={18} color="#666" />
              <Text style={styles.metaText}>0</Text>
            </TouchableOpacity>

            <TouchableOpacity style={styles.deleteButton} onPress={props.handleDelete}>
              <Ionicons name="trash-outline" size={18} color="#060606ff" />
            </TouchableOpacity>
          </View>

          <TouchableOpacity style={styles.loveButton} onPress={props.toggleLove}>
            <Ionicons name="heart-circle-outline" size={30} color="#666" />
            <Text style={styles.metaText}>0</Text>
          </TouchableOpacity>
        </View>
      </View>
    </View >
  );
};

export default memo(MessageItem);

/** 🎨 Styles */
const styles = StyleSheet.create({
  container: {
    flexDirection: "row",
    alignItems: "flex-start",
    backgroundColor: "#fff",
    paddingVertical: 8,
    paddingHorizontal: 10,
    paddingRight: 20,
    zIndex: 20,
  },
  avatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    marginRight: 3,
  },
  contentWrapper: {
    flex: 1,
  },
  messageBubble: {
    backgroundColor: "#f7f8fa",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#d6d2d2",
    paddingHorizontal: 15,
  },
  senderName: {
    fontSize: 17,
    fontWeight: "800",
    color: "#000",
    marginLeft: 5,
    paddingVertical: 5,
  },
  messageImage: {
    width: "100%",
    height: 230,
    borderWidth: 3,
    borderColor: "#fff",
    borderRadius: 15,
    //marginBottom: 5
    // marginVertical:15,
  },
  timeLabel: {
    fontSize: 12,
    color: "#777",
    zIndex: 20,
    position: "relative", right: 10
  },
  metaRow: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: 8,
    marginBottom: 18,
  },
  metaText: {
    color: "#666",
    fontSize: 14,
    marginLeft: 4,
  },
  metaButton: {
    marginLeft: 12,
  },
  iconButton: {
    flexDirection: "row",
    alignItems: "baseline",
    marginLeft: 8,
  },
  deleteButton: {
    marginLeft: 10,
  },
  loveButton: {
    flexDirection: "row",
    alignItems: "center",
  },
  footerRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  loaderContainer: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 10,
    justifyContent: "center",
    alignItems: "center",
    // backgroundColor: "rgba(34, 33, 33, 0.18)",
    borderRadius: 12,
  },
  retryButton: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "rgba(0,0,0,0.38)",
    paddingVertical: 5,
    paddingHorizontal: 16,
    borderRadius: 50,
  },
  retryText: {
    fontSize: 17,
    color: "#fff",
    marginLeft: 8,
  },

  messageRow: {
    flexDirection: "row",
    width: "100%",
    // backgroundColor: "red",
    alignItems: "flex-end", justifyContent: "space-between",
    flexWrap: "wrap",
    paddingBottom: 10, zIndex: 20,
  },





  /*   messageText: {
      fontSize: 16,
      color: "#000",
      lineHeight: 22,
      paddingBottom: 5,
      marginRight: 2,
    },
  
   */

  iconWrapper: {
    // marginLeft: 13,
    //  display: "flex", // keeps it next to text
    transform: [{ translateY: 4 }], // 👈 visually lowers icon slightly
  }

  ,
  textWithIcon: {
    flex: 1,
    flexDirection: "row",
  },
  /*   textContainer: {
    flexShrink: 1,
    flexWrap: "wrap",
    flexDirection: "row",
    alignItems: "flex-end",
  }, */

  messageText: {
    fontSize: 16,
    color: "#000",
    lineHeight: 22,
    // paddingBottom: 5,
    // no marginRight — icon space handled by paddingRight above
  },

  statusIcon: {
    position: "absolute",
    right: -8,                    // distance from the bubble's right edge
    bottom: -1,                   // push it slightly down (increase to move further down)
    // if you want it even lower: bottom: 6 or 8
  },



});
