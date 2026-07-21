import { useEffect, useRef, useState } from "react";
import * as Network from "expo-network";

export const useNetworkStatus = (
  onReconnect?: () => void
) => {
  const [isConnected, setIsConnected] = useState<boolean>(true);
  const hasCheckedOnce = useRef(false);

  useEffect(() => {
    let isMounted = true;

    const checkConnection = async () => {
      try {
        const state = await Network.getNetworkStateAsync();
        if (!isMounted) return;

        const connected = !!state.isConnected;

        setIsConnected(prev => {
          // 🔥 Trigger only when connection is restored
          if (hasCheckedOnce.current && !prev && connected) {
            onReconnect?.();
          }
          return connected;
        });

        hasCheckedOnce.current = true;
      } catch {
        // Fail safe: assume offline
        setIsConnected(false);
      }
    };

    // Initial check
    checkConnection();

    // Optional polling (keeps state fresh)
    const interval = setInterval(checkConnection, 5000);

    return () => {
      isMounted = false;
      clearInterval(interval);
    };
  }, [onReconnect]);

  return isConnected;
};
