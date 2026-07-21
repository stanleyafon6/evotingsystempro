import React, {
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  ActivityIndicator,
  FlatList,
  Image,
  Keyboard,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { router, useFocusEffect } from 'expo-router';
import {
  GestureHandlerRootView,
  Swipeable,
} from 'react-native-gesture-handler';
import { GlobalContext } from '@/context/index';
import ReusableScreen from '@/components/ReusableScreen';
import { useChatListListener } from '@/hooks/useChatListListener';
import PopupMenu from '@/components/PupupMenu';
import { MenuProvider } from 'react-native-popup-menu';

// ─── Constants ────────────────────────────────────────────────────────────────

const IS_IOS = Platform.OS === 'ios';

const AVATAR_PALETTE = [
  '#c44b00', '#0077a8', '#b34400', '#005f80',
  '#7a2200', '#0097b2', '#e05a00', '#00687a',
  '#8b2500', '#004f6b',
];

// ─── Brand colours ────────────────────────────────────────────────────────────

const C = {
  orange: '#f98304',
  orangeLight: '#ff9e3d',
  orangeFaint: '#fff8f2',
  blue: '#0097b2',
  green: '#22c55e',
  white: '#ffffff',
  ash: '#f5f6f8',
  ashDark: '#e8eaed',
  grey: '#9ca3af',
  greyMid: '#6b7280',
  greyDark: '#374151',
  black: '#111827',
  divider: '#f0f0f0',
  bubbleBg: '#f5f6f8',
};

// ─── Types ────────────────────────────────────────────────────────────────────

type MessageStatus = 'Sending' | 'Sent' | 'Delivered' | 'Read' | 'Failed' | 'Agent';
type MessageType = 'text' | 'image' | 'file' | 'deleted';
type TabKey = 'all' | 'unread' | 'groups';

interface RawChatDoc {
  txtMsgId: string;
  chatId: string;
  username: string;
  clientname: string;
  useremail: string;
  clientemail: string;
  userIconUrl: string;
  clientIconUrl: string;
  text: string;
  timestamp: any;
  status: MessageStatus;
  type?: MessageType;
  mediaUrl?: string;
  mediaName?: string;
  participants: string[];
}

interface ChatContact {
  txtMsgId: string;
  chatId: string;
  peerEmail: string;
  peerName: string;
  peerIconUrl: string;
  avatarColor: string;
  isAI: boolean;
  lastMessage: string;
  lastMessageType: MessageType;
  lastMessageIsOutgoing: boolean;
  lastStatus: MessageStatus;
  timestamp: Date;
  unreadCount: number;
  isOnline: boolean;
  isTyping: boolean;
  pinned: boolean;
  muted: boolean;
  archived: boolean;
}

// ─── Pure helpers ─────────────────────────────────────────────────────────────


function toInitials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function formatTimestamp(date: Date): string {
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffDays = Math.floor(diffMs / 86_400_000);
  if (diffDays === 0)
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  if (diffDays === 1) return 'Yesterday';
  if (diffDays < 7) return date.toLocaleDateString([], { weekday: 'short' });
  return date.toLocaleDateString([], { day: 'numeric', month: 'numeric', year: '2-digit' });
}

function lastMsgPreview(doc: RawChatDoc): string {
  if (doc.type === 'deleted') return '🚫 This message was deleted';
  if (doc.type === 'image') return '📷 Photo';
  if (doc.type === 'file') return `📎 ${doc.mediaName ?? 'File'}`;
  return doc.text || '…';
}

// ─── Sub-components ───────────────────────────────────────────────────────────

const TickIcon = React.memo(({ status }: { status?: MessageStatus }) => {
  if (!status || status === 'Sending') return null;
  if (status === 'Failed')
    return <Ionicons name="close-circle" size={14} color="#ef4444" />;
  if (status === 'Sent')
    return <Ionicons name="checkmark" size={15} color={C.grey} />;
  const color = status === 'Read' || status === 'Agent' ? C.blue : C.grey;
  return <MaterialCommunityIcons name="check-all" size={16} color={color} />;
});

const Avatar = React.memo(({ contact }: { contact: ChatContact }) => {
  const [imgErr, setImgErr] = useState(false);

  const hasImg =
    contact.peerIconUrl &&
    contact.peerIconUrl !== 'ai_image' &&
    !contact.peerIconUrl.startsWith('#') &&
    !imgErr;

  return (
    <View style={styles.avatarWrap}>
      <View style={[styles.avatarCircle, { backgroundColor: contact.isAI ? '#1a1a2e' : contact.avatarColor }]}>
        {contact.isAI ? (
          <Text style={styles.avatarEmoji}>🤖</Text>
        ) : hasImg ? (
          <Image
            source={{ uri: contact.peerIconUrl }}
            style={styles.avatarImage}
            resizeMode="cover"
            onError={() => setImgErr(true)}
          />
        ) : (
          <Text style={styles.avatarInitials}>{toInitials(contact.peerName)}</Text>
        )}
      </View>
      {contact.isOnline && <View style={styles.onlineDot} />}
    </View>
  );
});

interface ChatRowProps {
  contact: ChatContact;
  onPress: (c: ChatContact) => void;
  onPin: (id: string) => void;
  onMute: (id: string) => void;
  onArchive: (id: string) => void;
}

const ChatRow = React.memo(({ contact, onPress, onPin, onMute, onArchive }: ChatRowProps) => {
  const swipeRef = useRef<Swipeable>(null);
  const close = () => swipeRef.current?.close();

  const renderRightActions = () => (
    <View style={styles.swipeActions}>
      <TouchableOpacity
        style={[styles.swipeBtn, { backgroundColor: C.orange }]}
        onPress={() => { close(); onPin(contact.chatId); }}
      >
        <Ionicons name="pin" size={20} color="#fff" />
        <Text style={styles.swipeBtnLabel}>{contact.pinned ? 'Unpin' : 'Pin'}</Text>
      </TouchableOpacity>
      <TouchableOpacity
        style={[styles.swipeBtn, { backgroundColor: C.greyMid }]}
        onPress={() => { close(); onMute(contact.chatId); }}
      >
        <Ionicons name={contact.muted ? 'volume-high' : 'volume-mute'} size={20} color="#fff" />
        <Text style={styles.swipeBtnLabel}>{contact.muted ? 'Unmute' : 'Mute'}</Text>
      </TouchableOpacity>
      <TouchableOpacity
        style={[styles.swipeBtn, { backgroundColor: C.blue }]}
        onPress={() => { close(); onArchive(contact.chatId); }}
      >
        <Ionicons name="archive" size={20} color="#fff" />
        <Text style={styles.swipeBtnLabel}>Archive</Text>
      </TouchableOpacity>
    </View>
  );

  const isMedia = contact.lastMessageType === 'image' || contact.lastMessageType === 'file';
  const badgeColor = contact.muted ? C.grey : C.orange;

  return (
    <Swipeable
      ref={swipeRef}
      renderRightActions={renderRightActions}
      overshootRight={false}
      friction={2}
      rightThreshold={40}
    >
      <Pressable
        style={({ pressed }) => [
          styles.chatRow,
          contact.pinned && styles.chatRowPinned,
          pressed && styles.chatRowPressed,
        ]}
        onPress={() => onPress(contact)}
        android_ripple={{ color: '#f0e8e0' }}
      >
        <Avatar contact={contact} />

        <View style={styles.chatContent}>
          <View style={styles.chatTopRow}>
            <View style={styles.chatNameRow}>
              {contact.pinned && (
                <Ionicons
                  name="pin"
                  size={11}
                  color={C.orange}
                  style={{ marginRight: 2, transform: [{ rotate: '45deg' }] }}
                />
              )}
              <Text
                style={[styles.chatName, contact.unreadCount > 0 && styles.chatNameBold]}
                numberOfLines={1}
              >
                {contact.peerName}
              </Text>
              {contact.isAI && (
                <View style={styles.aiBadge}>
                  <Text style={styles.aiBadgeText}>AI</Text>
                </View>
              )}
            </View>
            <Text style={[styles.chatTime, contact.unreadCount > 0 && styles.chatTimeUnread]}>
              {formatTimestamp(contact.timestamp)}
            </Text>
          </View>

          <View style={styles.chatBottomRow}>
            <View style={styles.chatPreviewRow}>
              {contact.lastMessageIsOutgoing && !contact.isTyping && (
                <View style={{ marginRight: 2, marginTop: 1 }}>
                  <TickIcon status={contact.lastStatus} />
                </View>
              )}
              {contact.muted && (
                <Ionicons name="volume-mute" size={13} color={C.grey} style={{ marginRight: 3 }} />
              )}
              {contact.isTyping ? (
                <Text style={styles.typingText}>typing…</Text>
              ) : (
                <Text
                  style={[
                    styles.chatPreview,
                    contact.unreadCount > 0 && styles.chatPreviewBold,
                    isMedia && styles.chatPreviewMedia,
                  ]}
                  numberOfLines={1}
                >
                  {contact.lastMessage}
                </Text>
              )}
            </View>

            {contact.unreadCount > 0 && (
              <View style={[styles.unreadBadge, { backgroundColor: badgeColor }]}>
                <Text style={styles.unreadText}>
                  {contact.unreadCount > 99 ? '99+' : contact.unreadCount}
                </Text>
              </View>
            )}
          </View>
        </View>
      </Pressable>
    </Swipeable>
  );
}, (prev, next) => prev.contact === next.contact);

const TAB_LABELS: { key: TabKey; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'unread', label: 'Unread' },
  { key: 'groups', label: 'Groups' },
];

