import { getDefaultConfig } from '@rainbow-me/rainbowkit';
import { mainnet, sepolia } from 'wagmi/chains';

export const config = getDefaultConfig({
  appName: 'Covenant Sentinel',
  projectId: process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID || 'YOUR_PROJECT_ID',
  chains: [sepolia, mainnet],
  ssr: true,
});

export const SUPPORTED_CHAINS = {
  sepolia,
  mainnet,
};

export const PRIMARY_CHAIN = sepolia;
export const PRIMARY_CHAIN_ID = sepolia.id;


