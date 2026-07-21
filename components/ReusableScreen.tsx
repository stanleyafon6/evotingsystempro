// components/ReusableScreen.tsx
import React, { useEffect } from "react";
import {
  View,
  StyleSheet,
  useWindowDimensions,
  Platform,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

export default function ReusableScreen({ children }: { children: React.ReactNode }) {
  const { height, width } = useWindowDimensions();
  const screenWidth = (width - height) <= (width / 4) ? "100%" : "30%";


  return (
    <>
      <SafeAreaView style={styles.safeArea} edges={["top"]}>
        <View style={[styles.container, { width: screenWidth }]}>
          {children}
        </View>
      </SafeAreaView>
    </>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: "#ddd",
    alignItems: "center",
  },
  container: {
    flex: 1,
    backgroundColor: "#fff",
  },
});
