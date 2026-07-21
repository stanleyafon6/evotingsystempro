// src/ethereumWallet.ts
import { Wallet } from "ethers";
import * as SecureStore from "expo-secure-store";

export async function createWallet() {
  const wallet = Wallet.createRandom();

  // Save private key securely
  await SecureStore.setItemAsync("ETH_PRIVATE_KEY", wallet.privateKey);

  return {
    address: wallet.address,
    mnemonic: wallet.mnemonic?.phrase
  };
}

export async function loadWallet(): Promise<Wallet> {
  const privateKey = await SecureStore.getItemAsync("ETH_PRIVATE_KEY");
  if (!privateKey) throw new Error("Wallet not found");
  return new Wallet(privateKey);
}
