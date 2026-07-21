import React, { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Alert, Image, Platform, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { router, useLocalSearchParams } from "expo-router";
import { CameraView, useCameraPermissions } from "expo-camera";
import * as LocalAuthentication from "expo-local-authentication";
import { doc, getDoc } from "firebase/firestore";
import ReusableScreen from "@/components/ReusableScreen";
import { db } from "@/firebase";

/**
 * IMPORTANT ARCHITECTURE NOTE
 * ----------------------------------------------------
 * Real facial verification (comparing a live face to a stored reference
 * photo) requires a face-comparison model. That comparison must run on a
 * server you control — never in the client — because it needs a private
 * API key (AWS Rekognition, Azure Face, Google Vision, etc.) and because a
 * client-side "match" can be trivially spoofed by a modified app binary.
 *
 * This screen therefore:
 *  1. Captures a live selfie with the device/browser camera (works on both
 *     native and web via expo-camera's CameraView).
 *  2. Sends the live selfie + the stored reference photo URL to YOUR
 *     backend endpoint (a Cloud Function / server route you deploy).
 *  3. Your backend calls a face-comparison API and returns a similarity
 *     score + boolean match, which this screen simply reads.
 *
 * Replace FACE_COMPARE_ENDPOINT below with your deployed backend URL.
 * Device biometric (Face ID / fingerprint) is offered as an *additional*
 * local device-lock factor on native devices only — it proves "this is the
 * device owner," not "this is the person in the reference photo," so it is
 * shown as a secondary step, never a substitute for the server-side match.
 */

const FACE_COMPARE_ENDPOINT = "https://YOUR_BACKEND_DOMAIN/api/compareFaces";
const MATCH_THRESHOLD = 0.85; // similarity score (0-1) your backend should tune/return

type CompareResponse = { match: boolean; similarity?: number; error?: string };

async function compareFaces(referencePhotoUrl: string, liveSelfieBase64: string): Promise<CompareResponse> {
  try {
    const response = await fetch(FACE_COMPARE_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        referencePhotoUrl,
        liveSelfieBase64,
      }),
    });
    if (!response.ok) {
      return { match: false, error: `Server error (${response.status})` };
    }
    const data = await response.json();
    return { match: Boolean(data.match), similarity: data.similarity };
  } catch (error) {
    console.error("compareFaces request failed:", error);
    return { match: false, error: "Network error while verifying face" };
  }
}

