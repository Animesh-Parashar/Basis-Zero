import { getDefaultConfig } from '@rainbow-me/rainbowkit';
import { polygonAmoy, sepolia, baseSepolia } from 'wagmi/chains';

export const config = getDefaultConfig({
  appName: 'Basis Zero',
  projectId: 'YOUR_PROJECT_ID', // TODO: Get from Reown/WalletConnect or use env
  chains: [polygonAmoy, sepolia, baseSepolia], // Polygon Amoy first
  ssr: false,
});
