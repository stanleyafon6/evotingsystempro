// src/ethereumProvider.ts
import { JsonRpcProvider } from "ethers";

// Use Sepolia testnet first
export const provider = new JsonRpcProvider(
  "https://sepolia.infura.io/v3/YOUR_INFURA_KEY"
);
