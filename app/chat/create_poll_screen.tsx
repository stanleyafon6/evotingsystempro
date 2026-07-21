import React, { useContext, useEffect, useState } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  Platform,
  KeyboardAvoidingView,
  Switch,
  ActivityIndicator,
  Alert,
  Image,
  Modal,
} from "react-native";
import { Ionicons, MaterialIcons } from "@expo/vector-icons";
import { router } from "expo-router";
import * as ImagePicker from "expo-image-picker";
import * as FileSystem from "expo-file-system";
import * as DocumentPicker from "expo-document-picker";
import * as Clipboard from "expo-clipboard";
import * as Sharing from "expo-sharing";
import * as XLSX from "xlsx";
import { manipulateAsync, SaveFormat } from "expo-image-manipulator";
import ReusableScreen from "@/components/ReusableScreen";
import { GlobalContext } from "@/context";
import { db, storage } from "@/firebase";
import { doc, setDoc, getDoc, serverTimestamp } from "firebase/firestore";
import { ref, uploadBytes, getDownloadURL } from "firebase/storage";

// ─── Types ────────────────────────────────────────────────────────────────────

type PollType = "single" | "multiple";
type VoterValidationMode = "manual" | "file";

interface Aspirant {
  id: string;
  name: string;
  email: string;
  comment: string;
  photoUri: string | null;
  photoUrl: string | null;
  uploadingPhoto: boolean;
  photoError: string | null;
}

// Manual entries only ever collect a voter's authentication code — there is
// no separate "name" field in manual mode. If a creator wants to store more
// information about a voter (name, department, etc.), they're directed to
// use the file upload option instead, which preserves every column they
// define.
interface ManualVoterEntry {
  id: string;
  code: string;
}

// A validated voter, parsed from a creator-defined CSV/Excel file. The
// creator names every column themselves — "validatedVoterCode" is just an
// example name, not a requirement. Positionally, column 1 is always the
// voter's authentication code and column 2 is always their name, whatever
// the creator chose to call those columns. `fields` holds every column
// exactly as the creator named it, and is what actually gets written to
// VALIDATED_VOTERS_DB/{pollId}/validatedVoterInfo/{code}.
interface ParsedVoter {
  code: string; // value from column 1 — used as the doc ID / auth lookup key
  displayName: string; // value from column 2 — shown in the in-app preview only
  fields: Record<string, string>; // every column, keyed by the creator's own header text
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const generatePollId = () =>
  `POLL_${Date.now()}_${Math.random()
    .toString(36)
    .substring(2, 7)
    .toUpperCase()}`;

const isValidEmail = (email: string) =>
  /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());

const AVATAR_PALETTE = ["#1F9F4E", "#2563EB", "#D97706", "#7C3AED", "#DB2777", "#0D9488", "#DC2626", "#0891B2"];

// Sample data shown in the "See example format" demo modal for the voter
// file upload. Column 1 is always the voter's authentication code and
// column 2 is always their name — everything after that is free-form, and
// is only here to illustrate that extra columns are allowed and are saved
// exactly as named.
const SAMPLE_VOTER_HEADERS = [
  "voterCode",
  "voterName",
  "voterDepartment",
  "-",
  "-",
  "-",
];
const SAMPLE_VOTER_ROWS: string[][] = [
  ["0324080720", "Julia Safo", "computer science", "-", "-", "-"],
  ["03240807400", "Lydia Idama", "physics", "-", "-", "-"],
  ["03240807421", "John Hackman", "engineering", "-", "-", "-"],
];
const SAMPLE_VOTER_CSV = [
  SAMPLE_VOTER_HEADERS.join(","),
  ...SAMPLE_VOTER_ROWS.map((row) => row.join(",")),
].join("\n");

const resolveImageMeta = (uri: string, mimeTypeFromPicker?: string) => {
  const rawExt = uri.split(".").pop()?.split("?")[0]?.toLowerCase();
  const knownExts = ["jpg", "jpeg", "png", "webp", "heic", "gif"];
  const ext = rawExt && knownExts.includes(rawExt) ? rawExt : "jpg";
  const contentType =
    mimeTypeFromPicker || `image/${ext === "jpg" ? "jpeg" : ext}`;
  return { ext, contentType };
};

const MAX_IMAGE_KB = 200;
const MAX_IMAGE_BYTES = MAX_IMAGE_KB * 1024;   // used for compression target

const MAX_UPLOAD_KB = 2048;
const MAX_UPLOAD_BYTES = MAX_UPLOAD_KB * 1024; // used for the 2MB accept/reject check

// MIN_UPLOAD_KB / MIN_UPLOAD_BYTES removed — no minimum size requirement

const MIN_UPLOAD_KB = 3;
const MIN_UPLOAD_BYTES = MIN_UPLOAD_KB * 1024;

const getImageByteSize = async (uri: string, knownBytes?: number): Promise<number> => {
  if (knownBytes) return knownBytes;

  if (Platform.OS === "web") {
    try {
      const blob = await (await fetch(uri)).blob();
      return blob.size;
    } catch {
      return 0;
    }
  }

  try {
    const info = await FileSystem.getInfoAsync(uri, { size: true });
    return (info.exists && "size" in info && info.size) || 0;
  } catch {
    return 0;
  }
};


// Only rejects when we can confidently measure the file and it's over 2MB.
// If size detection fails (returns 0/unknown), we don't block the upload —
// any image under 2MB should be accepted.
const validateImageWithinLimit = async (
  uri: string,
  knownBytes?: number
): Promise<string | null> => {
  const bytes = await getImageByteSize(uri, knownBytes);
  if (bytes > 0 && bytes > MAX_UPLOAD_BYTES) {
    return "Image size must not exceed 2MB.";
  }
  return null;
};

const compressToTargetSize = async (
  uri: string,
  width: number,
  height: number,
  maxBytes: number,
  knownBytes?: number
): Promise<{ uri: string; wasResized: boolean; scalePercent: number }> => {
  const originalBytes = await getImageByteSize(uri, knownBytes);

  if (!originalBytes || originalBytes <= maxBytes) {
    return { uri, wasResized: false, scalePercent: 100 };
  }

  const byteRatio = maxBytes / originalBytes;
  const linearScale = Math.sqrt(byteRatio);
  const target = {
    width: Math.max(1, Math.round((width || 1) * linearScale)),
    height: Math.max(1, Math.round((height || 1) * linearScale)),
  };

  try {
    const manipulated = await manipulateAsync(
      uri,
      [{ resize: target }],
      { compress: 0.8, format: SaveFormat.JPEG }
    );

    return {
      uri: manipulated.uri,
      wasResized: true,
      scalePercent: Math.round(linearScale * 100),
    };
  } catch (err) {
    console.log("Image compression skipped (manipulateAsync failed):", err);
    return { uri, wasResized: false, scalePercent: 100 };
  }
};

const withTimeout = <T,>(promise: Promise<T>, ms = 20000): Promise<T> =>
  Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error("Upload timed out")), ms)
    ),
  ]);

// Normalizes a voter's code for use as the VALIDATED_VOTERS_DB/{pollId}/
// validatedVoterInfo/{code} document ID — trimmed & lowercased so lookups at
// authentication time match consistently regardless of how it was entered.
const sanitizeVoterCode = (raw: string) => raw.trim().toLowerCase();

// Turns a CSV/Excel header cell into a Firestore-safe field key. The
// creator's exact column name is preserved as written (spaces, case,
// punctuation — everything), including columns 1 and 2 — there is no
// requirement that those be named "validatedVoterCode" / "validatedVoterName";
// that's only an example. The only characters swapped out are "." and "/",
// since those are unsafe inside a Firestore field name. An empty header
// cell falls back to a positional name so no column is ever silently
// dropped.
const sanitizeFieldKey = (raw: string, fallbackIndex: number) => {
  const trimmed = raw.trim();
  if (!trimmed) return `field_${fallbackIndex}`;
  return trimmed.replace(/[./]/g, "_");
};

// Builds a Firestore-safe field key for every column in the header row,
// preserving the creator's own header text exactly, whatever they named
// each one. Positionally, column 1 is always treated as the voter's
// authentication code and column 2 as their name — regardless of what the
// creator called those columns. If two columns share the same header name,
// the later one gets a numeric suffix appended so neither value overwrites
// the other.
const buildFieldKeys = (headerCells: string[]): string[] => {
  const used = new Set<string>();
  return headerCells.map((h, i) => {
    let key = sanitizeFieldKey(h, i + 1);
    while (used.has(key)) key = `${key}_${i + 1}`;
    used.add(key);
    return key;
  });
};

const parseDelimitedVoters = (text: string): ParsedVoter[] => {
  const lines = text
    .split(/\r\n|\r|\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  if (lines.length < 2) return [];

  const rows = lines.map((line) => line.split(/\t|,/).map((c) => c.trim()));

  const [headerRow, ...dataRows] = rows;
  if (headerRow.length < 2) return [];

  const fieldKeys = buildFieldKeys(headerRow);

  return dataRows
    .map((cells) => {
      const code = (cells[0] || "").trim();
      const displayName = (cells[1] || "").trim();
      if (!code || !displayName) return null;

      const fields: Record<string, string> = {};
      fieldKeys.forEach((key, i) => {
        const value = cells[i];
        if (value && value.trim().length > 0) {
          fields[key] = value.trim();
        }
      });

      return { code, displayName, fields };
    })
    .filter((v): v is ParsedVoter => v !== null);
};

const parseExcelVoters = (base64: string): ParsedVoter[] => {
  const workbook = XLSX.read(base64, { type: "base64" });
  const sheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];
  const rows: any[][] = XLSX.utils.sheet_to_json(sheet, {
    header: 1,
    blankrows: false,
  });

  if (rows.length < 2) return [];

  const headerRow = rows[0].map((c) => String(c ?? "").trim());
  const dataRows = rows.slice(1);
  if (headerRow.length < 2) return [];

  const fieldKeys = buildFieldKeys(headerRow);

  return dataRows
    .map((r) => {
      const cells = r.map((c) => String(c ?? "").trim());
      const code = (cells[0] || "").trim();
      const displayName = (cells[1] || "").trim();
      if (!code || !displayName) return null;

      const fields: Record<string, string> = {};
      fieldKeys.forEach((key, i) => {
        const value = cells[i];
        if (value && value.trim().length > 0) {
          fields[key] = value.trim();
        }
      });

      return { code, displayName, fields };
    })
    .filter((v): v is ParsedVoter => v !== null);
};

