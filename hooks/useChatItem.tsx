// components/ChatItem.tsx
import React, { useCallback } from "react";
import {
    View,
    Text,
    TouchableOpacity,
    StyleSheet,
    Platform,
} from "react-native";
import { Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";
import Animated, {
    useAnimatedStyle,
    useSharedValue,
    withSpring,
    runOnJS,
} from "react-native-reanimated";
import { Gesture, GestureDetector } from "react-native-gesture-handler";

// ─────────────────────────────────────────────
const isWeb = Platform.OS === "web";

// ─────────────────────────────────────────────
export const statusIcons: { [key: string]: JSX.Element } = {
    Sent: <Ionicons name="checkmark" size={15} color="#555" />,
    Sending: <Ionicons name="time-outline" size={15} color="#777" />,
    Failed: <Ionicons name="close" size={15} color="#f44336" />,
    Pending: <Ionicons name="time" size={15} color="#999" />,
    Read: <MaterialCommunityIcons name="check-all" size={15} color="#3076e8ff" />,
    Delivered: <Ionicons name="checkmark-done" size={15} color="#333" />,
};

// ─────────────────────────────────────────────
// WEB SWIPE HOOK
// ─────────────────────────────────────────────
function useWebSwipe(
    translateX: Animated.SharedValue<number>,
    onSwipeTriggered: () => void
) {
    const startXRef = React.useRef(0);
    const startYRef = React.useRef(0);
    const isSwipingRef = React.useRef(false);
    const isMouseDownRef = React.useRef(false);
    const currentDxRef = React.useRef(0);

    const handleTouchStart = (e: any) => {
        const t = e.touches[0];
        startXRef.current = t.clientX;
        startYRef.current = t.clientY;
        isSwipingRef.current = false;
        currentDxRef.current = 0;
    };

    const handleTouchMove = (e: any) => {
        const t = e.touches[0];
        const dx = t.clientX - startXRef.current;
        const dy = t.clientY - startYRef.current;
        if (!isSwipingRef.current) {
            if (Math.abs(dx) > 10 && Math.abs(dx) > Math.abs(dy) * 1.5) {
                isSwipingRef.current = true;
            } else if (Math.abs(dy) > 10) {
                return;
            } else {
                return;
            }
        }
        e.preventDefault();
        currentDxRef.current = dx;
        const clamped = Math.max(-120, Math.min(dx * 0.6, 120));
        translateX.value = clamped;
    };

    const handleTouchEnd = () => {
        if (Math.abs(currentDxRef.current) > 70) onSwipeTriggered();
        translateX.value = withSpring(0, { damping: 15, stiffness: 150 });
        isSwipingRef.current = false;
        currentDxRef.current = 0;
    };

    const handleMouseDown = (e: any) => {
        if (e.button !== 0) return;
        startXRef.current = e.clientX;
        startYRef.current = e.clientY;
        isMouseDownRef.current = true;
        isSwipingRef.current = false;
        currentDxRef.current = 0;
    };

    const handleMouseMove = (e: any) => {
        if (!isMouseDownRef.current) return;
        const dx = e.clientX - startXRef.current;
        const dy = e.clientY - startYRef.current;
        if (!isSwipingRef.current) {
            if (Math.abs(dx) > 8 && Math.abs(dx) > Math.abs(dy) * 1.2) {
                isSwipingRef.current = true;
                if (typeof document !== "undefined") {
                    document.body.style.cursor = "grabbing";
                    document.body.style.userSelect = "none";
                }
            } else if (Math.abs(dy) > 8) {
                isMouseDownRef.current = false;
                return;
            } else {
                return;
            }
        }
        currentDxRef.current = dx;
        const clamped = Math.max(-120, Math.min(dx * 0.55, 120));
        translateX.value = clamped;
    };

    const handleMouseUp = (e: any) => {
        if (!isMouseDownRef.current) return;
        isMouseDownRef.current = false;
        if (typeof document !== "undefined") {
            document.body.style.cursor = "";
            document.body.style.userSelect = "";
        }
        if (isSwipingRef.current && Math.abs(currentDxRef.current) > 65) onSwipeTriggered();
        translateX.value = withSpring(0, { damping: 15, stiffness: 150 });
        isSwipingRef.current = false;
        currentDxRef.current = 0;
    };

    const handleMouseLeave = (e: any) => {
        if (!isMouseDownRef.current) return;
        if (e.buttons === 0) handleMouseUp(e);
    };

    return {
        handleTouchStart, handleTouchMove, handleTouchEnd,
        handleMouseDown, handleMouseMove, handleMouseUp, handleMouseLeave,
    };
}

// ─────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────
export interface ChatItemProps {
    item: any;
    userName: string;
    clientName: string;
    setReplyTo: (item: any) => void;
    getMessageTime: (timestamp: any) => string;
    scrollToMessage?: (msgId: string) => void;
    highlightedId: string | null;
}

// ─────────────────────────────────────────────
// CHAT ITEM
// ─────────────────────────────────────────────
const ChatItem = React.memo(
    ({
        item,
        userName,
        clientName,
        setReplyTo,
        getMessageTime,
        scrollToMessage,
        highlightedId,
    }: ChatItemProps) => {
        const translateX = useSharedValue(0);
        const startX = useSharedValue(0);
        const startY = useSharedValue(0);

        const triggerReply = useCallback(() => setReplyTo(item), [item]);

        const {
            handleTouchStart, handleTouchMove, handleTouchEnd,
            handleMouseDown, handleMouseMove, handleMouseUp, handleMouseLeave,
        } = useWebSwipe(translateX, triggerReply);

        const panGesture = Gesture.Pan()
            .manualActivation(true)
            .shouldCancelWhenOutside(true)
            .simultaneousWithExternalGesture()
            .failOffsetY([-8, 8])
            .activeOffsetX([20, 999])
            .onTouchesDown((e) => {
                "worklet";
                const t = e.changedTouches[0];
                if (!t) return;
                startX.value = t.x;
                startY.value = t.y;
            })
            .onTouchesMove((e, state) => {
                "worklet";
                const t = e.changedTouches[0];
                if (!t) return;
                const dx = t.x - startX.value;
                const dy = t.y - startY.value;
                if (dx > 15 && Math.abs(dx) > Math.abs(dy)) state.activate();
            })
            .onUpdate((e) => {
                "worklet";
                let tx = e.translationX;
                if (tx < 0) tx = 0;
                translateX.value = Math.min(tx * 0.6, 100);
            })
            .onEnd((e) => {
                "worklet";
                if (e.translationX > 70 || e.velocityX > 800) runOnJS(setReplyTo)(item);
                translateX.value = withSpring(0, { damping: 15, stiffness: 150 });
            });

        const isValid =
            (item?.username === userName && item?.clientname === clientName) ||
            (item?.username === clientName && item?.clientname === userName);
        if (!isValid) return null;

        const isOutgoing = item?.username === userName;
        const isHighlighted = item.txtMsgId === highlightedId;

        const animatedStyle = useAnimatedStyle(() => ({
            transform: [{ translateX: translateX.value }],
        }));

        const content = (
            <View style={[styles.row, { justifyContent: isOutgoing ? "flex-end" : "flex-start" }]} >
                <View style={[styles.bubble, isOutgoing ? styles.outgoing : styles.incoming]}>
                    {
                        item.replyTo && (
                            <TouchableOpacity
                                activeOpacity={0.7}
                                onPress={() => item.replyTo?.txtMsgId && scrollToMessage?.(item.replyTo.txtMsgId)}
                            >
                                <View style={
                                    {
                                        borderLeftWidth: 3, borderLeftColor: "#23c6d2e7", paddingLeft: 6,
                                        backgroundColor: item.clientname === userName ? "#a4e4f622" : "#f4fbfd81",
                                        marginBottom: 4, padding: 5, borderRadius: 10,
                                    }
                                }>
                                    <Text style={{ fontSize: 11, color: "#068d97f5", fontWeight: "700", marginBottom: 1 }}>
                                        {item.replyTo.username === userName ? "You" : item.replyTo.username}
                                    </Text>
                                    < Text style={{ fontSize: 13, color: "#555" }} numberOfLines={1} >
                                        {item.replyTo.text}
                                    </Text>
                                </View>
                            </TouchableOpacity>
                        )}
                    <Text style={styles.text}>
                        {item?.text || <Text style={styles.loading}> loading…</Text>}
                    </Text>
                    < View style={styles.footer} >
                        <Text style={styles.time}> {getMessageTime(item?.timestamp)} </Text>
                        {isOutgoing && statusIcons[item?.status]}
                    </View>
                </View>
            </View>
        );

        if (isWeb) {
            return (
                <View style={{ touchAction: "pan-y" } as any
                }>
                    <Animated.View
                        style={[animatedStyle, isHighlighted && styles.highlighted]}
                        onTouchStart={handleTouchStart}
                        onTouchMove={handleTouchMove}
                        onTouchEnd={handleTouchEnd}
                        {...({
                            onMouseDown: handleMouseDown,
                            onMouseMove: handleMouseMove,
                            onMouseUp: handleMouseUp,
                            onMouseLeave: handleMouseLeave,
                            onDragStart: (e: any) => e.preventDefault(),
                        } as any)
                        }
                    >
                        {content}
                    </Animated.View>
                </View>
            );
        }

        return (
            <GestureDetector gesture={panGesture} >
                <Animated.View style={[animatedStyle, isHighlighted && styles.highlighted]}>
                    {content}
                </Animated.View>
            </GestureDetector>
        );
    },
    (prev, next) =>
        prev.item === next.item &&
        prev.userName === next.userName &&
        prev.clientName === next.clientName &&
        prev.highlightedId === next.highlightedId
);

export default ChatItem;

// ─────────────────────────────────────────────
const styles = StyleSheet.create({
    row: { flexDirection: "row", marginVertical: 4, marginHorizontal: 8 },
    bubble: { maxWidth: "90%", paddingVertical: 6, paddingHorizontal: 10, borderRadius: 17, borderWidth: 1 },
    outgoing: {
        backgroundColor: "#23c6d25c", borderBottomRightRadius: 4, borderColor: "#ffffff",
        shadowColor: "#000", shadowOpacity: 0.05, shadowRadius: 1, shadowOffset: { width: 0, height: 2 }, elevation: 1,
    },
    incoming: {
        backgroundColor: "#fff", borderBottomLeftRadius: 4, borderWidth: 0.5, borderColor: "#eee",
        shadowColor: "#000", shadowOpacity: 0.08, shadowRadius: 2, shadowOffset: { width: 0, height: 1 }, elevation: 1,
    },
    text: { color: "#000", fontSize: 16, lineHeight: 20 },
    loading: { fontSize: 12, color: "#999" },
    footer: { flexDirection: "row", alignItems: "center", alignSelf: "flex-end", marginTop: 4 },
    time: { fontSize: 11, color: "#666", marginRight: 4 },
    highlighted: { backgroundColor: "#fff3cd", borderRadius: 10 },
});
