import * as React from "react";
import * as WebBrowser from "expo-web-browser";
import * as AppleAuthentication from "expo-apple-authentication";
import { AuthUser } from "@/utils/middleware";
import {
  AuthError,
  AuthRequestConfig,
  DiscoveryDocument,
  exchangeCodeAsync,
  makeRedirectUri,
  useAuthRequest,
  AuthSessionResult,
} from "expo-auth-session";
import { tokenCache } from "@/utils/cache";
import { Platform } from "react-native";
import { BASE_URL } from "@/utils/constants";
import * as jose from "jose";
import { handleAppleAuthError } from "@/utils/handleAppleError";
import { randomUUID } from "expo-crypto";

WebBrowser.maybeCompleteAuthSession();

/**
 * Context type definition
 */
type AuthContextType = {
  user: AuthUser | null;
  signIn: () => Promise<void>;
  signOut: () => Promise<void>;
  signInWithApple: () => Promise<void>;
  signInWithAppleWebBrowser: () => Promise<AuthSessionResult | void>;
  fetchWithAuth: (url: string, options: RequestInit) => Promise<Response>;
  isLoading: boolean;
  error: AuthError | null;
  accessToken: string | null;
  idToken: string | null; // ✅ added
};

const AuthContext = React.createContext<AuthContextType | undefined>(undefined);

/**
 * Normalize JWT/session payload into consistent AuthUser
 */
function normalizeUserClaims(payload: any): AuthUser {
  return {
    ...payload,
    name:
      payload.name ||
      [payload.given_name, payload.family_name].filter(Boolean).join(" ") ||
      payload.email ||
      "Unnamed User",
    picture: payload.picture || null,
    email: payload.email || null,
  };
}

const config: AuthRequestConfig = {
  clientId: "google",
  scopes: ["openid", "profile", "email"],
  redirectUri: makeRedirectUri(),
};

const appleConfig: AuthRequestConfig = {
  clientId: "apple",
  scopes: ["name", "email"],
  redirectUri: makeRedirectUri(),
};

const discovery: DiscoveryDocument = {
  authorizationEndpoint: `${BASE_URL}/api/auth/authorize`,
  tokenEndpoint: `${BASE_URL}/api/auth/token`,
};

const appleDiscovery: DiscoveryDocument = {
  authorizationEndpoint: `${BASE_URL}/api/auth/apple/authorize`,
  tokenEndpoint: `${BASE_URL}/api/auth/apple/token`,
};