const fetchUriAsBase64 = async (uri: string): Promise<string> => {
  const response = await fetch(uri);
  const blob = await response.blob();
  return await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const result = (reader.result as string) || "";
      resolve(result.split(",")[1] || "");
    };
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
};

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function CreatePollScreen() {

  const [showLoader, setShowLoader] = useState(true);
  const { userName, rawUserEmail } = useContext(GlobalContext);
  const scrollRef = React.useRef<ScrollView>(null);

  const isPublishingRef = React.useRef(false);

  const [title, setTitle] = useState("");
  const [pollType, setPollType] = useState<PollType>("single");
  const [aspirants, setAspirants] = useState<Aspirant[]>([
    { id: "1", name: "", email: "", comment: "", photoUri: null, photoUrl: null, uploadingPhoto: false, photoError: null },
    { id: "2", name: "", email: "", comment: "", photoUri: null, photoUrl: null, uploadingPhoto: false, photoError: null },
  ]);
  const [deadline, setDeadline] = useState<Date | null>(null);
  const [isAnonymous, setIsAnonymous] = useState(false);
  const [showResults, setShowResults] = useState(true);
  const [faceVerification, setFaceVerification] = useState(false);

  const [requiresVoterValidation, setRequiresVoterValidation] = useState(false);
  const [voterValidationMode, setVoterValidationMode] = useState<VoterValidationMode>("manual");

  const [manualVoters, setManualVoters] = useState<ManualVoterEntry[]>([
    { id: "1", code: "" },
  ]);

  const [uploadedVoters, setUploadedVoters] = useState<ParsedVoter[]>([]);
  const [uploadedFileName, setUploadedFileName] = useState<string | null>(null);
  const [parsingFile, setParsingFile] = useState(false);
  const [fileParseError, setFileParseError] = useState<string | null>(null);
  const [showVoterDemoModal, setShowVoterDemoModal] = useState(false);

  const [publishing, setPublishing] = useState(false);

  const [logoUri, setLogoUri] = useState<string | null>(null);
  const [logoUrl, setLogoUrl] = useState<string>("");
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const [logoError, setLogoError] = useState<string | null>(null);

  const [deadlineDay, setDeadlineDay] = useState("");
  const [deadlineMonth, setDeadlineMonth] = useState("");
  const [deadlineYear, setDeadlineYear] = useState("");
  const [deadlineHour, setDeadlineHour] = useState("");
  const [deadlineMinute, setDeadlineMinute] = useState("");
  const [deadlineError, setDeadlineError] = useState<string | null>(null);

  // A poll is scheduled with a local start and end time. `deadline` remains
  // the end-time field so existing poll-list/voting code can continue using it.
  const [startDate, setStartDate] = useState<Date | null>(null);
  const [startDay, setStartDay] = useState("");
  const [startMonth, setStartMonth] = useState("");
  const [startYear, setStartYear] = useState("");
  const [startHour, setStartHour] = useState("");
  const [startMinute, setStartMinute] = useState("");
  const [startDateError, setStartDateError] = useState<string | null>(null);

  const [publishedTitle, setPublishedTitle] = useState<string | null>(null);

  // ── Aspirant helpers ────────────────────────────────────────────────────────

  useEffect(() => {
    const t = setTimeout(() => setShowLoader(false), 500);
    return () => clearTimeout(t);
  }, []);

  useEffect(() => {
    if (!requiresVoterValidation) setFaceVerification(false);
  }, [requiresVoterValidation]);


  const addAspirant = () => {
    if (aspirants.length >= 10) return;
    setAspirants((prev) => [
      ...prev,
      {
        id: Date.now().toString(),
        name: "",
        email: "",
        comment: "",
        photoUri: null,
        photoUrl: null,
        uploadingPhoto: false,
        photoError: null,
      },
    ]);
  };

  const removeAspirant = (id: string) => {
    if (aspirants.length <= 2) return;
    setAspirants((prev) => prev.filter((a) => a.id !== id));
  };

  const updateAspirant = (id: string, field: "name" | "email" | "comment", value: string) => {
    setAspirants((prev) =>
      prev.map((a) => (a.id === id ? { ...a, [field]: value } : a))
    );
  };

  const pickAspirantPhoto = async (aspirantId: string) => {
    if (Platform.OS !== "web") {
      const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (status !== "granted") {
        Alert.alert(
          "Permission needed",
          "Please allow access to your photo library to add a photo."
        );
        return;
      }
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.8,
    });

    if (result.canceled || !result.assets?.length) return;

    const asset = result.assets[0];

    const sizeError = await validateImageWithinLimit(asset.uri, asset.fileSize);
    if (sizeError) {
      setAspirants((prev) =>
        prev.map((a) =>
          a.id === aspirantId ? { ...a, photoError: sizeError } : a
        )
      );
      return;
    }

    setAspirants((prev) =>
      prev.map((a) =>
        a.id === aspirantId
          ? { ...a, photoUri: asset.uri, photoUrl: null, uploadingPhoto: true, photoError: null }
          : a
      )
    );

    try {
      let uploadUri = asset.uri;

      const { uri: resizedUri, wasResized, scalePercent } = await compressToTargetSize(
        asset.uri,
        asset.width,
        asset.height,
        MAX_IMAGE_BYTES,
        asset.fileSize
      );

      if (wasResized) {
        uploadUri = resizedUri;
        console.log(
          `Aspirant photo exceeded ${MAX_IMAGE_KB}kb — scaled to ~${scalePercent}% of its original dimensions.`
        );
        setAspirants((prev) =>
          prev.map((a) => (a.id === aspirantId ? { ...a, photoUri: resizedUri } : a))
        );
      }

      const { ext, contentType } = resolveImageMeta(
        uploadUri,
        uploadUri !== asset.uri ? "image/jpeg" : asset.mimeType
      );
      const storagePath = `aspirant_photos/${rawUserEmail}/${generatePollId()}_${aspirantId}.${ext}`;
      const storageRef = ref(storage, storagePath);

      const response = await fetch(uploadUri);
      const blob = await response.blob();
      await withTimeout(uploadBytes(storageRef, blob, { contentType }));

      const downloadUrl = await getDownloadURL(storageRef);
      setAspirants((prev) =>
        prev.map((a) =>
          a.id === aspirantId
            ? { ...a, photoUrl: downloadUrl, uploadingPhoto: false }
            : a
        )
      );
    } catch (err) {
      console.error("Aspirant photo upload failed:", err);
      const timedOut = err instanceof Error && err.message === "Upload timed out";
      Alert.alert(
        "Upload failed",
        timedOut
          ? "Upload timed out. This can happen if Firebase Storage rules are blocking the write — please try again or contact support."
          : "Could not upload the photo. Please try again."
      );
      setAspirants((prev) =>
        prev.map((a) =>
          a.id === aspirantId
            ? { ...a, photoUri: null, photoUrl: null, uploadingPhoto: false }
            : a
        )
      );
    }
  };

  const removeAspirantPhoto = (aspirantId: string) => {
    setAspirants((prev) =>
      prev.map((a) =>
        a.id === aspirantId ? { ...a, photoUri: null, photoUrl: null, photoError: null } : a
      )
    );
  };

  // ── Voter validation helpers ────────────────────────────────────────────────
  //
  // Manual entry only ever collects a voter's authentication code. There is
  // deliberately no "name" input here — if a creator wants to attach a name
  // (or anything else) to each voter, they're pointed at the file upload
  // mode instead, which preserves whatever columns they define.

  const addManualVoter = () => {
    if (manualVoters.length >= 500) return;
    setManualVoters((prev) => [
      ...prev,
      { id: Date.now().toString(), code: "" },
    ]);
  };

  const removeManualVoter = (id: string) => {
    if (manualVoters.length <= 1) return;
    setManualVoters((prev) => prev.filter((v) => v.id !== id));
  };

  const updateManualVoter = (id: string, value: string) => {
    setManualVoters((prev) =>
      prev.map((v) => (v.id === id ? { ...v, code: value } : v))
    );
  };

  const clearUploadedFile = () => {
    setUploadedFileName(null);
    setUploadedVoters([]);
    setFileParseError(null);
  };

  const handleCopyVoterDemo = async () => {
    try {
      await Clipboard.setStringAsync(SAMPLE_VOTER_CSV);
      Alert.alert("Copied", "The sample CSV has been copied to your clipboard.");
    } catch (err) {
      console.error("Copying sample voter file failed:", err);
      Alert.alert("Could not copy", "Please try again.");
    }
  };

  const handleDownloadVoterDemo = async () => {
    try {
      if (Platform.OS === "web") {
        const blob = new Blob([SAMPLE_VOTER_CSV], { type: "text/csv" });
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = "sample_voters.csv";
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
        return;
      }

      const fileUri = `${FileSystem.cacheDirectory}sample_voters.csv`;
      await FileSystem.writeAsStringAsync(fileUri, SAMPLE_VOTER_CSV, {
        encoding: FileSystem.EncodingType.UTF8,
      });

      const canShare = await Sharing.isAvailableAsync();
      if (canShare) {
        await Sharing.shareAsync(fileUri, {
          mimeType: "text/csv",
          dialogTitle: "Save sample voter file",
          UTI: "public.comma-separated-values-text",
        });
      } else {
        Alert.alert("Saved", `Sample file saved to:\n${fileUri}`);
      }
    } catch (err) {
      console.error("Downloading sample voter file failed:", err);
      Alert.alert("Could not download", "Please try again.");
    }
  };

  const ALLOWED_VOTER_FILE_EXTS = ["csv", "txt", "xlsx", "xls"];

  const pickVoterFile = async () => {
    setFileParseError(null);

    let result: DocumentPicker.DocumentPickerResult;
    try {
      result = await DocumentPicker.getDocumentAsync({
        type: "*/*",
        copyToCacheDirectory: true,
        multiple: false,
      });
    } catch (err) {
      console.error("Voter file picker failed to open:", err);
      setFileParseError(
        "Could not open the file picker. Please check app permissions and try again."
      );
      return;
    }

    if (result.canceled || !result.assets?.length) return;

    const asset = result.assets[0];
    const fileName = asset.name || "voters file";
    const ext = fileName.split(".").pop()?.toLowerCase() || "";

    if (!ALLOWED_VOTER_FILE_EXTS.includes(ext)) {
      setFileParseError(
        `"${fileName}" isn't a supported format. Please upload a .csv, .txt, .xlsx, or .xls file.`
      );
      return;
    }

    setParsingFile(true);
    setUploadedFileName(fileName);
    setUploadedVoters([]);

    try {
      let parsed: ParsedVoter[] = [];

      if (ext === "xlsx" || ext === "xls") {
        const base64 =
          Platform.OS === "web"
            ? await fetchUriAsBase64(asset.uri)
            : await FileSystem.readAsStringAsync(asset.uri, {
              encoding: FileSystem.EncodingType.Base64,
            });
        parsed = parseExcelVoters(base64);
      } else {
        const text =
          Platform.OS === "web"
            ? await (await fetch(asset.uri)).text()
            : await FileSystem.readAsStringAsync(asset.uri, {
              encoding: FileSystem.EncodingType.UTF8,
            });
        parsed = parseDelimitedVoters(text);
      }

      if (parsed.length === 0) {
        setFileParseError(
          "Each row needs a code and a name. Make sure the first row has column names, the first column is the voter code, and the second is the voter name."
        );
      } else {
        setUploadedVoters(parsed);
      }
    } catch (err) {
      console.error("Voter file parse failed:", err);
      setFileParseError("Could not read this file. Please check the format and try again.");
    } finally {
      setParsingFile(false);
    }
  };

  // ── Logo picker ─────────────────────────────────────────────────────────────

  const pickLogo = async () => {
    if (Platform.OS !== "web") {
      const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (status !== "granted") {
        Alert.alert(
          "Permission needed",
          "Please allow access to your photo library to add a logo."
        );
        return;
      }
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: true,
      aspect: [4, 3],
      quality: 0.8,
    });

    if (result.canceled || !result.assets?.length) return;

    const asset = result.assets[0];

    const sizeError = await validateImageWithinLimit(asset.uri, asset.fileSize);
    if (sizeError) {
      setLogoError(sizeError);
      return;
    }

    setLogoError(null);
    setLogoUri(asset.uri);
    setUploadingLogo(true);

    try {
      let uploadUri = asset.uri;

      const { uri: resizedUri, wasResized, scalePercent } = await compressToTargetSize(
        asset.uri,
        asset.width,
        asset.height,
        MAX_IMAGE_BYTES,
        asset.fileSize
      );

      if (wasResized) {
        uploadUri = resizedUri;
        console.log(
          `Logo exceeded ${MAX_IMAGE_KB}kb — scaled to ~${scalePercent}% of its original dimensions.`
        );
        setLogoUri(resizedUri);
      }

      const { ext, contentType } = resolveImageMeta(
        uploadUri,
        uploadUri !== asset.uri ? "image/jpeg" : asset.mimeType
      );
      const storagePath = `poll_logos/${rawUserEmail}/${generatePollId()}.${ext}`;
      const storageRef = ref(storage, storagePath);

      const response = await fetch(uploadUri);
      const blob = await response.blob();
      await withTimeout(uploadBytes(storageRef, blob, { contentType }));

      const downloadUrl = await getDownloadURL(storageRef);
      setLogoUrl(downloadUrl);
    } catch (err) {
      console.error("Logo upload failed:", err);
      const timedOut = err instanceof Error && err.message === "Upload timed out";
      Alert.alert(
        "Upload failed",
        timedOut
          ? "Upload timed out. This can happen if Firebase Storage rules are blocking the write — please try again or contact support."
          : "Could not upload the image. Please try again."
      );
      setLogoUri(null);
      setLogoUrl("");
    } finally {
      setUploadingLogo(false);
    }
  };

  const removeLogo = () => {
    setLogoUri(null);
    setLogoUrl("");
    setLogoError(null);
  };

  // ── Poll schedule ───────────────────────────────────────────────────────────

  React.useEffect(() => {
    const parseScheduleDate = (
      values: [string, string, string, string, string],
      label: string
    ): { date: Date | null; error: string | null } => {
      const [dayText, monthText, yearText, hourText, minuteText] = values;
      if (!dayText && !monthText && !yearText && !hourText && !minuteText) {
        return { date: null, error: null };
      }
      if (!dayText || !monthText || !yearText || !hourText || !minuteText) {
        return { date: null, error: `Enter the full ${label} date and time.` };
      }

      const day = parseInt(dayText, 10);
      const month = parseInt(monthText, 10);
      const year = parseInt(yearText, 10);
      const hour = parseInt(hourText, 10);
      const minute = parseInt(minuteText, 10);
      if (
        [day, month, year, hour, minute].some(Number.isNaN) ||
        day < 1 || day > 31 || month < 1 || month > 12 ||
        year < 2000 || year > 2100 || hour < 0 || hour > 23 || minute < 0 || minute > 59
      ) {
        return { date: null, error: `That ${label} date or time isn't valid.` };
      }

      const date = new Date(year, month - 1, day, hour, minute, 0, 0);
      if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) {
        return { date: null, error: `That ${label} date doesn't exist — check the day and month.` };
      }
      if (date.getTime() <= Date.now()) {
        return { date: null, error: `Poll ${label} must be in the future.` };
      }
      return { date, error: null };
    };

    const parsedStart = parseScheduleDate(
      [startDay, startMonth, startYear, startHour, startMinute],
      "start"
    );
    const parsedEnd = parseScheduleDate(
      [deadlineDay, deadlineMonth, deadlineYear, deadlineHour, deadlineMinute],
      "end"
    );

    let endError = parsedEnd.error;
    if (parsedStart.date && parsedEnd.date && parsedEnd.date <= parsedStart.date) {
      endError = "Poll end must be after the poll start time.";
    }

    setStartDate(parsedStart.date);
    setDeadline(endError ? null : parsedEnd.date);
    setStartDateError(parsedStart.error);
    setDeadlineError(endError);
  }, [
    startDay, startMonth, startYear, startHour, startMinute,
    deadlineDay, deadlineMonth, deadlineYear, deadlineHour, deadlineMinute,
  ]);

  // ── Validation ──────────────────────────────────────────────────────────────

  const duplicateEmails = aspirants
    .map((a) => a.email.trim().toLowerCase())
    .filter((e, i, arr) => e && arr.indexOf(e) !== i);

  // Manual entries collect only a code (no creator-defined header row, no
  // name field) — the code doubles as the display name in the preview and
  // is stored under a single fixed "validatedVoterCode" key. File uploads
  // instead keep whatever names the creator gave their own columns.
  const validatedVotersList: ParsedVoter[] = !requiresVoterValidation
    ? []
    : voterValidationMode === "file"
      ? uploadedVoters
      : manualVoters
        .map((v) => {
          const code = v.code.trim();
          return {
            code,
            displayName: code,
            fields: {
              validatedVoterCode: code,
            },
          };
        })
        .filter((v) => v.code.length > 0);

  const voterCodeDuplicates = validatedVotersList
    .map((v) => sanitizeVoterCode(v.code))
    .filter((c, i, arr) => c && arr.indexOf(c) !== i);

  const voterEntriesIncomplete = validatedVotersList.some(
    (v) => !v.code.trim() || !v.displayName.trim()
  );

  const voterValidationValid =
    !requiresVoterValidation ||
    (!parsingFile &&
      validatedVotersList.length > 0 &&
      voterCodeDuplicates.length === 0 &&
      !voterEntriesIncomplete);

  const isFormValid =
    title.trim().length > 0 &&
    !uploadingLogo &&
    aspirants.every((a) => a.name.trim().length > 0 && isValidEmail(a.email)) &&
    aspirants.every((a) => !a.uploadingPhoto) &&
    duplicateEmails.length === 0 &&
    startDate !== null &&
    deadline !== null &&
    voterValidationValid;

  const aspirantsValidCount = aspirants.filter(
    (a) => a.name.trim().length > 0 && isValidEmail(a.email)
  ).length;

  // ── Publish ─────────────────────────────────────────────────────────────────
  //
  // Writes to (flat structure):
  //   CREATOR_DB/{creatorEmail}
  //   POLL_TITLE_DB/{pollId}
  //   ASPIRANTS_DETAILS_DB/{pollId}_{aspirantEmail}
  //   VALIDATED_VOTERS_DB/{pollId}/validatedVoterInfo/{code}
  //     → one doc per voter, keyed by their (sanitized) code, holding every
  //       column exactly as the creator named it in their file — there's no
  //       fixed schema beyond "column 1 = code, column 2 = name" positionally.
  //       Manual entries instead only ever write a single "validatedVoterCode"
  //       field. Authentication is a single getDoc by code.
  //     (only when requires_voters_validation is true)

  // const isPublishingRef = React.useRef(false); // keep this at component top, already there

  const handlePublish = async () => {
    if (!isFormValid || !rawUserEmail) return;

    // synchronous guard — blocks a second invocation immediately,
    // even before React re-renders with publishing=true
    if (isPublishingRef.current) return;
    isPublishingRef.current = true;
    setPublishing(true);

    try {
      const creatorEmail = rawUserEmail;
      const now = new Date();

      // 1. Upsert creator in CREATOR_DB
      const creatorRef = doc(db, "CREATOR_DB", creatorEmail);
      const creatorSnap = await getDoc(creatorRef);
      if (!creatorSnap.exists()) {
        await setDoc(creatorRef, {
          creatorName: userName || "Unknown",
          creatorEmail,
          status: "active",
          dateCreated: now.toLocaleDateString(),
          timeCreated: now.toLocaleTimeString(),
        });
      }

      // 2. Verify creator is active
      const latestSnap = await getDoc(creatorRef);
      if (latestSnap.data()?.status !== "active") {
        Alert.alert("Account inactive", "Your creator account is not active.");
        return;
      }

      // 3. Generate poll ID
      const pollId = generatePollId();

      // 4. Save poll
      await setDoc(doc(db, "POLL_TITLE_DB", pollId), {
        pollId,
        title: title.trim(),
        pollType,
        requires_voters_validation: requiresVoterValidation ? "true" : "false",
        isAnonymous,
        showResults,
        face_verification: faceVerification ? "true" : "false",
        logoUrl,
        startDate: startDate ? startDate.toISOString() : null,
        deadline: deadline ? deadline.toISOString() : null,
        status: "active",
        poll_verification_status: "not_verified",
        creatorEmail,
        creatorName: userName || "Unknown",
        aspirantCount: aspirants.length,
        createdAt: serverTimestamp(),
        dateCreated: now.toLocaleDateString(),
        timeCreated: now.toLocaleTimeString(),
      });

      // 5. Save aspirants
      await Promise.all(
        aspirants.map((aspirant) => {
          const aspirantEmail = aspirant.email.trim().toLowerCase();
          const docId = `${pollId}_${aspirantEmail}`;
          return setDoc(doc(db, "ASPIRANTS_DETAILS_DB", docId), {
            pollId,
            aspirantEmail,
            name: aspirant.name.trim(),
            comment: aspirant.comment.trim(),
            photo: aspirant.photoUrl || "",
            votes: 0,
            lastVotedAt: null,
            creatorEmail,
            addedAt: serverTimestamp(),
          });
        })
      );

      // 6. Save validated voters
      if (requiresVoterValidation && validatedVotersList.length > 0) {
        await Promise.all(
          validatedVotersList.map((voter) => {
            const code = sanitizeVoterCode(voter.code);
            return setDoc(
              doc(db, "VALIDATED_VOTERS_DB", pollId, "validatedVoterInfo", code),
              { ...voter.fields },
              { merge: true }
            );
          })
        );
      }

      // 7. Notify users — single fetch, awaited, no nested duplicate function
      try {
        await fetch(
          "https://email-service-570014654568.us-central1.run.app/push_notification",
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              title: pollType === "multiple" ? "Multi-Vote Poll Created" : "Poll Created",
              body: `Poll "${title.trim()}" created by ${userName || "Guest"}.`,
              data: { screen: "chat/PollsListScreen" },
            }),
          }
        );
      } catch (err) {
        console.log("Push notification error:", err);
      }

      setPublishedTitle(title.trim());
      scrollRef.current?.scrollTo({ y: 0, animated: true });
    } catch (err) {
      console.error("Publish failed:", err);
      Alert.alert("Error", "Failed to publish poll. Please try again.");
    } finally {
      setPublishing(false);
      isPublishingRef.current = false;
    }
  };

  const handleViewPoll = () => {
    router.navigate("./PollsListScreen");
  };

  const handleDone = () => {
    router.navigate("./members_list");
  };

  // ── UI ───────────────────────────────────────────────────────────────────────
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
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        {/* ── Header ── */}
        <View style={styles.header}>
          <TouchableOpacity
            onPress={() => router.navigate("./members_list")}
            style={styles.backBtn}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          >
            <Ionicons name="arrow-back" size={18} color="#fff" />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Create a Poll</Text>
        </View>

        <ScrollView
          ref={scrollRef}
          style={styles.scroll}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >

          {publishedTitle && (
            <View style={styles.successBanner}>
              <View style={styles.successHeaderRow}>
                <View style={styles.successIconWrap}>
                  <Ionicons name="checkmark-circle" size={22} color="#1F9F4E" />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.successTitle}>Poll published!</Text>
                  <Text style={styles.successDesc} numberOfLines={1}>
                    "{publishedTitle}" is now live.
                  </Text>
                </View>
              </View>

              <View style={styles.segmentedBtn}>
                <TouchableOpacity
                  style={styles.segmentLeft}
                  onPress={handleViewPoll}
                  activeOpacity={0.85}
                >
                  <Ionicons name="eye-outline" size={14} color="#fff" />
                  <Text style={styles.segmentLeftText}>VIEW POLL</Text>
                </TouchableOpacity>
                <View style={styles.segmentDivider} />
                <TouchableOpacity
                  style={styles.segmentRight}
                  onPress={handleDone}
                  activeOpacity={0.85}
                >
                  <Text style={styles.segmentRightText}>DONE</Text>
                </TouchableOpacity>
              </View>
            </View>
          )}

          {/* ── Poll details card ── */}
          <View style={styles.card}>
            <View style={styles.sectionHeaderRow}>
              <View style={[styles.sectionIconWrap, { backgroundColor: "#EAF6EE" }]}>
                <Ionicons name="document-text-outline" size={15} color="#1F9F4E" />
              </View>
              <Text style={styles.sectionLabel}>Poll details</Text>
            </View>

            <Text style={styles.fieldLabel}>Title *</Text>
            <TextInput
              style={styles.input}
              placeholder="e.g. HTU-SRC Presidential Poll, 2026"
              placeholderTextColor="#a1a1a1ff"
              value={title}
              onChangeText={setTitle}
              maxLength={120}
              returnKeyType="next"
            />

            <Text style={[styles.fieldLabel, { marginTop: 14 }]}>
              Logo <Text style={styles.optional}>(Optional)</Text>
            </Text>

            {logoUri ? (
              <View style={styles.logoPreviewWrap}>
                <Image source={{ uri: logoUri }} style={styles.logoPreview} resizeMode="cover" />
                {uploadingLogo && (
                  <View style={styles.logoUploadOverlay}>
                    <ActivityIndicator color="#fff" size="small" />
                    <Text style={styles.logoUploadText}>Uploading…</Text>
                  </View>
                )}
                {!uploadingLogo && (
                  <TouchableOpacity style={styles.logoRemoveBtn} onPress={removeLogo}>
                    <Ionicons name="close-circle" size={22} color="#ef4444" />
                  </TouchableOpacity>
                )}
              </View>
            ) : (
              <View>
                <TouchableOpacity style={styles.logoRow} onPress={pickLogo} activeOpacity={0.7}>
                  <Ionicons name="image-outline" size={18} color="#1F9F4E" />
                  <Text style={styles.logoText}>Tap to add logo or banner image</Text>
                </TouchableOpacity>
                {logoError && <Text style={styles.errorText}>{logoError}</Text>}
              </View>
            )}
          </View>

          {/* ── Poll type card ── */}
          <View style={styles.card}>
            <View style={styles.sectionHeaderRow}>
              <View style={[styles.sectionIconWrap, { backgroundColor: "#EAF6EE" }]}>
                <Ionicons name="options-outline" size={15} color="#1F9F4E" />
              </View>
              <Text style={styles.sectionLabel}>Poll type</Text>
            </View>

            <TouchableOpacity
              style={[styles.radioRow, pollType === "single" && styles.radioRowActive]}
              onPress={() => setPollType("single")}
              activeOpacity={0.8}
            >
              <View style={styles.radioOuter}>
                {pollType === "single" && <View style={styles.radioInner} />}
              </View>
              <View style={styles.radioText}>
                <Text style={[styles.radioTitle, pollType === "single" && styles.radioTitleActive]}>
                  Single-Vote
                </Text>
                <Text style={styles.radioDesc}>Each voter casts exactly one vote.</Text>
              </View>
              {pollType === "single" && (
                <Ionicons name="checkmark-circle" size={18} color="#1F9F4E" />
              )}
            </TouchableOpacity>

            <View style={styles.dividerThin} />

            <TouchableOpacity
              style={[styles.radioRow, pollType === "multiple" && styles.radioRowActive]}
              onPress={() => setPollType("multiple")}
              activeOpacity={0.8}
            >
              <View style={styles.radioOuter}>
                {pollType === "multiple" && <View style={styles.radioInner} />}
              </View>
              <View style={styles.radioText}>
                <Text style={[styles.radioTitle, pollType === "multiple" && styles.radioTitleActive]}>
                  Multiple-Voting
                </Text>
                <Text style={styles.radioDesc}>Each voter can vote for more than one aspirant.</Text>
              </View>
              {pollType === "multiple" && (
                <Ionicons name="checkmark-circle" size={18} color="#1F9F4E" />
              )}
            </TouchableOpacity>
          </View>

          {/* ── Aspirants card ── */}
          <View style={styles.card}>
            <View style={styles.sectionHeaderRow}>
              <View style={[styles.sectionIconWrap, { backgroundColor: "#EAF6EE" }]}>
                <Ionicons name="people-outline" size={15} color="#1F9F4E" />
              </View>
              <Text style={styles.sectionLabel}>Aspirants</Text>
              <View style={styles.aspirantProgressPill}>
                <Text style={styles.aspirantProgressText}>
                  {aspirantsValidCount}/{aspirants.length} ready
                </Text>
              </View>
            </View>
            <Text style={styles.fieldHint}>
              Add candidates with their name and email (min 2, max 10)
            </Text>

            {aspirants.map((asp, index) => {
              const nameOk = asp.name.trim().length > 0;
              const emailOk = isValidEmail(asp.email);
              const isDup = duplicateEmails.includes(asp.email.trim().toLowerCase());
              const aspirantComplete = nameOk && emailOk && !isDup;
              const avatarColor = AVATAR_PALETTE[index % AVATAR_PALETTE.length];

              return (
                <View
                  key={asp.id}
                  style={[styles.aspirantCard, aspirantComplete && styles.aspirantCardComplete]}
                >
                  <View style={styles.aspirantHeaderRow}>
                    <View style={[styles.optionIndex, { backgroundColor: avatarColor }]}>
                      <Text style={styles.optionIndexText}>{index + 1}</Text>
                    </View>
                    <Text style={styles.aspirantLabel}>Aspirant {index + 1}</Text>
                    {aspirantComplete && (
                      <Ionicons name="checkmark-circle" size={16} color="#1F9F4E" />
                    )}
                    {aspirants.length > 2 && (
                      <TouchableOpacity
                        onPress={() => removeAspirant(asp.id)}
                        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                      >
                        <Ionicons name="close-circle" size={20} color="#d1d5db" />
                      </TouchableOpacity>
                    )}
                  </View>

                  <Text style={styles.subFieldLabel}>Full Name *</Text>
                  <TextInput
                    style={styles.input}
                    placeholder="e.g. John Mensah"
                    placeholderTextColor="#b0b0b0"
                    value={asp.name}
                    onChangeText={(t) => updateAspirant(asp.id, "name", t)}
                    maxLength={80}
                    returnKeyType="next"
                  />

                  <Text style={[styles.subFieldLabel, { marginTop: 10 }]}>Email Address *</Text>
                  <TextInput
                    style={styles.input}
                    placeholder="e.g. john.mensah@example.com"
                    placeholderTextColor="#b0b0b0"
                    value={asp.email}
                    onChangeText={(t) => updateAspirant(asp.id, "email", t)}
                    keyboardType="email-address"
                    autoCapitalize="none"
                    maxLength={120}
                    returnKeyType="next"
                  />
                  {asp.email.trim() && !isValidEmail(asp.email) && (
                    <Text style={styles.errorText}>Invalid email address</Text>
                  )}
                  {isDup && (
                    <Text style={styles.errorText}>
                      Duplicate — each aspirant must have a unique email
                    </Text>
                  )}

                  <Text style={[styles.subFieldLabel, { marginTop: 10 }]}>
                    Comment <Text style={styles.optional}>(Optional)</Text>
                  </Text>
                  <TextInput
                    style={styles.input}
                    placeholder="e.g. Manifesto link, role, or a short note"
                    placeholderTextColor="#b0b0b0"
                    value={asp.comment}
                    onChangeText={(t) => updateAspirant(asp.id, "comment", t)}
                    maxLength={150}
                    returnKeyType="next"
                  />

                  <Text style={[styles.subFieldLabel, { marginTop: 10 }]}>
                    Photo <Text style={styles.optional}>(Optional)</Text>
                  </Text>
                  {asp.photoUri ? (
                    <View style={styles.aspirantPhotoPreviewWrap}>
                      <Image
                        source={{ uri: asp.photoUri }}
                        style={styles.aspirantPhotoPreview}
                        resizeMode="cover"
                      />
                      {asp.uploadingPhoto && (
                        <View style={styles.aspirantPhotoUploadOverlay}>
                          <ActivityIndicator color="#fff" size="small" />
                        </View>
                      )}
                      {!asp.uploadingPhoto && (
                        <TouchableOpacity
                          style={styles.aspirantPhotoRemoveBtn}
                          onPress={() => removeAspirantPhoto(asp.id)}
                          hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
                        >
                          <Ionicons name="close-circle" size={18} color="#ef4444" />
                        </TouchableOpacity>
                      )}
                    </View>
                  ) : (
                    <View>
                      <TouchableOpacity
                        style={styles.aspirantPhotoRow}
                        onPress={() => pickAspirantPhoto(asp.id)}
                        activeOpacity={0.7}
                      >
                        <Ionicons name="camera-outline" size={16} color="#1F9F4E" />
                        <Text style={styles.aspirantPhotoText}>
                          Tap to add a photo - a color avatar is used if skipped
                        </Text>
                      </TouchableOpacity>
                      {asp.photoError && <Text style={styles.errorText}>{asp.photoError}</Text>}
                    </View>
                  )}
                </View>
              );
            })}

            {aspirants.length < 10 && (
              <TouchableOpacity style={styles.addOptionBtn} onPress={addAspirant}>
                <Ionicons name="add-circle-outline" size={16} color="#1F9F4E" />
                <Text style={styles.addOptionText}>Add aspirant</Text>
              </TouchableOpacity>
            )}
          </View>

          {/* ── Settings card ── */}
          <View style={styles.card}>
            <View style={styles.sectionHeaderRow}>
              <View style={[styles.sectionIconWrap, { backgroundColor: "#EAF6EE" }]}>
                <Ionicons name="settings-outline" size={15} color="#1F9F4E" />
              </View>
              <Text style={styles.sectionLabel}>Settings</Text>
            </View>

            <View style={styles.toggleRow}>
              <View style={styles.toggleIconWrap}>
                <Ionicons name="shield-checkmark-outline" size={15} color="#6b7280" />
              </View>
              <View style={styles.toggleText}>
                <Text style={styles.toggleLabel}>Require voter validation</Text>
                <Text style={styles.toggleDesc}>
                  Only voters you pre-approve below can vote in this poll.
                </Text>
              </View>
              <Switch
                value={requiresVoterValidation}
                onValueChange={setRequiresVoterValidation}
                trackColor={{ false: "#e5e7eb", true: "#A2E0B8" }}
                thumbColor={requiresVoterValidation ? "#1F9F4E" : "#9ca3af"}
              />
            </View>

            <View style={styles.dividerThin} />

            <Text style={styles.fieldHint}>
              Set when voting opens and closes (24-hour format). The end time must be after the start time.
            </Text>

            <Text style={styles.scheduleLabel}>Poll start *</Text>
            <View style={styles.dateTimeInputRow}>
              <TextInput
                style={[styles.input, styles.dateInputSmall]}
                placeholder="DD"
                placeholderTextColor="#b0b0b0"
                value={startDay}
                onChangeText={(t) => setStartDay(t.replace(/[^0-9]/g, "").slice(0, 2))}
                keyboardType="number-pad"
                maxLength={2}
              />
              <Text style={styles.dateTimeSeparator}>/</Text>
              <TextInput
                style={[styles.input, styles.dateInputSmall]}
                placeholder="MM"
                placeholderTextColor="#b0b0b0"
                value={startMonth}
                onChangeText={(t) => setStartMonth(t.replace(/[^0-9]/g, "").slice(0, 2))}
                keyboardType="number-pad"
                maxLength={2}
              />
              <Text style={styles.dateTimeSeparator}>/</Text>
              <TextInput
                style={[styles.input, styles.dateInputYear]}
                placeholder="YYYY"
                placeholderTextColor="#b0b0b0"
                value={startYear}
                onChangeText={(t) => setStartYear(t.replace(/[^0-9]/g, "").slice(0, 4))}
                keyboardType="number-pad"
                maxLength={4}
              />
            </View>

            <View style={[styles.dateTimeInputRow, { marginTop: 10 }]}>
              <TextInput
                style={[styles.input, styles.dateInputSmall]}
                placeholder="HH"
                placeholderTextColor="#b0b0b0"
                value={startHour}
                onChangeText={(t) => setStartHour(t.replace(/[^0-9]/g, "").slice(0, 2))}
                keyboardType="number-pad"
                maxLength={2}
              />
              <Text style={styles.dateTimeSeparator}>:</Text>
              <TextInput
                style={[styles.input, styles.dateInputSmall]}
                placeholder="MM"
                placeholderTextColor="#b0b0b0"
                value={startMinute}
                onChangeText={(t) => setStartMinute(t.replace(/[^0-9]/g, "").slice(0, 2))}
                keyboardType="number-pad"
                maxLength={2}
              />
            </View>

            {startDateError && <Text style={styles.errorText}>{startDateError}</Text>}
            {startDate && !startDateError && (
              <Text style={styles.startConfirmedText}>
                Starts: {startDate.toLocaleString()}
              </Text>
            )}

            <Text style={styles.scheduleLabel}>Poll end *</Text>
            <View style={styles.dateTimeInputRow}>
              <TextInput
                style={[styles.input, styles.dateInputSmall]}
                placeholder="DD"
                placeholderTextColor="#b0b0b0"
                value={deadlineDay}
                onChangeText={(t) => setDeadlineDay(t.replace(/[^0-9]/g, "").slice(0, 2))}
                keyboardType="number-pad"
                maxLength={2}
              />
              <Text style={styles.dateTimeSeparator}>/</Text>
              <TextInput
                style={[styles.input, styles.dateInputSmall]}
                placeholder="MM"
                placeholderTextColor="#b0b0b0"
                value={deadlineMonth}
                onChangeText={(t) => setDeadlineMonth(t.replace(/[^0-9]/g, "").slice(0, 2))}
                keyboardType="number-pad"
                maxLength={2}
              />
              <Text style={styles.dateTimeSeparator}>/</Text>
              <TextInput
                style={[styles.input, styles.dateInputYear]}
                placeholder="YYYY"
                placeholderTextColor="#b0b0b0"
                value={deadlineYear}
                onChangeText={(t) => setDeadlineYear(t.replace(/[^0-9]/g, "").slice(0, 4))}
                keyboardType="number-pad"
                maxLength={4}
              />
            </View>

            <View style={[styles.dateTimeInputRow, { marginTop: 10 }]}>
              <TextInput
                style={[styles.input, styles.dateInputSmall]}
                placeholder="HH"
                placeholderTextColor="#b0b0b0"
                value={deadlineHour}
                onChangeText={(t) => setDeadlineHour(t.replace(/[^0-9]/g, "").slice(0, 2))}
                keyboardType="number-pad"
                maxLength={2}
              />
              <Text style={styles.dateTimeSeparator}>:</Text>
              <TextInput
                style={[styles.input, styles.dateInputSmall]}
                placeholder="MM"
                placeholderTextColor="#b0b0b0"
                value={deadlineMinute}
                onChangeText={(t) => setDeadlineMinute(t.replace(/[^0-9]/g, "").slice(0, 2))}
                keyboardType="number-pad"
                maxLength={2}
              />
            </View>

            {deadlineError && <Text style={styles.errorText}>{deadlineError}</Text>}
            {deadline && !deadlineError && (
              <Text style={styles.deadlineConfirmedText}>
                Ends: {deadline.toLocaleString()}
              </Text>
            )}

            <View style={styles.dividerThin} />

            <View style={styles.toggleRow}>
              <View style={styles.toggleIconWrap}>
                <Ionicons name="scan-outline" size={15} color="#6b7280" />
              </View>
              <View style={styles.toggleText}>
                <Text style={styles.toggleLabel}>Facial recognition</Text>
                <Text style={styles.toggleDesc}>
                  Require facial verification before the voter enters their passcode.
                </Text>
              </View>
              <Switch
                value={faceVerification}
                onValueChange={setFaceVerification}
                disabled={!requiresVoterValidation}
                trackColor={{ false: "#e5e7eb", true: "#A2E0B8" }}
                thumbColor={faceVerification ? "#1F9F4E" : "#9ca3af"}
              />
            </View>

            <View style={styles.dividerThin} />

            <View style={styles.toggleRow}>
              <View style={styles.toggleIconWrap}>
                <Ionicons name="eye-off-outline" size={15} color="#6b7280" />
              </View>
              <View style={styles.toggleText}>
                <Text style={styles.toggleLabel}>Anonymous voting</Text>
                <Text style={styles.toggleDesc}>
                  Voter identities will be hidden from results.
                </Text>
              </View>
              <Switch
                value={isAnonymous}
                onValueChange={setIsAnonymous}
                trackColor={{ false: "#e5e7eb", true: "#A2E0B8" }}
                thumbColor={isAnonymous ? "#1F9F4E" : "#9ca3af"}
              />
            </View>

            <View style={styles.dividerThin} />

            <View style={styles.toggleRow}>
              <View style={styles.toggleIconWrap}>
                <Ionicons name="stats-chart-outline" size={15} color="#6b7280" />
              </View>
              <View style={styles.toggleText}>
                <Text style={styles.toggleLabel}>Show live results</Text>
                <Text style={styles.toggleDesc}>
                  Voters can see results as voting progresses.
                </Text>
              </View>
              <Switch
                value={showResults}
                onValueChange={setShowResults}
                trackColor={{ false: "#e5e7eb", true: "#A2E0B8" }}
                thumbColor={showResults ? "#1F9F4E" : "#9ca3af"}
              />
            </View>
          </View>

          {/* ── Validated voters card (shown only when the toggle above is ON) ── */}
          {requiresVoterValidation && (
            <View style={styles.card}>
              <View style={styles.sectionHeaderRow}>
                <View style={[styles.sectionIconWrap, { backgroundColor: "#EAF6EE" }]}>
                  <Ionicons name="shield-checkmark-outline" size={15} color="#1F9F4E" />
                </View>
                <Text style={styles.sectionLabel}>Validated Voters</Text>
                <View style={styles.aspirantProgressPill}>
                  <Text style={styles.aspirantProgressText}>
                    {validatedVotersList.length} ready
                  </Text>
                </View>
              </View>
              <Text style={styles.fieldHint}>
                Add every voter allowed to vote - each needs a unique code.
                Voters are authenticated by their code only.
              </Text>

              <View style={styles.modeSwitchRow}>
                <TouchableOpacity
                  style={[
                    styles.modeButton,
                    voterValidationMode === "manual" && styles.modeButtonActive,
                  ]}
                  onPress={() => setVoterValidationMode("manual")}
                  activeOpacity={0.8}
                >
                  <Ionicons
                    name="create-outline"
                    size={14}
                    color={voterValidationMode === "manual" ? "#fff" : "#6b7280"}
                  />
                  <Text
                    style={[
                      styles.modeButtonText,
                      voterValidationMode === "manual" && styles.modeButtonTextActive,
                    ]}
                  >
                    Manual Entry
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[
                    styles.modeButton,
                    voterValidationMode === "file" && styles.modeButtonActive,
                  ]}
                  onPress={() => setVoterValidationMode("file")}
                  activeOpacity={0.8}
                >
                  <Ionicons
                    name="cloud-upload-outline"
                    size={14}
                    color={voterValidationMode === "file" ? "#fff" : "#6b7280"}
                  />
                  <Text
                    style={[
                      styles.modeButtonText,
                      voterValidationMode === "file" && styles.modeButtonTextActive,
                    ]}
                  >
                    Upload File
                  </Text>
                </TouchableOpacity>
              </View>

              {voterValidationMode === "manual" && (
                <View>
                  {manualVoters.map((voter, index) => {
                    const codeTrim = voter.code.trim();
                    const code = sanitizeVoterCode(codeTrim);
                    const isDupCode = !!code && voterCodeDuplicates.includes(code);
                    return (
                      <View key={voter.id} style={styles.voterRow}>
                        <View style={styles.voterRowInputs}>
                          <TextInput
                            style={[styles.input, styles.voterInputCode, { flex: 1 }]}
                            placeholder="Voter code"
                            placeholderTextColor="#b0b0b0"
                            value={voter.code}
                            onChangeText={(t) => updateManualVoter(voter.id, t)}
                            autoCapitalize="none"
                            maxLength={80}
                          />
                          {manualVoters.length > 1 && (
                            <TouchableOpacity
                              onPress={() => removeManualVoter(voter.id)}
                              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                              style={styles.removeVoterBtn}
                            >
                              <Ionicons name="close-circle" size={20} color="#d1d5db" />
                            </TouchableOpacity>
                          )}
                        </View>
                        <View>
                          {isDupCode && (
                            <Text style={styles.errorText}>
                              Duplicate code - each voter needs a unique code <Ionicons name="eye-outline" size={13} color="#2563EB" />
                              <Text style={styles.demoLinkText}>See example format</Text>
                            </Text>
                          )}
                        </View>
                      </View>
                    );
                  })}

                  <View style={styles.manualEntryNote}>
                    <Ionicons name="information-circle-outline" size={15} color="#92702a" />
                    <Text style={styles.manualEntryNoteText}>
                      Manual entry only stores a voter code — no name or other
                      details. If you need to record more about each voter
                      (name, department, etc.), use "Upload File" instead.
                    </Text>
                  </View>

                  <TouchableOpacity style={styles.addVoterBtn} onPress={addManualVoter}>
                    <Ionicons name="add-circle-outline" size={16} color="#1F9F4E" />
                    <Text style={styles.addVoterText}>Add voter</Text>
                  </TouchableOpacity>
                </View>
              )}

              {voterValidationMode === "file" && (
                <View>
                  {!uploadedFileName ? (
                    <View>
                      <TouchableOpacity
                        style={styles.fileUploadBox}
                        onPress={pickVoterFile}
                        activeOpacity={0.7}
                      >
                        <Ionicons name="document-attach-outline" size={20} color="#1F9F4E" />
                        <Text style={styles.fileUploadText}>
                          Tap to upload CSV, Excel, or Text file
                        </Text>
                        <Text style={styles.fileUploadHint}>
                          First row = your own column names — name them however you like.
                          Column 1 must hold each voter's authentication code, column 2
                          their name. Add as many extra columns as you want; every column
                          is saved under the exact name you gave it.
                        </Text>
                      </TouchableOpacity>

                      <TouchableOpacity
                        style={styles.demoLinkBtn}
                        onPress={() => setShowVoterDemoModal(true)}
                        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                        activeOpacity={0.7}
                      >
                        <Ionicons name="eye-outline" size={13} color="#2563EB" />
                        <Text style={styles.demoLinkText}>See example format</Text>
                      </TouchableOpacity>
                    </View>
                  ) : (
                    <View style={styles.fileLoadedCard}>
                      <View style={styles.fileLoadedHeader}>
                        <Ionicons name="document-text-outline" size={18} color="#1F9F4E" />
                        <View style={{ flex: 1 }}>
                          <Text style={styles.fileLoadedName} numberOfLines={1}>
                            {uploadedFileName}
                          </Text>
                          {parsingFile ? (
                            <Text style={styles.fileLoadedCount}>Parsing…</Text>
                          ) : (
                            <Text style={styles.fileLoadedCount}>
                              {uploadedVoters.length} voter{uploadedVoters.length === 1 ? "" : "s"} loaded
                            </Text>
                          )}
                        </View>
                        {parsingFile && <ActivityIndicator size="small" color="#1F9F4E" />}
                      </View>

                      {!parsingFile && uploadedVoters.length > 0 && (
                        <View style={styles.filePreviewList}>
                          {uploadedVoters.slice(0, 5).map((voter, i) => (
                            <Text
                              key={`${voter.code}-${i}`}
                              style={styles.filePreviewItem}
                            >
                              {voter.code} — {voter.displayName}
                            </Text>
                          ))}
                          {uploadedVoters.length > 5 && (
                            <Text style={styles.filePreviewMore}>
                              +{uploadedVoters.length - 5} more
                            </Text>
                          )}
                        </View>
                      )}

                      <View style={styles.fileActionsRow}>
                        <TouchableOpacity onPress={pickVoterFile} style={styles.fileChangeBtn}>
                          <Text style={styles.fileActionText}>Change file</Text>
                        </TouchableOpacity>
                        <TouchableOpacity onPress={clearUploadedFile} style={styles.fileRemoveBtn}>
                          <Text style={[styles.fileActionText, { color: "#ef4444" }]}>Remove</Text>
                        </TouchableOpacity>
                      </View>
                    </View>
                  )}

                  {fileParseError && <View><Text style={styles.errorText}>{fileParseError}</Text></View>}
                  {!fileParseError && voterCodeDuplicates.length > 0 && (
                    <View><Text style={styles.errorText}>
                      This file has duplicate codes - each voter needs a unique code.
                    </Text></View>
                  )}
                </View>
              )}
            </View>
          )}

          {/* ── Publish ── */}
          <TouchableOpacity
            style={[
              styles.publishBtn,
              (!isFormValid || publishing) && styles.publishBtnDisabled,
            ]}
            onPress={handlePublish}
            activeOpacity={0.85}
            disabled={!isFormValid || publishing}
          >
            {publishing ? (
              <ActivityIndicator color="#fff" size="small" />
            ) : (
              <>
                <MaterialIcons name="how-to-vote" size={18} color="#fff" />
                <Text style={styles.publishText}>Publish Poll</Text>
              </>
            )}
          </TouchableOpacity>

          {!isFormValid && !publishing && (
            <Text style={styles.validationHint}>
              Fill in all required fields to enable publishing.
            </Text>
          )}

          <Text style={styles.footerNote}>
            Once published, the poll will be visible to all community members.
          </Text>
        </ScrollView>

        {/* ── Voter file demo modal ── */}
        <Modal
          visible={showVoterDemoModal}
          transparent
          animationType="fade"
          onRequestClose={() => setShowVoterDemoModal(false)}
        >
          <View style={styles.demoModalOverlay}>
            <View style={styles.demoModalCard}>
              <View style={styles.demoModalHeaderRow}>
                <Text style={styles.demoModalTitle}>Example voter file</Text>
                <TouchableOpacity
                  onPress={() => setShowVoterDemoModal(false)}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                >
                  <Ionicons name="close" size={22} color="#6b7280" />
                </TouchableOpacity>
              </View>

              <Text style={styles.demoModalDesc}>
                It is not compulsary that you must maintain Column 1 as "voterCode". You can be change it to
                any name of your choice. And that applies to the rest of the columns. You can also add as many columns as possible

              </Text>

              <ScrollView horizontal showsHorizontalScrollIndicator={true} style={styles.demoTableScroll}>
                <View>
                  <View style={styles.demoTableHeaderRow}>
                    {SAMPLE_VOTER_HEADERS.map((h) => (
                      <Text key={h} style={styles.demoTableHeaderCell}>{h}</Text>
                    ))}
                  </View>
                  {SAMPLE_VOTER_ROWS.map((row, i) => (
                    <View
                      key={i}
                      style={[
                        styles.demoTableRow,
                        i === SAMPLE_VOTER_ROWS.length - 1 && styles.demoTableRowLast,
                      ]}
                    >
                      {row.map((cell, j) => (
                        <Text key={j} style={styles.demoTableCell}>{cell}</Text>
                      ))}
                    </View>
                  ))}
                </View>
              </ScrollView>

              <Text style={styles.demoRawLabel}>Raw CSV</Text>
              <ScrollView horizontal style={styles.demoRawBox}>
                <Text style={styles.demoRawText}>{SAMPLE_VOTER_CSV}</Text>
              </ScrollView>

              <View style={styles.demoActionsRow}>
                <TouchableOpacity
                  style={styles.demoActionBtn}
                  onPress={handleCopyVoterDemo}
                  activeOpacity={0.8}
                >
                  <Ionicons name="copy-outline" size={15} color="#1F9F4E" />
                  <Text style={styles.demoActionText}>Copy</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.demoActionBtn}
                  onPress={handleDownloadVoterDemo}
                  activeOpacity={0.8}
                >
                  <Ionicons name="download-outline" size={15} color="#1F9F4E" />
                  <Text style={styles.demoActionText}>Download .csv</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </Modal>
      </KeyboardAvoidingView>
    </ReusableScreen>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: "#f5f6f8", },

  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: "#fff",
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 0.5,
    borderBottomColor: "#e5e7eb",
  },
  backBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: "#1F9F4E",
    alignItems: "center",
    justifyContent: "center",
  },
  headerTitle: { fontSize: 17, fontWeight: "700", color: "#1a1a1a", letterSpacing: -0.2 },

  scroll: { flex: 1, backgroundColor: "#e5ece3ff", gap: 5, margin: 5, },
  scrollContent: { paddingHorizontal: 7, paddingTop: 9, paddingBottom: 30 },

  card: {
    backgroundColor: "#fff",
    borderRadius: 16,
    padding: 6,
    borderWidth: 1.4,
    borderColor: "#d9dad9ff",
    marginBottom: 8,
  },

  sectionHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 14,
  },
  sectionIconWrap: {
    width: 26,
    height: 26,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
  },
  sectionLabel: {
    fontSize: 13,
    fontWeight: "700",
    color: "#1F9F4E",
    textTransform: "uppercase",
    letterSpacing: 0.8,
    flex: 1,
  },
  aspirantProgressPill: {
    backgroundColor: "#f3f4f6",
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: 20,
  },
  aspirantProgressText: { fontSize: 13, fontWeight: "700", color: "#6b7280" },

  fieldLabel: { fontSize: 13, fontWeight: "600", color: "#374151", marginBottom: 6 },
  subFieldLabel: { fontSize: 12, fontWeight: "600", color: "#6b7280", marginBottom: 5 },
  optional: { fontWeight: "400", color: "#9ca3af" },
  fieldHint: { marginLeft: 35, fontSize: 14, fontWeight: "600", color: "#565758ff", marginBottom: 12, marginTop: -8 },

  input: {
    borderWidth: 1,
    borderColor: "#e0e1e3ff",
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 11,
    fontSize: 14,
    color: "#1a1a1a",
    backgroundColor: "#f0f1f2ff",
    ...(Platform.OS === "web" ? ({ outlineStyle: "none" } as any) : {}),
  },
  inputError: { borderColor: "#ef4444", backgroundColor: "#fff5f5" },
  errorText: { fontSize: 13, color: "#ef4444", marginTop: 4, marginLeft: 2 },

  logoRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderWidth: 1,
    borderColor: "#A2E0B8",
    borderStyle: "dashed",
    borderRadius: 10,
    padding: 12,
    backgroundColor: "#EAF6EE",
  },
  logoText: { fontSize: 13, color: "#1F9F4E" },
  logoPreviewWrap: {
    position: "relative",
    borderRadius: 10,
    overflow: "hidden",
    height: 160,
    backgroundColor: "#f3f4f6",
  },
  logoPreview: { width: "100%", height: "100%" },
  logoUploadOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0,0,0,0.45)",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  logoUploadText: { color: "#fff", fontSize: 13, fontWeight: "600" },
  logoRemoveBtn: {
    position: "absolute",
    top: 8,
    right: 8,
    backgroundColor: "#fff",
    borderRadius: 12,
  },

  aspirantPhotoRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderWidth: 1,
    borderColor: "#A2E0B8",
    borderStyle: "dashed",
    borderRadius: 10,
    padding: 10,
    backgroundColor: "#EAF6EE",
  },
  aspirantPhotoText: { fontSize: 12, color: "#1F9F4E", flex: 1 },
  aspirantPhotoPreviewWrap: {
    position: "relative",
    width: 64,
    height: 64,
    borderRadius: 32,
    overflow: "hidden",
    backgroundColor: "#f3f4f6",
  },
  aspirantPhotoPreview: { width: "100%", height: "100%" },
  aspirantPhotoUploadOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0,0,0,0.45)",
    alignItems: "center",
    justifyContent: "center",
  },
  aspirantPhotoRemoveBtn: {
    position: "absolute",
    top: 5,
    right: 10,
    backgroundColor: "#fff",
    borderRadius: 11,
  },

  radioRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 12,
    paddingHorizontal: 8,
    borderRadius: 10,
  },
  radioRowActive: { backgroundColor: "#EAF6EE" },
  radioOuter: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: "#1F9F4E",
    alignItems: "center",
    justifyContent: "center",
  },
  radioInner: { width: 10, height: 10, borderRadius: 5, backgroundColor: "#1F9F4E" },
  radioText: { flex: 1 },
  radioTitle: { fontSize: 15, fontWeight: "600", color: "#374151" },
  radioTitleActive: { color: "#1F9F4E" },
  radioDesc: { fontSize: 12, color: "#9ca3af", marginTop: 2 },

  aspirantCard: {
    borderWidth: 1,
    borderColor: "#eef0f2",
    backgroundColor: "#fafbfc",
    borderRadius: 12,
    padding: 12,
    marginBottom: 10,
  },
  aspirantCardComplete: { borderColor: "#cdeed9", backgroundColor: "#fbfffc" },
  aspirantHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 10,
  },
  aspirantLabel: { flex: 1, fontSize: 13, fontWeight: "700", color: "#374151" },
  optionIndex: {
    width: 26,
    height: 26,
    borderRadius: 13,
    alignItems: "center",
    justifyContent: "center",
  },
  optionIndexText: { fontSize: 12, fontWeight: "700", color: "#fff" },
  addOptionBtn: { flexDirection: "row", alignItems: "center", gap: 6, paddingTop: 4, justifyContent: "center" },
  addOptionText: { fontSize: 13, color: "#1F9F4E", fontWeight: "600" },

  dateTimeInputRow: {
    marginLeft: 35,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  scheduleLabel: {
    marginLeft: 35,
    marginBottom: 6,
    fontSize: 13,
    fontWeight: "700",
    color: "#374151",
  },
  dateInputSmall: {
    width: 56,
    textAlign: "center",
  },
  dateInputYear: {
    width: 76,
    textAlign: "center",
  },
  dateTimeSeparator: {
    fontSize: 18,
    fontWeight: "700",
    color: "#9ca3af",
  },
  deadlineConfirmedText: {
    fontSize: 13,
    fontWeight: "600",
    color: "#1F9F4E",
    marginTop: 10, marginLeft: 35,
  },
  startConfirmedText: {
    fontSize: 13,
    fontWeight: "600",
    color: "#1F9F4E",
    marginTop: 10,
    marginBottom: 14,
    marginLeft: 35,
  },

  toggleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 12,
  },
  toggleIconWrap: {
    width: 28,
    height: 28,
    borderRadius: 8,
    backgroundColor: "#f3f4f6",
    alignItems: "center",
    justifyContent: "center",
  },
  toggleText: { flex: 1 },
  toggleLabel: { fontSize: 14, fontWeight: "600", color: "#374151" },
  toggleDesc: { fontSize: 12, color: "#9ca3af", marginTop: 2 },

  modeSwitchRow: {
    flexDirection: "row",
    gap: 8,
    backgroundColor: "#f3f4f6",
    borderRadius: 10,
    padding: 4,
    marginBottom: 14,
  },
  modeButton: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 9,
    borderRadius: 8,
  },
  modeButtonActive: { backgroundColor: "#1F9F4E" },
  modeButtonText: { fontSize: 13, fontWeight: "600", color: "#6b7280" },
  modeButtonTextActive: { color: "#fff" },

  voterRow: { marginBottom: 10 },
  voterRowInputs: { flexDirection: "row", alignItems: "center", gap: 8 },
  voterInputCode: { flex: 1 },
  voterInputName: { flex: 1 },
  removeVoterBtn: { padding: 2 },
  addVoterBtn: { flexDirection: "row", alignItems: "center", gap: 6, paddingTop: 4, justifyContent: "center" },
  addVoterText: { fontSize: 13, color: "#1F9F4E", fontWeight: "600" },

  manualEntryNote: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 6,
    backgroundColor: "#FEF6E7",
    borderWidth: 1,
    borderColor: "#F5D999",
    borderRadius: 10,
    padding: 10,
    marginTop: 2,
    marginBottom: 10,
  },
  manualEntryNoteText: {
    flex: 1,
    fontSize: 12,
    lineHeight: 16,
    color: "#92702a",
  },

  fileUploadBox: {
    alignItems: "center",
    gap: 6,
    borderWidth: 1,
    borderColor: "#A2E0B8",
    borderStyle: "dashed",
    borderRadius: 10,
    padding: 20,
    backgroundColor: "#EAF6EE",
  },
  fileUploadText: { fontSize: 13, color: "#1F9F4E", fontWeight: "600" },
  fileUploadHint: { fontSize: 11, color: "#6b9c7c", textAlign: "center" },

  demoLinkBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    alignSelf: "center",
    paddingTop: 10,
    paddingHorizontal: 6,
  },
  demoLinkText: { fontSize: 12.5, color: "#2563EB", fontWeight: "600" },

  demoModalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.5)",
    alignItems: "center",
    justifyContent: "center",
    padding: 20,
  },
  demoModalCard: {
    width: "100%",
    maxWidth: 480,
    maxHeight: "85%",
    backgroundColor: "#fff",
    borderRadius: 16,
    padding: 16,
  },
  demoModalHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 8,
  },
  demoModalTitle: { fontSize: 16, fontWeight: "700", color: "#1a1a1a" },
  demoModalDesc: { fontSize: 13.5, color: "#6b7280", lineHeight: 17, marginBottom: 12 },

  demoTableScroll: {
    borderWidth: 1,
    borderColor: "#eef0f2",
    borderRadius: 10,
    marginBottom: 14,
  },
  demoTableHeaderRow: {
    flexDirection: "row",
    backgroundColor: "#EAF6EE",
  },
  demoTableHeaderCell: {
    width: 130,
    paddingVertical: 9,
    paddingHorizontal: 10,
    fontSize: 11.5,
    fontWeight: "700",
    color: "#1F9F4E",
  },
  demoTableRow: {
    flexDirection: "row",
    borderTopWidth: 1,
    borderTopColor: "#f3f4f6",
  },
  demoTableRowLast: {},
  demoTableCell: {
    width: 130,
    paddingVertical: 9,
    paddingHorizontal: 10,
    fontSize: 12,
    color: "#374151",
  },

  demoRawLabel: { fontSize: 11.5, fontWeight: "700", color: "#9ca3af", marginBottom: 6, textTransform: "uppercase", letterSpacing: 0.5 },
  demoRawBox: {
    backgroundColor: "#f8f9fa",
    borderWidth: 1,
    borderColor: "#eef0f2",
    borderRadius: 10,
    padding: 10,
    marginBottom: 14,
  },
  demoRawText: {
    fontSize: 12,
    color: "#374151",
    fontFamily: Platform.select({ ios: "Menlo", android: "monospace", default: "monospace" }),
  },

  demoActionsRow: { flexDirection: "row", gap: 10 },
  demoActionBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    borderWidth: 1,
    borderColor: "#A2E0B8",
    backgroundColor: "#EAF6EE",
    borderRadius: 10,
    paddingVertical: 10,
  },
  demoActionText: { fontSize: 13, fontWeight: "700", color: "#1F9F4E" },
  fileLoadedCard: {
    borderWidth: 1,
    borderColor: "#cdeed9",
    borderRadius: 10,
    padding: 12,
    backgroundColor: "#fbfffc",
  },
  fileLoadedHeader: { flexDirection: "row", alignItems: "center", gap: 10 },
  fileLoadedName: { fontSize: 13, fontWeight: "700", color: "#374151" },
  fileLoadedCount: { fontSize: 12, color: "#6b7280", marginTop: 1 },
  filePreviewList: { marginTop: 10, gap: 3 },
  filePreviewItem: { fontSize: 12, color: "#4b5563" },
  filePreviewMore: { fontSize: 12, color: "#9ca3af", fontStyle: "italic", marginTop: 2 },
  fileActionsRow: { flexDirection: "row", gap: 16, marginTop: 10 },
  fileChangeBtn: { paddingVertical: 4 },
  fileRemoveBtn: { paddingVertical: 4 },
  fileActionText: { fontSize: 13, fontWeight: "600", color: "#1F9F4E" },

  successBanner: {
    backgroundColor: "#fff",
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "#cdeed9",
    padding: 14,
    marginBottom: 14,
    gap: 12,
    ...Platform.select({
      ios: { shadowColor: "#1F9F4E", shadowOpacity: 0.08, shadowRadius: 8, shadowOffset: { width: 0, height: 2 } },
      android: { elevation: 1 },
      default: { boxShadow: "0 1px 4px rgba(31,159,78,0.08)" } as any,
    }),
  },
  successHeaderRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  successIconWrap: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: "#EAF6EE",
    alignItems: "center",
    justifyContent: "center",
  },
  successTitle: { fontSize: 14.5, fontWeight: "700", color: "#1a1a1a" },
  successDesc: { fontSize: 12.5, color: "#6b7280", marginTop: 1 },

  segmentedBtn: {
    flexDirection: "row",
    height: 44,
    borderRadius: 12,
    overflow: "hidden",
  },
  segmentLeft: {
    flex: 1.3,
    backgroundColor: "#1F9F4E",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
  },
  segmentLeftText: { color: "#fff", fontWeight: "700", fontSize: 12.5, letterSpacing: 0.3 },
  segmentDivider: { width: 1, backgroundColor: "rgba(255,255,255,0.25)" },
  segmentRight: {
    flex: 1,
    backgroundColor: "#17803F",
    alignItems: "center",
    justifyContent: "center",
  },
  segmentRightText: { color: "#fff", fontWeight: "700", fontSize: 12.5, letterSpacing: 0.3 },

  dividerThin: { height: 0.5, backgroundColor: "#f3f4f6", marginVertical: 2 },

  publishBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: "#1F9F4E",
    borderRadius: 14,
    paddingVertical: 15,
    marginTop: 10,
    shadowColor: "#1F9F4E",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 6,
  },
  publishBtnDisabled: { marginHorizontal: 5, backgroundColor: "#b5b6b7ff", shadowOpacity: 0, elevation: 0 },
  publishText: { color: "#fff", fontWeight: "700", fontSize: 16 },
  validationHint: {
    fontSize: 12,
    color: "#ef4444",
    textAlign: "center",
    marginTop: 10,
  },
  footerNote: {
    fontSize: 13,
    color: "#000",
    textAlign: "center",
    marginTop: 12,
    width: "60%",
    alignSelf: "center",
    lineHeight: 16,
  },
  loaderContainer: { flex: 1, justifyContent: "center", alignItems: "center", backgroundColor: "#fff" },
});
