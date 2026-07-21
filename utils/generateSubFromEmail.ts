import * as Crypto from "expo-crypto";

export const generateSubFromEmail = async (email: string) => {
  return await Crypto.digestStringAsync(
    Crypto.CryptoDigestAlgorithm.SHA256,
    email.toLowerCase().trim()
  );
};