export const AuthProvider = ({ children }: { children: React.ReactNode }) => {
  const [user, setUser] = React.useState<AuthUser | null>(null);
  const [accessToken, setAccessToken] = React.useState<string | null>(null);
  const [idToken, setIdToken] = React.useState<string | null>(null); // ✅ new
  const [refreshToken, setRefreshToken] = React.useState<string | null>(null);
  const [request, response, promptAsync] = useAuthRequest(config, discovery);
  const [appleRequest, appleResponse, promptAppleAsync] = useAuthRequest(
    appleConfig,
    appleDiscovery
  );
  const [isLoading, setIsLoading] = React.useState(false);
  const [error, setError] = React.useState<AuthError | null>(null);
  const isWeb = Platform.OS === "web";
  const refreshInProgressRef = React.useRef(false);

  React.useEffect(() => {
    handleResponse();
  }, [response]);

  React.useEffect(() => {
    handleAppleResponse();
  }, [appleResponse]);

  // --- restore session effect ---
  React.useEffect(() => {
    const restoreSession = async () => {
      setIsLoading(true);
      try {
        if (isWeb) {
          const sessionResponse = await fetch(`${BASE_URL}/api/auth/session`, {
            method: "GET",
            credentials: "include",
          });

          if (sessionResponse.ok) {
            const userData = await sessionResponse.json();
            setUser(normalizeUserClaims(userData));
          } else {
            try {
              await refreshAccessToken();
            } catch {
              console.log("Failed to refresh token on startup");
            }
          }
        } else {
          const storedAccessToken = await tokenCache?.getToken("accessToken");
          const storedRefreshToken = await tokenCache?.getToken("refreshToken");
          const storedIdToken = await tokenCache?.getToken("idToken"); // ✅ restore

          if (storedAccessToken) {
            try {
              const decoded = jose.decodeJwt(storedAccessToken);
              const exp = (decoded as any).exp;
              const now = Math.floor(Date.now() / 1000);

              if (exp && exp > now) {
                setAccessToken(storedAccessToken);
                setIdToken(storedIdToken || null); // ✅ restore
                if (storedRefreshToken) setRefreshToken(storedRefreshToken);
                setUser(normalizeUserClaims(decoded));
              } else if (storedRefreshToken) {
                setRefreshToken(storedRefreshToken);
                await refreshAccessToken(storedRefreshToken);
              }
            } catch {
              if (storedRefreshToken) {
                setRefreshToken(storedRefreshToken);
                await refreshAccessToken(storedRefreshToken);
              }
            }
          } else if (storedRefreshToken) {
            setRefreshToken(storedRefreshToken);
            await refreshAccessToken(storedRefreshToken);
          }
        }
      } catch (error) {
        console.error("Error restoring session:", error);
      } finally {
        setIsLoading(false);
      }
    };

    restoreSession();
  }, [isWeb]);

  // -----------------------------
  // refresh token
  // -----------------------------
  const refreshAccessToken = async (tokenToUse?: string) => {
    if (refreshInProgressRef.current) return null;
    refreshInProgressRef.current = true;

    try {
      if (isWeb) {
        const refreshResponse = await fetch(`${BASE_URL}/api/auth/refresh`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ platform: "web" }),
          credentials: "include",
        });

        if (!refreshResponse.ok) {
          if (refreshResponse.status === 401) signOut();
          return null;
        }

        const sessionResponse = await fetch(`${BASE_URL}/api/auth/session`, {
          method: "GET",
          credentials: "include",
        });

        if (sessionResponse.ok) {
          const sessionData = await sessionResponse.json();
          setUser(normalizeUserClaims(sessionData));
        }

        return null;
      } else {
        const currentRefreshToken = tokenToUse || refreshToken;
        if (!currentRefreshToken) {
          signOut();
          return null;
        }

        const refreshResponse = await fetch(`${BASE_URL}/api/auth/refresh`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            platform: "native",
            refreshToken: currentRefreshToken,
          }),
        });

        if (!refreshResponse.ok) {
          if (refreshResponse.status === 401) signOut();
          return null;
        }

        const tokens = await refreshResponse.json();
        const newAccessToken = tokens.accessToken;
        const newRefreshToken = tokens.refreshToken;
        const newIdToken = tokens.idToken; // ✅

        if (newAccessToken) setAccessToken(newAccessToken);
        if (newRefreshToken) setRefreshToken(newRefreshToken);
        if (newIdToken) setIdToken(newIdToken); // ✅
        if (newAccessToken)
          await tokenCache?.saveToken("accessToken", newAccessToken);
        if (newRefreshToken)
          await tokenCache?.saveToken("refreshToken", newRefreshToken);
        if (newIdToken) await tokenCache?.saveToken("idToken", newIdToken); // ✅

        if (newAccessToken) {
          const decoded = jose.decodeJwt(newAccessToken);
          setUser(normalizeUserClaims(decoded));
        }

        return newAccessToken;
      }
    } catch (error) {
      console.error("Error refreshing token:", error);
      signOut();
      return null;
    } finally {
      refreshInProgressRef.current = false;
    }
  };

  // -----------------------------
  // helper for native tokens
  // -----------------------------
  const handleNativeTokens = async (tokens: {
    accessToken: string;
    refreshToken: string;
    idToken?: string; // ✅ optional
  }) => {
    if (tokens.accessToken) setAccessToken(tokens.accessToken);
    if (tokens.refreshToken) setRefreshToken(tokens.refreshToken);
    if (tokens.idToken) setIdToken(tokens.idToken); // ✅
    if (tokens.accessToken)
      await tokenCache?.saveToken("accessToken", tokens.accessToken);
    if (tokens.refreshToken)
      await tokenCache?.saveToken("refreshToken", tokens.refreshToken);
    if (tokens.idToken) await tokenCache?.saveToken("idToken", tokens.idToken); // ✅

    if (tokens.accessToken) {
      const decoded = jose.decodeJwt(tokens.accessToken);
      setUser(normalizeUserClaims(decoded));
    }
  };

  // -----------------------------
  // handle Apple OAuth response
  // -----------------------------
  const handleAppleResponse = async () => {
    if (appleResponse?.type === "success") {
      try {
        const { code } = appleResponse.params;
        const response = await exchangeCodeAsync(
          {
            clientId: "apple",
            code,
            redirectUri: makeRedirectUri(),
            extraParams: { platform: Platform.OS },
          },
          appleDiscovery
        );

        if (isWeb) {
          const sessionResponse = await fetch(`${BASE_URL}/api/auth/session`, {
            method: "GET",
            credentials: "include",
          });

          if (sessionResponse.ok) {
            const sessionData = await sessionResponse.json();
            setUser(normalizeUserClaims(sessionData));
          }
        } else {
          await handleNativeTokens({
            accessToken: response.accessToken,
            refreshToken: response.refreshToken!,
            idToken: response.idToken, // ✅
          });
        }
      } catch (e) {
        console.log("Error exchanging Apple code:", e);
      }
    }
  };

  // -----------------------------
  // handle Google OAuth response
  // -----------------------------
  async function handleResponse() {
    if (response?.type === "success") {
      try {
        setIsLoading(true);
        const { code } = response.params;

        const formData = new FormData();
        formData.append("code", code);
        if (isWeb) formData.append("platform", "web");
        if (request?.codeVerifier) formData.append("code_verifier", request.codeVerifier);

        const tokenResponse = await fetch(`${BASE_URL}/api/auth/token`, {
          method: "POST",
          body: formData,
          credentials: isWeb ? "include" : "same-origin",
        });

        if (isWeb) {
          const userData = await tokenResponse.json();
          if (userData.success) {
            const sessionResponse = await fetch(`${BASE_URL}/api/auth/session`, {
              method: "GET",
              credentials: "include",
            });

            if (sessionResponse.ok) {
              const sessionData = await sessionResponse.json();
              setUser(normalizeUserClaims(sessionData));
            }
          }
        } else {
          const tokens = await tokenResponse.json();
          await handleNativeTokens(tokens); // ✅ will now also set idToken
        }
      } catch (e) {
        console.error("Error handling Google auth response:", e);
      } finally {
        setIsLoading(false);
      }
    } else if (response?.type === "error") {
      setError(response?.error as AuthError);
    }
  }

  // -----------------------------
  // API fetch wrapper
  // -----------------------------
  const fetchWithAuth = async (url: string, options: RequestInit) => {
    if (isWeb) {
      const response = await fetch(url, { ...options, credentials: "include" });
      if (response.status === 401) {
        await refreshAccessToken();
        if (user) {
          return fetch(url, { ...options, credentials: "include" });
        }
      }
      return response;
    } else {
      const response = await fetch(url, {
        ...options,
        headers: {
          ...options.headers,
          Authorization: `Bearer ${accessToken}`,
        },
      });
      if (response.status === 401) {
        const newToken = await refreshAccessToken();
        if (newToken) {
          return fetch(url, {
            ...options,
            headers: {
              ...options.headers,
              Authorization: `Bearer ${newToken}`,
            },
          });
        }
      }
      return response;
    }
  };

  // -----------------------------
  // Sign-in methods
  // -----------------------------
  const signIn = async () => {
    if (!request) return;
    await promptAsync();
  };

  const signInWithAppleWebBrowser = async (): Promise<AuthSessionResult | void> => {
    if (!appleRequest) return;
    return promptAppleAsync();
  };

  const signInWithApple = async () => {
    try {
      const rawNonce = randomUUID();
      const credential = await AppleAuthentication.signInAsync({
        requestedScopes: [
          AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
          AppleAuthentication.AppleAuthenticationScope.EMAIL,
        ],
        nonce: rawNonce,
      });

      const appleResponse = await fetch(`${BASE_URL}/api/auth/apple/apple-native`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          identityToken: credential.identityToken,
          rawNonce,
          givenName: credential.fullName?.givenName,
          familyName: credential.fullName?.familyName,
          email: credential.email,
        }),
      });

      const tokens = await appleResponse.json();
      await handleNativeTokens(tokens); // ✅ sets idToken if present
    } catch (e) {
      handleAppleAuthError(e);
    }
  };

  const signOut = async () => {
    if (isWeb) {
      try {
        await fetch(`${BASE_URL}/api/auth/logout`, {
          method: "POST",
          credentials: "include",
        });
      } catch (error) {
        console.error("Error during web logout:", error);
      }
    } else {
      await tokenCache?.deleteToken("accessToken");
      await tokenCache?.deleteToken("refreshToken");
      await tokenCache?.deleteToken("idToken"); // ✅
    }
    setUser(null);
    setAccessToken(null);
    setRefreshToken(null);
    setIdToken(null); // ✅
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        signIn,
        signOut,
        signInWithApple,
        signInWithAppleWebBrowser,
        isLoading,
        error,
        fetchWithAuth,
        accessToken,
        idToken, // ✅ now available
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = React.useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used within an AuthProvider");
  return context;
};