const TabBar = ({ active, onChange, unreadCount }: {
  active: TabKey;
  onChange: (k: TabKey) => void;
  unreadCount: number;
}) => (
  <ScrollView
    horizontal
    showsHorizontalScrollIndicator={false}
    contentContainerStyle={styles.tabBarContent}
    style={styles.tabBar}
    keyboardShouldPersistTaps="always"
  >
    {TAB_LABELS.map(({ key, label }) => {
      const isActive = active === key;
      return (
        <TouchableOpacity
          key={key}
          style={[styles.tab, isActive && styles.tabActive]}
          onPress={() => onChange(key)}
          activeOpacity={0.7}
        >
          <Text style={[styles.tabText, isActive && styles.tabTextActive]}>{label}</Text>
          {key === 'unread' && unreadCount > 0 && (
            <View style={[styles.tabBadge, isActive && styles.tabBadgeActive]}>
              <Text style={styles.tabBadgeText}>{unreadCount}</Text>
            </View>
          )}
        </TouchableOpacity>
      );
    })}
  </ScrollView>
);

// ─── ChatListScreen ───────────────────────────────────────────────────────────

const ChatListScreen = () => {

  const [showLoader, setShowLoader] = useState(true);

  useEffect(() => {
    const t = setTimeout(() => setShowLoader(false), 500);
    return () => clearTimeout(t);
  }, []);

  const { userId, userName } = useContext(GlobalContext) as any;

  useFocusEffect(
    useCallback(() => {
      if (!userName) router.replace('/');
    }, [userName])
  );

  const myEmail: string | null = userId ?? null;

  const { contacts, loading, togglePin, toggleMute, archiveChat, archivedCount } =
    useChatListListener(myEmail);

  const [activeTab, setActiveTab] = useState<TabKey>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [searchVisible, setSearchVisible] = useState(false);

  const searchInputRef = useRef<TextInput>(null);

  const openSearch = () => {
    setSearchVisible(true);
    setTimeout(() => searchInputRef.current?.focus(), 50);
  };

  const closeSearch = () => {
    setSearchVisible(false);
    setSearchQuery('');
    Keyboard.dismiss();
  };

  const displayContacts = useMemo(() => {
    let list = contacts;
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      list = list.filter(
        (c) =>
          c.peerName.toLowerCase().includes(q) ||
          c.lastMessage.toLowerCase().includes(q) ||
          c.peerEmail.toLowerCase().includes(q)
      );
    }
    if (activeTab === 'unread') list = list.filter((c) => c.unreadCount > 0);
    if (activeTab === 'groups') list = list.filter((c) => c.isAI);
    return list;
  }, [contacts, searchQuery, activeTab]);

  const unreadChatsCount = useMemo(
    () => contacts.filter((c) => c.unreadCount > 0).length,
    [contacts]
  );

  const showPinnedLabel =
    !searchQuery && activeTab === 'all' && displayContacts.some((c) => c.pinned);

  const handleChatPress = useCallback((contact: ChatContact) => {
    router.push({
      pathname: '/chat/chat_room',
      params: {
        clientEmail: contact.peerEmail,
        clientName: contact.peerName,
        clientIconUri: contact.isAI ? 'ai_image' : (contact.peerIconUrl || contact.avatarColor),
        clientPhone: '',
      },
    });
  }, []);

  const renderItem = useCallback(
    ({ item }: { item: ChatContact }) => (
      <ChatRow
        contact={item}
        onPress={handleChatPress}
        onPin={togglePin}
        onMute={toggleMute}
        onArchive={archiveChat}
      />
    ),
    [handleChatPress, togglePin, toggleMute, archiveChat]
  );

  const keyExtractor = useCallback((item: ChatContact) => item.chatId, []);

  const ListHeader = useMemo(() => (
    <>
      {showPinnedLabel && (
        <View style={styles.sectionLabel}>
          <Ionicons name="pin" size={11} color={C.orange} style={{ transform: [{ rotate: '45deg' }] }} />
          <Text style={styles.sectionLabelText}>PINNED</Text>
        </View>
      )}
    </>
  ), [showPinnedLabel]);

  const ListFooter = useMemo(() =>
    !searchQuery && activeTab === 'all' && archivedCount > 0 ? (
      <View>
        <View style={styles.divider} />
        <TouchableOpacity style={styles.archiveRow} activeOpacity={0.75}>
          <View style={styles.archiveIconWrap}>
            <Ionicons name="archive" size={22} color={C.greyMid} />
          </View>
          <Text style={styles.archiveLabel}>Archived</Text>
          <View style={[styles.unreadBadge, { backgroundColor: C.orange, marginLeft: 'auto' }]}>
            <Text style={styles.unreadText}>{archivedCount}</Text>
          </View>
        </TouchableOpacity>
        <View style={{ height: 20 }} />
      </View>
    ) : <View style={{ height: 20 }} />,
    [searchQuery, activeTab, archivedCount]
  );

  const ListEmpty = useMemo(() =>
    loading ? null : (
      <View style={styles.emptyState}>
        <Text style={styles.emptyTitle}>
          {searchQuery ? 'No results found' : 'No conversations yet'}
        </Text>
        <Text style={styles.emptySubtitle}>
          {searchQuery
            ? `Nothing matched "${searchQuery}"`
            : 'Tap the button to start chatting'}
        </Text>
      </View>
    ),
    [loading, searchQuery]
  );

  if (showLoader) {
    return (
      <ReusableScreen>
        <View style={styles.loaderContainer}>
          <ActivityIndicator size="large" color="#1f9b11ff" />
        </View>
      </ReusableScreen>
    );
  }

  return (
    <ReusableScreen>
      <MenuProvider>
        <GestureHandlerRootView style={styles.root}>
          <View style={styles.container}>

            <View style={styles.header}>
              {!searchVisible && (
                <View style={styles.titleRow}>
                  <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
                    <Ionicons name="arrow-back" size={24} color={C.black} />
                  </TouchableOpacity>
                  <Text style={styles.headerTitle}>Chats</Text>
                  <View style={styles.headerActions}>
                    <TouchableOpacity onPress={openSearch} style={styles.headerBtn}>
                      <Ionicons name="search-outline" size={22} color={C.black} />
                    </TouchableOpacity>
                    <PopupMenu />
                  </View>
                </View>
              )}

              {searchVisible && (
                <View style={styles.searchRow}>
                  <TouchableOpacity onPress={closeSearch} style={styles.backBtn}>
                    <Ionicons name="arrow-back" size={24} color={C.black} />
                  </TouchableOpacity>
                  <View style={styles.searchBar}>
                    <Ionicons name="search-outline" size={16} color={C.grey} />
                    <TextInput
                      ref={searchInputRef}
                      style={styles.searchInput}
                      value={searchQuery}
                      onChangeText={setSearchQuery}
                      placeholder="Search chats…"
                      placeholderTextColor={C.grey}
                      returnKeyType="search"
                    />
                    {searchQuery.length > 0 && (
                      <TouchableOpacity onPress={() => setSearchQuery('')}>
                        <Ionicons name="close-circle" size={16} color={C.grey} />
                      </TouchableOpacity>
                    )}
                  </View>
                </View>
              )}

              <TabBar
                active={activeTab}
                onChange={setActiveTab}
                unreadCount={unreadChatsCount}
              />
            </View>

            {loading ? (
              <View style={styles.loadingWrap}>
                <ActivityIndicator size="large" color={C.orange} />
                <Text style={styles.loadingText}>Loading chats…</Text>
              </View>
            ) : (
              <FlatList
                data={displayContacts}
                keyExtractor={keyExtractor}
                renderItem={renderItem}
                ListHeaderComponent={ListHeader}
                ListFooterComponent={ListFooter}
                ListEmptyComponent={ListEmpty}
                keyboardShouldPersistTaps="handled"
                showsVerticalScrollIndicator={false}
                contentContainerStyle={{ flexGrow: 1 }}
                ItemSeparatorComponent={() => <View style={styles.rowDivider} />}
                removeClippedSubviews
                maxToRenderPerBatch={12}
                windowSize={7}
                initialNumToRender={15}
              />
            )}

          </View>
        </GestureHandlerRootView>
      </MenuProvider>
    </ReusableScreen>
  );
};

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  root: { flex: 1 },
  container: { flex: 1, backgroundColor: C.bubbleBg },

  header: {
    backgroundColor: C.white,
    paddingTop: 0,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: C.ashDark,
    elevation: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 4,
    zIndex: 10,
  },

  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 6,
    paddingTop: 10,
    paddingBottom: 10,
    gap: 4,
  },
  backBtn: { padding: 8 },
  headerTitle: {
    flex: 1,
    fontSize: 20,
    fontWeight: '800',
    color: C.black,
    letterSpacing: -0.3,
  },
  headerActions: { flexDirection: 'row', alignItems: 'center' },
  headerBtn: { padding: 8 },

  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 6,
    paddingTop: 10,
    paddingBottom: 10,
    gap: 4,
  },
  searchBar: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: C.ash,
    borderRadius: 30,
    paddingHorizontal: 15,
    marginRight: 15,
    paddingVertical: IS_IOS ? 8 : 6,
    gap: 8,
  },
  searchInput: {
    flex: 1,
    fontSize: 15,
    color: C.black,
    paddingVertical: 2,
    ...(Platform.OS === "web" && {
      outlineStyle: "none",
      outlineWidth: 0,
      boxShadow: "none",
    }),
  },

  tabBar: { backgroundColor: C.white, maxHeight: 50 },
  tabBarContent: {
    paddingHorizontal: 14,
    paddingBottom: 10,
    gap: 8,
    alignItems: 'center',
  },
  tab: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 18,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: C.ash,
    gap: 5,
  },
  tabActive: { backgroundColor: C.orange },
  tabText: { fontSize: 13, fontWeight: '700', color: C.greyMid },
  tabTextActive: { color: C.white },
  tabBadge: {
    backgroundColor: C.orange,
    borderRadius: 8,
    minWidth: 18,
    height: 18,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 4,
  },
  tabBadgeActive: { backgroundColor: 'rgba(255,255,255,0.35)' },
  tabBadgeText: { fontSize: 10, fontWeight: '800', color: C.white },

  sectionLabel: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 16,
    paddingVertical: 6,
    backgroundColor: C.bubbleBg,
  },
  sectionLabelText: {
    fontSize: 11,
    fontWeight: '800',
    color: C.orange,
    letterSpacing: 1,
  },

  avatarWrap: { position: 'relative', width: 50, height: 50, flexShrink: 0 },
  avatarCircle: {
    width: 50,
    height: 50,
    borderRadius: 25,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  avatarImage: { width: '100%', height: '100%' },
  avatarInitials: { fontSize: 18, fontWeight: '800', color: C.white },
  avatarEmoji: { fontSize: 24 },
  onlineDot: {
    position: 'absolute',
    bottom: 1,
    right: 1,
    width: 13,
    height: 13,
    borderRadius: 7,
    backgroundColor: C.green,
    borderWidth: 2.5,
    borderColor: C.white,
  },

  chatRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 11,
    backgroundColor: C.white,
    gap: 12,
  },
  chatRowPinned: { backgroundColor: '#fff8f2' },
  chatRowPressed: { backgroundColor: '#fef0e8' },
  chatContent: { flex: 1, minWidth: 0 },
  chatTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  chatNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    gap: 4,
    minWidth: 0,
    marginRight: 8,
  },
  chatName: { fontSize: 15.5, fontWeight: '600', color: C.black, flexShrink: 1 },
  chatNameBold: { fontWeight: '800' },
  aiBadge: {
    backgroundColor: C.orange,
    borderRadius: 5,
    paddingHorizontal: 5,
    paddingVertical: 1,
  },
  aiBadgeText: { fontSize: 8, fontWeight: '900', color: C.white, letterSpacing: 0.5 },
  chatTime: { fontSize: 11.5, color: C.grey, flexShrink: 0 },
  chatTimeUnread: { color: C.orange, fontWeight: '700' },
  chatBottomRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  chatPreviewRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    minWidth: 0,
    gap: 3,
  },
  chatPreview: { fontSize: 13.5, color: C.grey, flex: 1 },
  chatPreviewBold: { color: C.greyDark, fontWeight: '600' },
  chatPreviewMedia: { color: C.blue },
  typingText: {
    fontSize: 13.5,
    color: C.orange,
    fontStyle: 'italic',
    fontWeight: '600',
    flex: 1,
  },

  unreadBadge: {
    borderRadius: 999,
    minWidth: 20,
    height: 20,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 5,
  },
  unreadText: { fontSize: 11, fontWeight: '800', color: C.white },

  swipeActions: { flexDirection: 'row', alignItems: 'stretch' },
  swipeBtn: {
    width: 72,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    paddingVertical: 8,
  },
  swipeBtnLabel: { fontSize: 10, fontWeight: '700', color: C.white },

  rowDivider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: C.divider,
    marginLeft: 80,
  },
  divider: { height: 6, backgroundColor: C.ash },

  archiveRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    backgroundColor: C.white,
  },
  archiveIconWrap: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: C.ash,
    alignItems: 'center',
    justifyContent: 'center',
  },
  archiveLabel: { fontSize: 15.5, fontWeight: '700', color: C.greyDark },

  emptyState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
    paddingTop: 60,
    gap: 10,
  },
  emptyTitle: { fontSize: 20, fontWeight: '800', color: C.greyDark },
  emptySubtitle: { fontSize: 14, color: C.grey, textAlign: 'center' },
  loadingWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 },
  loadingText: { fontSize: 14, color: C.grey, fontWeight: '600' },
  loaderContainer: { flex: 1, justifyContent: "center", alignItems: "center", backgroundColor: "#fff" },
});

export default ChatListScreen;