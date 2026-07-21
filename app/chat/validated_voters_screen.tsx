import React, { useCallback, useContext, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Image,
  Platform,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { router, useLocalSearchParams } from "expo-router";
import * as ImagePicker from "expo-image-picker";
import { collection, doc, onSnapshot, updateDoc } from "firebase/firestore";
import { getDownloadURL, ref, uploadBytes } from "firebase/storage";
import ReusableScreen from "@/components/ReusableScreen";
import { GlobalContext } from "@/context";
import { db, storage } from "@/firebase";

type Voter = {
  id: string;
  fields: Record<string, unknown>;
  photoUrl: string;
};

type PollDetails = {
  title: string;
  creatorEmail: string;
  faceVerification: boolean;
};

const getString = (value: unknown) => (value == null ? "" : String(value).trim());

// Voter files can have creator-defined field names. These fallbacks cover the
// common names, then use the first meaningful text value for a friendly label.
const displayNameFor = (voter: Voter) => {
  const preferred = ["validatedVoterName", "voterName", "name", "fullName", "fullname"];
  for (const key of preferred) {
    const value = getString(voter.fields[key]);
    if (value) return value;
  }
  const fallback = Object.entries(voter.fields).find(([key, value]) =>
    key !== "validatedVoterCode" && key !== "voterPhoto" && getString(value)
  );
  return fallback ? getString(fallback[1]) : voter.id;
};

const codeFor = (voter: Voter) =>
  getString(voter.fields.validatedVoterCode) || voter.id;

const visibleCredentials = (voter: Voter) =>
  Object.entries(voter.fields).filter(([key, value]) =>
    key !== "voterPhoto" && getString(value)
  );

export default function ValidatedVotersScreen() {
  const params = useLocalSearchParams<{ pollId?: string; creatorEmail?: string }>();
  const pollId = typeof params.pollId === "string" ? params.pollId : "";
  const { rawUserEmail } = useContext(GlobalContext);

  const [poll, setPoll] = useState<PollDetails | null>(null);
  const [voters, setVoters] = useState<Voter[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [updatingFaceVerification, setUpdatingFaceVerification] = useState(false);
  const [uploadingVoterId, setUploadingVoterId] = useState<string | null>(null);

  useEffect(() => {
    if (!pollId) {
      setLoading(false);
      return;
    }

    const unsubscribePoll = onSnapshot(
      doc(db, "POLL_TITLE_DB", pollId),
      (snapshot) => {
        const data = snapshot.data();
        setPoll(data ? {
          title: getString(data.title) || "Untitled Poll",
          creatorEmail: getString(data.creatorEmail),
          faceVerification: data.face_verification === "true",
        } : null);
      },
      (error) => console.error("validated voter poll listener:", error)
    );

    const unsubscribeVoters = onSnapshot(
      collection(db, "VALIDATED_VOTERS_DB", pollId, "validatedVoterInfo"),
      (snapshot) => {
        const next = snapshot.docs
          .map((item) => {
            const fields = item.data() as Record<string, unknown>;
            return { id: item.id, fields, photoUrl: getString(fields.voterPhoto) };
          })
          .sort((a, b) => displayNameFor(a).localeCompare(displayNameFor(b)));
        setVoters(next);
        setLoading(false);
        setRefreshing(false);
      },
      (error) => {
        console.error("validated voter listener:", error);
        setLoading(false);
        setRefreshing(false);
      }
    );

    return () => {
      unsubscribePoll();
      unsubscribeVoters();
    };
  }, [pollId]);

  const isCreator = !!rawUserEmail && rawUserEmail === poll?.creatorEmail;
  const withPhotos = useMemo(() => voters.filter((v) => v.photoUrl).length, [voters]);

  const refresh = useCallback(() => {
    // Firestore listeners keep this screen current; this gives users familiar
    // pull-to-refresh feedback while the listener receives its next snapshot.
    setRefreshing(true);
    setTimeout(() => setRefreshing(false), 500);
  }, []);

  const updateFaceVerification = async (enabled: boolean) => {
    if (!pollId || !isCreator || updatingFaceVerification) return;
    setUpdatingFaceVerification(true);
    try {
      await updateDoc(doc(db, "POLL_TITLE_DB", pollId), {
        face_verification: enabled ? "true" : "false",
      });
    } catch (error) {
      console.error("two-factor setting update:", error);
      Alert.alert("Could not update security", "Please try again.");
    } finally {
      setUpdatingFaceVerification(false);
    }
  };

  const chooseVoterPhoto = async (voter: Voter) => {
    if (!pollId || !isCreator || uploadingVoterId) return;
    if (Platform.OS !== "web") {
      const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (permission.status !== "granted") {
        Alert.alert("Permission needed", "Allow photo-library access to add a voter photo.");
        return;
      }
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.8,
    });
    if (result.canceled || !result.assets?.[0]) return;

    const asset = result.assets[0];
    if (asset.fileSize && asset.fileSize > 2 * 1024 * 1024) {
      Alert.alert("Photo too large", "Choose a photo that is 2MB or smaller.");
      return;
    }

    setUploadingVoterId(voter.id);
    try {
      const blob = await (await fetch(asset.uri)).blob();
      const storageRef = ref(
        storage,
        `validated_voter_photos/${pollId}/${encodeURIComponent(voter.id)}_${Date.now()}.jpg`
      );
      await uploadBytes(storageRef, blob, { contentType: "image/jpeg" });
      const voterPhoto = await getDownloadURL(storageRef);
      await updateDoc(
        doc(db, "VALIDATED_VOTERS_DB", pollId, "validatedVoterInfo", voter.id),
        { voterPhoto }
      );
    } catch (error) {
      console.error("validated voter photo upload:", error);
      Alert.alert("Upload failed", "Could not save the voter photo. Please try again.");
    } finally {
      setUploadingVoterId(null);
    }
  };

  if (!pollId) {
    return (
      <ReusableScreen>
        <View style={styles.centered}><Text style={styles.emptyTitle}>Poll not found</Text></View>
      </ReusableScreen>
    );
  }

  return (
    <ReusableScreen>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
          <Ionicons name="arrow-back" size={20} color="#FFFFFF" />
        </TouchableOpacity>
        <View style={styles.headerText}>
          <Text style={styles.headerTitle}>Validated voters</Text>
          <Text style={styles.headerSubtitle} numberOfLines={1}>{poll?.title || "Loading poll…"}</Text>
        </View>
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} colors={["#1F9F4E"]} />}
      >
        {isCreator && (
          <View style={styles.securityCard}>
            <View style={styles.securityIcon}><Ionicons name="scan-outline" size={22} color="#1F9F4E" /></View>
            <View style={styles.securityText}>
              <Text style={styles.securityTitle}>Facial recognition</Text>
              <Text style={styles.securityDescription}>
                {poll?.faceVerification
                  ? "Voters complete face verification before entering their passcode."
                  : "Voters authenticate with their passcode only."}
              </Text>
            </View>
            {updatingFaceVerification ? <ActivityIndicator color="#1F9F4E" /> : (
              <Switch
                value={poll?.faceVerification ?? false}
                onValueChange={updateFaceVerification}
                trackColor={{ false: "#D1D5DB", true: "#A2E0B8" }}
                thumbColor={poll?.faceVerification ? "#1F9F4E" : "#FFFFFF"}
              />
            )}
          </View>
        )}

        <View style={styles.summaryRow}>
          <View><Text style={styles.summaryCount}>{voters.length}</Text><Text style={styles.summaryLabel}>Validated voters</Text></View>
          <View style={styles.summaryDivider} />
          <View><Text style={styles.summaryCount}>{withPhotos}</Text><Text style={styles.summaryLabel}>Photos added</Text></View>
        </View>

        {!isCreator && poll && (
          <View style={styles.readOnlyNotice}>
            <Ionicons name="lock-closed-outline" size={16} color="#6B7280" />
            <Text style={styles.readOnlyText}>Only this poll’s creator can add or update voter photos and security.</Text>
          </View>
        )}

        {loading ? (
          <View style={styles.centered}><ActivityIndicator size="large" color="#1F9F4E" /></View>
        ) : voters.length === 0 ? (
          <View style={styles.emptyWrap}>
            <Ionicons name="people-outline" size={42} color="#9CA3AF" />
            <Text style={styles.emptyTitle}>No validated voters yet</Text>
            <Text style={styles.emptyDescription}>Add voters from the poll creation screen to see their credentials here.</Text>
          </View>
        ) : voters.map((voter) => {
          const uploading = uploadingVoterId === voter.id;
          return (
            <View key={voter.id} style={styles.voterCard}>
              <TouchableOpacity
                disabled={!isCreator || uploading}
                onPress={() => chooseVoterPhoto(voter)}
                activeOpacity={0.8}
                style={styles.photoTouchable}
              >
                {voter.photoUrl ? <Image source={{ uri: voter.photoUrl }} style={styles.photo} /> : (
                  <View style={styles.photoPlaceholder}><Ionicons name="person" size={25} color="#9CA3AF" /></View>
                )}
                {uploading ? <View style={styles.photoOverlay}><ActivityIndicator color="#FFFFFF" size="small" /></View> : isCreator && (
                  <View style={styles.photoEditBadge}><Ionicons name="camera" size={13} color="#FFFFFF" /></View>
                )}
              </TouchableOpacity>
              <View style={styles.voterInfo}>
                <Text style={styles.voterName} numberOfLines={1}>{displayNameFor(voter)}</Text>
                <Text style={styles.voterCode}>Code: {codeFor(voter)}</Text>
                <View style={styles.credentials}>
                  {visibleCredentials(voter).map(([key, value]) => (
                    <View key={key} style={styles.credentialRow}>
                      <Text style={styles.credentialKey} numberOfLines={1}>{key}</Text>
                      <Text style={styles.credentialValue} numberOfLines={2}>{getString(value)}</Text>
                    </View>
                  ))}
                </View>
                {/* {isCreator && <Text style={styles.photoHint}>Tap photo to {voter.photoUrl ? "replace" : "add"} it</Text>} */}
              </View>
            </View>
          );
        })}
      </ScrollView>
    </ReusableScreen>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: "row", alignItems: "center", gap: 12, padding: 14, backgroundColor: "#FFFFFF", borderBottomWidth: 1, borderBottomColor: "#E5E7EB" },
  backButton: { width: 36, height: 36, borderRadius: 18, backgroundColor: "#1F9F4E", alignItems: "center", justifyContent: "center" },
  headerText: { flex: 1 }, headerTitle: { fontSize: 17, fontWeight: "700", color: "#111827" }, headerSubtitle: { marginTop: 1, fontSize: 12, color: "#6B7280" },
  scroll: { flex: 1, backgroundColor: "#E5ECE3" }, content: { padding: 12, gap: 10, paddingBottom: 28 },
  securityCard: { flexDirection: "row", alignItems: "center", gap: 10, padding: 14, borderRadius: 14, backgroundColor: "#FFFFFF", borderWidth: 1, borderColor: "#CDEED9" },
  securityIcon: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center", backgroundColor: "#EAF6EE" }, securityText: { flex: 1 },
  securityTitle: { fontSize: 14, fontWeight: "700", color: "#1F9F4E" }, securityDescription: { marginTop: 2, fontSize: 12, lineHeight: 16, color: "#6B7280" },
  summaryRow: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 25, padding: 12, borderRadius: 12, backgroundColor: "#FFFFFF" },
  summaryCount: { textAlign: "center", fontSize: 18, fontWeight: "700", color: "#1F9F4E" }, summaryLabel: { marginTop: 2, fontSize: 11, color: "#6B7280" }, summaryDivider: { width: 1, height: 28, backgroundColor: "#E5E7EB" },
  readOnlyNotice: { flexDirection: "row", gap: 8, padding: 12, borderRadius: 10, backgroundColor: "#F3F4F6" }, readOnlyText: { flex: 1, fontSize: 12, lineHeight: 16, color: "#6B7280" },
  voterCard: { flexDirection: "row", gap: 12, padding: 12, borderRadius: 14, backgroundColor: "#FFFFFF", borderWidth: 1, borderColor: "#D9DAD9" },
  photoTouchable: { width: 55, height: 55, borderRadius: 34, overflow: "visible" }, photo: { width: 55, height: 55, borderRadius: 34, backgroundColor: "#F3F4F6" },
  photoPlaceholder: { width: 55, height: 55, borderRadius: 34, alignItems: "center", justifyContent: "center", backgroundColor: "#F3F4F6", borderWidth: 1, borderColor: "#E5E7EB" },
  photoOverlay: { ...StyleSheet.absoluteFillObject, borderRadius: 34, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(0,0,0,0.45)" }, photoEditBadge: { position: "absolute", right: -2, bottom: -2, width: 25, height: 25, borderRadius: 13, alignItems: "center", justifyContent: "center", backgroundColor: "#1F9F4E", borderWidth: 2, borderColor: "#FFFFFF" },
  voterInfo: { flex: 1, minWidth: 0 }, voterName: { fontSize: 15, fontWeight: "700", color: "#111827" }, voterCode: { marginTop: 2, fontSize: 12, color: "#1F9F4E", fontWeight: "600" }, credentials: { marginTop: 8, gap: 4 },
  credentialRow: { flexDirection: "row", gap: 6 }, credentialKey: { width: 100, fontSize: 11.5, color: "#6B7280", fontWeight: "600" }, credentialValue: { flex: 1, fontSize: 11.5, color: "#374151" }, photoHint: { marginTop: 9, fontSize: 11.5, fontWeight: "600", color: "#2563EB" },
  centered: { flex: 1, minHeight: 220, alignItems: "center", justifyContent: "center" }, emptyWrap: { alignItems: "center", paddingHorizontal: 30, paddingTop: 65 }, emptyTitle: { marginTop: 12, fontSize: 17, fontWeight: "700", color: "#374151" }, emptyDescription: { marginTop: 5, textAlign: "center", fontSize: 13, lineHeight: 19, color: "#6B7280" },
});
