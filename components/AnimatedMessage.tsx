// ✅ Put this ABOVE your component (or in a separate file)
import React, { useRef, useEffect } from "react";
import { Animated } from "react-native";

export const AnimatedMessage: React.FC<{ children: React.ReactNode; shouldAnimate?: boolean }> = ({
  children,
  shouldAnimate = false,
}) => {
  const fadeAnim = useRef(new Animated.Value(shouldAnimate ? 0 : 1)).current;
  const translateY = useRef(new Animated.Value(shouldAnimate ? 10 : 0)).current;

  useEffect(() => {
    if (shouldAnimate) {
      Animated.parallel([
        Animated.timing(fadeAnim, {
          toValue: 1,
          duration: 250,
          useNativeDriver: true,
        }),
        Animated.spring(translateY, {
          toValue: 0,
          friction: 6,
          tension: 50,
          useNativeDriver: true,
        }),
      ]).start();
    }
  }, [shouldAnimate]);

  return (
    <Animated.View
      style={{
        opacity: fadeAnim,
        transform: [{ translateY }],
      }}
    >
      {children}
    </Animated.View>
  );
};
