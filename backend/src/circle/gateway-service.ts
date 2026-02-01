/**
 * Circle Gateway Service
 * 
 * Integrates with Circle's Gateway API for:
 * - Unified USDC balance management across chains
 * - Cross-chain deposit attestations
 * - Instant transfers via burn-intent signatures
 * 
 * @see https://developers.circle.com/gateway
 */

import { Router } from 'express';
import {
  createPublicClient,
  createWalletClient,
  http,
  type Address,
  type Hex,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { arbitrumSepolia, baseSepolia, sepolia, avalancheFuji } from 'viem/chains';

// ═══════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════

export interface UnifiedBalance {
  address: string;
  totalBalance: bigint;
  chainBalances: Record<number, bigint>;
  lastUpdated: number;
}

export interface TransferIntent {
  from: Address;
  to: Address;
  amount: bigint;
  sourceChain: number;
  destinationChain: number;
  signature: string;
}

interface BurnIntent {
  depositor: Address;
  amount: bigint;
  nonce: bigint;
  sourceDomain: number;
  destinationDomain: number;
  recipient: Address;
  maxFee: bigint;
  deadline: bigint;
}

interface GatewayBalanceResponse {
  balances: Array<{
    domain: number;
    balance: string;
  }>;
}

interface GatewayInfoResponse {
  domains: Array<{
    chain: string;
    network: string;
    domain: number;
    walletContract?: Address;
    minterContract?: Address;
  }>;
}

interface TransferResponse {
  attestations: Array<{
    burnIntent: BurnIntent;
    attestation: string;
  }>;
}

// ═══════════════════════════════════════════════════════════════════════════
// GATEWAY API CLIENT
// ═══════════════════════════════════════════════════════════════════════════

class GatewayApiClient {
  private baseUrl: string;

  // CCTP Domain identifiers
  static DOMAINS: Record<string, number> = {
    ethereum: 0,
    mainnet: 0,
    sepolia: 0,
    avalanche: 1,
    avalancheFuji: 1,
    arbitrum: 3,
    arbitrumSepolia: 3,
    base: 6,
    baseSepolia: 6,
  };

  static CHAINS: Record<number, string> = {
    0: 'Ethereum',
    1: 'Avalanche',
    3: 'Arbitrum',
    6: 'Base',
  };

  constructor(testnet = true) {
    this.baseUrl = testnet
      ? 'https://gateway-api-testnet.circle.com/v1'
      : 'https://gateway-api.circle.com/v1';
  }

  /**
   * Get Gateway API info including supported chains
   */
  async info(): Promise<GatewayInfoResponse> {
    return this.get('/info');
  }

  /**
   * Get unified balances for a depositor across chains
   */
  async balances(
    token: 'USDC' | 'EURC',
    depositor: Address,
    domains?: number[]
  ): Promise<GatewayBalanceResponse> {
    const sourceDomains = domains || Object.keys(GatewayApiClient.CHAINS).map(Number);
    
    return this.post('/balances', {
      token,
      sources: sourceDomains.map((domain) => ({
        depositor,
        domain,
      })),
    });
  }

  /**
   * Submit burn intents to get attestation for minting
   */
  async transfer(burnIntents: Array<{ burnIntent: BurnIntent; signature: string }>): Promise<TransferResponse> {
    return this.post('/transfer', { burnIntents });
  }

  private async get<T>(path: string): Promise<T> {
    const response = await fetch(`${this.baseUrl}${path}`);
    if (!response.ok) {
      throw new Error(`Gateway API error: ${response.status}`);
    }
    return response.json();
  }

  private async post<T>(path: string, body: unknown): Promise<T> {
    const response = await fetch(`${this.baseUrl}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body, (_key, value) =>
        typeof value === 'bigint' ? value.toString() : value
      ),
    });
    if (!response.ok) {
      throw new Error(`Gateway API error: ${response.status}`);
    }
    return response.json();
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// BURN INTENT TYPED DATA (EIP-712)
// ═══════════════════════════════════════════════════════════════════════════

const BURN_INTENT_TYPES = {
  BurnIntent: [
    { name: 'depositor', type: 'address' },
    { name: 'amount', type: 'uint256' },
    { name: 'nonce', type: 'uint256' },
    { name: 'sourceDomain', type: 'uint32' },
    { name: 'destinationDomain', type: 'uint32' },
    { name: 'recipient', type: 'bytes32' },
    { name: 'maxFee', type: 'uint256' },
    { name: 'deadline', type: 'uint256' },
  ],
} as const;

function createBurnIntentTypedData(
  intent: BurnIntent,
  walletContractAddress: Address,
  chainId: number
) {
  // Convert address to bytes32 format
  const recipientBytes32 = `0x000000000000000000000000${intent.recipient.slice(2)}` as Hex;

  return {
    domain: {
      name: 'GatewayWallet',
      version: '1',
      chainId,
      verifyingContract: walletContractAddress,
    },
    types: BURN_INTENT_TYPES,
    primaryType: 'BurnIntent' as const,
    message: {
      depositor: intent.depositor,
      amount: intent.amount,
      nonce: intent.nonce,
      sourceDomain: intent.sourceDomain,
      destinationDomain: intent.destinationDomain,
      recipient: recipientBytes32,
      maxFee: intent.maxFee,
      deadline: intent.deadline,
    },
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// CIRCLE GATEWAY SERVICE
// ═══════════════════════════════════════════════════════════════════════════

export class CircleGatewayService {
  public router: Router;
  private gatewayClient: GatewayApiClient;
  private balanceCache: Map<string, UnifiedBalance> = new Map();
  private walletClient: ReturnType<typeof createWalletClient> | null = null;
  private serverAddress: Address | null = null;

  // Chain configurations
  private chains = {
    sepolia: { chain: sepolia, chainId: 11155111 },
    avalancheFuji: { chain: avalancheFuji, chainId: 43113 },
    baseSepolia: { chain: baseSepolia, chainId: 84532 },
    arbitrumSepolia: { chain: arbitrumSepolia, chainId: 421614 },
  };

  // Gateway wallet contract addresses (testnet)
  private walletContracts: Record<number, Address> = {
    0: '0x...' as Address, // Ethereum Sepolia - filled from API
    1: '0x...' as Address, // Avalanche Fuji
    3: '0x...' as Address, // Arbitrum Sepolia
    6: '0x...' as Address, // Base Sepolia
  };

  // Vault address on destination chain (Arbitrum)
  private vaultAddress: Address = (process.env.VAULT_ADDRESS || '0x...') as Address;

  constructor() {
    this.router = Router();
    this.gatewayClient = new GatewayApiClient(true); // testnet
    this.setupRoutes();
    this.initializeContracts();
  }

  private async initializeContracts() {
    try {
      const info = await this.gatewayClient.info();
      for (const domain of info.domains) {
        if (domain.walletContract) {
          this.walletContracts[domain.domain] = domain.walletContract;
        }
      }
      console.log('🔵 Circle Gateway contracts initialized');
    } catch (error) {
      console.error('Failed to initialize Gateway contracts:', error);
    }
  }

  private setupRoutes() {
    // Initialize with server wallet
    this.router.post('/init', async (req, res) => {
      try {
        const { privateKey } = req.body;
        await this.initialize(privateKey);
        res.json({ success: true, address: this.serverAddress });
      } catch (error) {
        res.status(500).json({ error: String(error) });
      }
    });

    // Get unified balance for a user
    this.router.get('/balance/:address', async (req, res) => {
      try {
        const balance = await this.getUnifiedBalance(req.params.address as Address);
        res.json({
          address: balance.address,
          totalBalance: balance.totalBalance.toString(),
          chainBalances: Object.fromEntries(
            Object.entries(balance.chainBalances).map(([k, v]) => [k, v.toString()])
          ),
          lastUpdated: balance.lastUpdated,
        });
      } catch (error) {
        res.status(500).json({ error: 'Failed to fetch balance' });
      }
    });

    // Initiate cross-chain deposit to vault
    this.router.post('/deposit', async (req, res) => {
      try {
        const { sourceChain, amount, userAddress } = req.body;
        const result = await this.initiateDeposit(
          userAddress as Address,
          sourceChain,
          BigInt(amount)
        );
        res.json(result);
      } catch (error) {
        res.status(500).json({ error: String(error) });
      }
    });

    // Transfer from unified balance to Arbitrum vault
    this.router.post('/transfer-to-vault', async (req, res) => {
      try {
        const { userAddress, sources, totalAmount } = req.body;
        const result = await this.transferToVault(
          userAddress as Address,
          sources as Array<{ domain: number; amount: string }>,
          BigInt(totalAmount)
        );
        res.json(result);
      } catch (error) {
        res.status(500).json({ error: String(error) });
      }
    });

    // Get attestation for cross-chain transfer
    this.router.post('/attestation', async (req, res) => {
      try {
        const { burnIntents } = req.body;
        const result = await this.gatewayClient.transfer(burnIntents);
        res.json(result);
      } catch (error) {
        res.status(500).json({ error: 'Failed to get attestation' });
      }
    });

    // Get supported chains
    this.router.get('/info', async (_req, res) => {
      try {
        const info = await this.gatewayClient.info();
        res.json(info);
      } catch (error) {
        res.status(500).json({ error: 'Failed to get Gateway info' });
      }
    });
  }

  /**
   * Initialize with server wallet
   */
  async initialize(privateKey: Hex): Promise<void> {
    const account = privateKeyToAccount(privateKey);
    this.serverAddress = account.address;

    this.walletClient = createWalletClient({
      account,
      chain: arbitrumSepolia,
      transport: http(),
    });

    console.log(`🔵 Circle Gateway Service initialized with address: ${this.serverAddress}`);
  }

  /**
   * Fetch unified USDC balance across all supported chains
   */
  async getUnifiedBalance(address: Address): Promise<UnifiedBalance> {
    try {
      const response = await this.gatewayClient.balances('USDC', address);

      const chainBalances: Record<number, bigint> = {};
      let totalBalance = BigInt(0);

      for (const balance of response.balances) {
        const amount = BigInt(Math.floor(parseFloat(balance.balance) * 1e6)); // USDC has 6 decimals
        chainBalances[balance.domain] = amount;
        totalBalance += amount;
      }

      const unified: UnifiedBalance = {
        address,
        totalBalance,
        chainBalances,
        lastUpdated: Date.now(),
      };

      // Cache the balance
      this.balanceCache.set(address.toLowerCase(), unified);

      return unified;
    } catch (error) {
      console.error('Failed to fetch unified balance:', error);
      // Return cached if available
      const cached = this.balanceCache.get(address.toLowerCase());
      if (cached) return cached;

      return {
        address,
        totalBalance: BigInt(0),
        chainBalances: {},
        lastUpdated: Date.now(),
      };
    }
  }

  /**
   * Initiate a deposit from any chain into the Velocity Yield Vault
   * 
   * Flow:
   * 1. User deposits USDC into Gateway wallet contract on source chain
   * 2. User calls this to sign burn intent
   * 3. Send burn intent to Gateway API for attestation
   * 4. Execute mint on Arbitrum and deposit into vault
   */
  async initiateDeposit(
    userAddress: Address,
    sourceChain: string,
    amount: bigint
  ): Promise<{ success: boolean; message: string; steps: string[] }> {
    const domain = GatewayApiClient.DOMAINS[sourceChain];
    if (domain === undefined) {
      throw new Error(`Unsupported source chain: ${sourceChain}`);
    }

    // Instructions for user
    const steps = [
      `1. Approve USDC spending for Gateway Wallet on ${sourceChain}`,
      `2. Deposit ${amount} USDC into Gateway Wallet contract at ${this.walletContracts[domain]}`,
      `3. Wait for finalization (varies by chain)`,
      `4. Sign burn intent to transfer to Arbitrum vault`,
      `5. Mint USDC on Arbitrum and auto-deposit into vault`,
    ];

    return {
      success: true,
      message: `Deposit flow initiated for ${amount} USDC from ${sourceChain}`,
      steps,
    };
  }

  /**
   * Transfer from unified balance to Arbitrum vault
   * 
   * @param userAddress - User's address
   * @param sources - Array of sources { domain, amount }
   * @param _totalAmount - Total amount to transfer (unused, calculated from sources)
   */
  async transferToVault(
    userAddress: Address,
    sources: Array<{ domain: number; amount: string }>,
    _totalAmount: bigint
  ): Promise<{ success: boolean; attestations?: TransferResponse }> {
    if (!this.walletClient) {
      throw new Error('Service not initialized');
    }

    const destinationDomain = GatewayApiClient.DOMAINS.arbitrumSepolia;
    const deadline = BigInt(Math.floor(Date.now() / 1000) + 3600); // 1 hour

    // Create and sign burn intents for each source
    const signedIntents: Array<{ burnIntent: BurnIntent; signature: string }> = [];

    for (const source of sources) {
      const burnIntent: BurnIntent = {
        depositor: userAddress,
        amount: BigInt(source.amount),
        nonce: BigInt(Date.now()), // Simple nonce strategy
        sourceDomain: source.domain,
        destinationDomain,
        recipient: this.vaultAddress, // Mint directly to vault
        maxFee: BigInt(0), // No fee limit
        deadline,
      };

      // Get chain ID for source domain
      const chainId = this.getChainIdForDomain(source.domain);
      const walletContract = this.walletContracts[source.domain];

      // Create typed data for signature
      const typedData = createBurnIntentTypedData(burnIntent, walletContract, chainId);

      // Note: In production, user would sign this on frontend
      // For demo, we're showing the structure
      const signature = await this.walletClient.signTypedData({
        ...typedData,
        account: this.walletClient.account!,
      });

      signedIntents.push({
        burnIntent,
        signature,
      });
    }

    // Submit to Gateway API
    const result = await this.gatewayClient.transfer(signedIntents);

    return {
      success: true,
      attestations: result,
    };
  }

  /**
   * Get chain ID for a CCTP domain
   */
  private getChainIdForDomain(domain: number): number {
    const mapping: Record<number, number> = {
      0: 11155111, // Ethereum Sepolia
      1: 43113,    // Avalanche Fuji
      3: 421614,   // Arbitrum Sepolia
      6: 84532,    // Base Sepolia
    };
    return mapping[domain] || 0;
  }
}

export default CircleGatewayService;
