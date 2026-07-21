// src/ethereumSendToken.ts
import { Contract } from "ethers";
import { loadWallet } from "./ethereumWallet";
import { provider } from "./ethereumProvider";

// Minimal ERC-20 ABI
const erc20Abi = [
  "function transfer(address to, uint256 amount) returns (bool)"
];

export async function ethereumSendToken(
  tokenAddress: string,
  to: string,
  amount: bigint
) {
  const wallet = await loadWallet();
  const signer = wallet.connect(provider);

  const token = new Contract(tokenAddress, erc20Abi, signer);

  const tx = await token.transfer(to, amount);
  await tx.wait(); // Wait for confirmation

  return tx.hash;
}