export default function FacialVerificationScreen() {
  const params = useLocalSearchParams<{ pollId?: string; voterId?: string; creatorEmail?: string }>();
  const pollId = typeof params.pollId === "string" ? params.pollId : "";
  const voterId = typeof params.voterId === "string" ? params.voterId : "";
  const creatorEmail = typeof params.creatorEmail === "string" ? params.creatorEmail : "";

  const [photoUrl, setPhotoUrl] = useState("");
  const [loading, setLoading] = useState(true);
  const [checking, setChecking] = useState(false);
  const [matched, setMatched] = useState(false);
  const [showCamera, setShowCamera] = useState(false);
  const [deviceLockDone, setDeviceLockDone] = useState(false);
  const [permission, requestPermission] = useCameraPermissions();
  const cameraRef = useRef<CameraView>(null);

  useEffect(() => {
    const load = async () => {
      if (!pollId || !voterId) {
        setLoading(false);
        return;
      }
      try {
        const snapshot = await getDoc(doc(db, "VALIDATED_VOTERS_DB", pollId, "validatedVoterInfo", voterId));
        const photo = snapshot.data()?.voterPhoto;
        setPhotoUrl(typeof photo === "string" ? photo : "");
      } catch (error) {
        console.error("load voter face reference:", error);
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [pollId, voterId]);

  const openCamera = async () => {
    if (!photoUrl) {
      Alert.alert("Photo required", "Your validated voter profile has no reference photo. Ask the poll creator to add one.");
      return;
    }
    if (!permission) return;
    if (!permission.granted) {
      const result = await requestPermission();
      if (!result.granted) {
        Alert.alert("Camera access needed", "Camera permission is required to verify your identity.");
        return;
      }
    }
    setShowCamera(true);
  };

  const captureAndVerify = async () => {
    if (!cameraRef.current) return;
    setChecking(true);
    try {
      const photo = await cameraRef.current.takePictureAsync({ base64: true, quality: 0.7 });
      if (!photo?.base64) {
        Alert.alert("Capture failed", "Could not capture a selfie. Please try again.");
        return;
      }
      const result = await compareFaces(photoUrl, photo.base64);
      if (result.match) {
        setMatched(true);
        setShowCamera(false);
      } else {
        Alert.alert(
          "Verification failed",
          result.error ?? "Your face did not match the voter record on file. Try again with better lighting, or exit."
        );
      }
    } catch (error) {
      console.error("face capture/compare failed:", error);
      Alert.alert("Verification failed", "Something went wrong. Please try again.");
    } finally {
      setChecking(false);
    }
  };

  // Optional secondary factor: confirms this is the device owner. Native only.
  const runDeviceLockCheck = async () => {
    if (Platform.OS === "web") {
      setDeviceLockDone(true); // not applicable on web; skip silently
      return;
    }
    try {
      const hasHardware = await LocalAuthentication.hasHardwareAsync();
      const enrolled = await LocalAuthentication.isEnrolledAsync();
      if (!hasHardware || !enrolled) {
        setDeviceLockDone(true); // device has no biometric set up; don't block voting on it
        return;
      }
      const result = await LocalAuthentication.authenticateAsync({
        promptMessage: "Confirm this is your device",
        cancelLabel: "Skip",
        disableDeviceFallback: false,
      });
      setDeviceLockDone(result.success);
    } catch (error) {
      console.error("device lock check:", error);
      setDeviceLockDone(true); // don't hard-block voting on a device-lock hiccup
    }
  };

  const returnToVote = () => {
    router.replace({
      pathname: "./poll_leaderboard",
      params: { pollId, creatorEmail, faceVerifiedVoterId: voterId },
    });
  };

  return (
    <ReusableScreen>
      <View style={styles.screen}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
          <Ionicons name="arrow-back" size={20} color="#FFFFFF" />
        </TouchableOpacity>

        {showCamera ? (
          <View style={styles.cameraCard}>
            <CameraView ref={cameraRef} style={styles.camera} facing="front" />
            <View style={styles.cameraActions}>
              <TouchableOpacity style={styles.primaryButton} onPress={captureAndVerify} disabled={checking}>
                {checking ? <ActivityIndicator color="#FFFFFF" /> : <Text style={styles.primaryButtonText}>Capture & verify</Text>}
              </TouchableOpacity>
              <TouchableOpacity onPress={() => setShowCamera(false)} style={styles.exitButton}>
                <Text style={styles.exitText}>Cancel</Text>
              </TouchableOpacity>
            </View>
          </View>
        ) : (
          <View style={styles.card}>
            <View style={[styles.iconWrap, matched && styles.iconWrapSuccess]}>
              <Ionicons name={matched ? "checkmark-circle" : "scan-outline"} size={42} color={matched ? "#1F9F4E" : "#D97706"} />
            </View>
            <Text style={styles.title}>{matched ? "Verification successful" : "Facial verification"}</Text>

            {loading ? (
              <ActivityIndicator color="#1F9F4E" />
            ) : (
              <>
                {photoUrl ? (
                  <Image source={{ uri: photoUrl }} style={styles.referencePhoto} />
                ) : (
                  <View style={styles.photoPlaceholder}>
                    <Ionicons name="person" size={45} color="#9CA3AF" />
                  </View>
                )}

                <Text style={styles.description}>
                  {matched
                    ? "Your live selfie matched the voter record on file. Continue to enter your passcode and cast your vote."
                    : "We'll take a live selfie and match it against the voter photo on file for this poll."}
                </Text>

                {!matched ? (
                  <>
                    <TouchableOpacity
                      style={[styles.primaryButton, !photoUrl && styles.disabledButton]}
                      onPress={openCamera}
                      disabled={!photoUrl}
                    >
                      <Text style={styles.primaryButtonText}>Start face verification</Text>
                    </TouchableOpacity>

                    {Platform.OS !== "web" && (
                      <TouchableOpacity style={styles.secondaryButton} onPress={runDeviceLockCheck}>
                        <Text style={styles.secondaryButtonText}>
                          {deviceLockDone ? "Device lock confirmed ✓" : "Also confirm device lock (optional)"}
                        </Text>
                      </TouchableOpacity>
                    )}
                  </>
                ) : (
                  <TouchableOpacity style={styles.primaryButton} onPress={returnToVote}>
                    <Text style={styles.primaryButtonText}>Cast your vote now</Text>
                  </TouchableOpacity>
                )}

                {!matched && (
                  <TouchableOpacity onPress={() => router.back()} style={styles.exitButton}>
                    <Text style={styles.exitText}>Exit</Text>
                  </TouchableOpacity>
                )}
              </>
            )}
          </View>
        )}

        {Platform.OS === "web" && !showCamera && (
          <Text style={styles.webNote}>Camera-based verification works in-browser; grant camera access when prompted.</Text>
        )}
      </View>
    </ReusableScreen>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, padding: 20, backgroundColor: "#E5ECE3" },
  backButton: { width: 36, height: 36, borderRadius: 18, backgroundColor: "#1F9F4E", alignItems: "center", justifyContent: "center" },
  card: { marginTop: 55, padding: 24, borderRadius: 20, alignItems: "center", backgroundColor: "#FFFFFF" },
  cameraCard: { marginTop: 55, borderRadius: 20, overflow: "hidden", backgroundColor: "#000000" },
  camera: { width: "100%", height: 420 },
  cameraActions: { padding: 16, backgroundColor: "#111827" },
  iconWrap: { width: 82, height: 82, borderRadius: 41, alignItems: "center", justifyContent: "center", backgroundColor: "#FEF3C7", marginBottom: 16 },
  iconWrapSuccess: { backgroundColor: "#EAF6EE" },
  title: { fontSize: 21, fontWeight: "700", color: "#111827" },
  referencePhoto: { width: 112, height: 112, borderRadius: 56, marginTop: 18, backgroundColor: "#F3F4F6" },
  photoPlaceholder: { width: 112, height: 112, borderRadius: 56, marginTop: 18, alignItems: "center", justifyContent: "center", backgroundColor: "#F3F4F6" },
  description: { marginTop: 18, fontSize: 14, lineHeight: 20, textAlign: "center", color: "#6B7280" },
  primaryButton: { alignSelf: "stretch", marginTop: 22, paddingVertical: 14, alignItems: "center", borderRadius: 11, backgroundColor: "#1F9F4E" },
  disabledButton: { backgroundColor: "#A7D9B8" },
  primaryButtonText: { fontSize: 15, fontWeight: "700", color: "#FFFFFF" },
  secondaryButton: { marginTop: 12, paddingVertical: 10, alignItems: "center" },
  secondaryButtonText: { fontSize: 13, fontWeight: "600", color: "#1F9F4E" },
  exitButton: { padding: 13 },
  exitText: { fontSize: 14, fontWeight: "600", color: "#6B7280" },
  webNote: { marginTop: 16, textAlign: "center", fontSize: 12, color: "#6B7280" },
});
