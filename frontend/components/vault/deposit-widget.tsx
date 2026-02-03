"use client"

import { useState, useEffect, useRef } from "react"
import { ArrowRight, CheckCircle, Circle, Wallet, ChevronDown, AlertCircle } from "lucide-react"
import { cn } from "@/lib/utils"
import { useWallet } from "@/hooks/use-wallet"
import { Contract, formatUnits, parseUnits, ZeroAddress, zeroPadValue } from "ethers"
import { Loader2 } from "lucide-react"
import { Confetti, type ConfettiRef } from "@/components/ui/confetti"

const TOKEN_MESSENGER_ABI = [
    "function depositForBurn(uint256 amount, uint32 destinationDomain, bytes32 mintRecipient, address burnToken) external returns (uint64)",
    "function depositForBurn(uint256 amount, uint32 destinationDomain, bytes32 mintRecipient, address burnToken, bytes32 destinationCaller, uint256 maxFee, uint32 minFinalityThreshold) external returns (uint64)"
];

const CCTP_DOMAINS: Record<string, number> = {
    sepolia: 0,
    polygonAmoy: 7,
    arcTestnet: 26,
    baseSepolia: 6
};

const CCTP_CONTRACTS: Record<number, string> = {
    11155111: "0x8FE6B999Dc680CcFDD5Bf7EB0974218be2542DAA", // Sepolia
    80002: "0x8FE6B999Dc680CcFDD5Bf7EB0974218be2542DAA", // Amoy
};

interface ChainConfig {
    id: string
    name: string
    icon: string
    fee: string
    chainId: number
}

// USDC Contract Addresses (Testnet)
const USDC_CONTRACTS: Record<number, string> = {
    11155111: "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238", // Sepolia
    84532: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",    // Base Sepolia
    421614: "0x75faf114eafb1BDbe2F031d8463H1d743Fbc6116a902379C7238", // Arbitrum Sepolia (Verify if needed, generic placeholder)
    80002: "0x41E94Eb019C0762f9Bfcf9Fb1E58725BfB0e7582",    // Polygon Amoy
    5115: "0x3600000000000000000000000000000000000000",     // Arc Testnet
}

const ERC20_ABI = [
    "function balanceOf(address owner) view returns (uint256)",
    "function decimals() view returns (uint8)",
    "function approve(address spender, uint256 amount) returns (bool)"
]

// Map supported chains with their IDs
const chains: ChainConfig[] = [
    { id: "ethereum", name: "Ethereum", icon: "🔷", fee: "~$5.00", chainId: 1 },
    { id: "sepolia", name: "Sepolia", icon: "🔷", fee: "~$5.00", chainId: 11155111 },
    { id: "base", name: "Base", icon: "🔵", fee: "~$0.10", chainId: 8453 },
    { id: "base-sepolia", name: "Base Sepolia", icon: "🔵", fee: "~$0.10", chainId: 84532 },
    { id: "arbitrum", name: "Arbitrum", icon: "🔶", fee: "~$0.30", chainId: 421614 },
    { id: "polygon", name: "Polygon", icon: "🟣", fee: "~$0.05", chainId: 137 },
    { id: "amoy", name: "Polygon Amoy", icon: "🟣", fee: "~$0.05", chainId: 80002 },
    { id: "optimism", name: "Optimism", icon: "🔴", fee: "~$0.20", chainId: 10 },
    { id: "arc", name: "Arc", icon: "🏛️", fee: "~$0.00", chainId: 5115 },
]

export function DepositWidget() {
    const { isConnected, chainId, connect, isConnecting, provider, address } = useWallet()
    const [amount, setAmount] = useState("")
    const [step, setStep] = useState(1)
    const [balance, setBalance] = useState<string>("0.00")

    const [isLoadingBalance, setIsLoadingBalance] = useState(false)
    const [isProcessing, setIsProcessing] = useState(false)
    const [progressStep, setProgressStep] = useState(0)
    const [depositStatus, setDepositStatus] = useState<'idle' | 'success' | 'error'>('idle')
    const [errorMessage, setErrorMessage] = useState("")
    const [backendAddress, setBackendAddress] = useState<string>("")
    const confettiRef = useRef<ConfettiRef>(null)

    // Fetch Backend Relay Address
    useEffect(() => {
        // 1. Fetch Backend Address
        fetch('http://localhost:3001/api/cctp/address')
            .then(res => res.json())
            .then(data => {
                if (data.address) setBackendAddress(data.address)
            })
            .catch(err => console.error("Failed to fetch backend address:", err))
    }, [])

    // Derive current chain from wallet connection
    const connectedChain = chains.find(c => c.chainId === chainId)
    const isUnsupportedChain = isConnected && !connectedChain

    // Fetch USDC Balance
    useEffect(() => {
        const fetchBalance = async () => {
            if (!isConnected || !provider || !address || !chainId) return

            const usdcAddress = USDC_CONTRACTS[chainId]
            if (!usdcAddress) {
                setBalance("0.00")
                return
            }

            setIsLoadingBalance(true)
            try {
                const signer = await provider.getSigner()
                const usdc = new Contract(usdcAddress, ERC20_ABI, signer)

                const [bal, decimals] = await Promise.all([
                    usdc.balanceOf(address),
                    usdc.decimals()
                ])

                setBalance(formatUnits(bal, decimals))
            } catch (error: any) {
                // Ignore network errors that happen during chain switching
                if (error.code === 'NETWORK_ERROR') {
                    return
                }
                console.error("Failed to fetch balance:", error)
                setBalance("0.00") // Fallback
            } finally {
                setIsLoadingBalance(false)
            }
        }

        fetchBalance()
    }, [isConnected, provider, address, chainId])

    // Map chain ID to backend config keys
    const CHAIN_KEY_MAP: Record<number, string> = {
        11155111: 'sepolia',
        80002: 'polygonAmoy',
        5115: 'arcTestnet',
        84532: 'baseSepolia',
    }

    const STEPS_LIST = [
        { id: 1, label: "Initiating Transaction" },
        { id: 2, label: "Bridging Assets to Arc" },
        { id: 3, label: "Verifying Attestation (Oracle)" },
        { id: 4, label: "Depositing into Yield Vault" }
    ]

    const handleDeposit = async () => {
        if (step === 1) {
            setStep(2)
            return
        }

        const chainKey = CHAIN_KEY_MAP[chainId || 0]
        if (!chainKey) {
            console.error("Unsupported chain for deposit")
            setErrorMessage("Unsupported chain. Please switch to a supported testnet.")
            setDepositStatus('error')
            return
        }

        setIsProcessing(true)
        setDepositStatus('idle')
        setErrorMessage("")
        setProgressStep(0)

        try {
            if (!address || !provider) {
                throw new Error("Wallet not connected or provider not available.");
            }

            // Step 1: Initiated
            setProgressStep(1)

            const signer = await provider.getSigner()
            const amountAtomic = parseUnits(amount, 6) // BigInt

            // 1. Get Contracts
            const usdcAddress = USDC_CONTRACTS[chainId || 0]
            const tmAddress = CCTP_CONTRACTS[chainId || 0]

            if (!usdcAddress || !tmAddress) {
                throw new Error("CCTP not supported on this chain")
            }

            if (!backendAddress) {
                throw new Error("Backend relay address not available")
            }

            const usdc = new Contract(usdcAddress, ERC20_ABI, signer)
            const tokenMessenger = new Contract(tmAddress, TOKEN_MESSENGER_ABI, signer)

            // 2. Approve
            setProgressStep(1) // "Initiating" includes approval
            console.log("Approving TokenMessenger...")
            const approveTx = await usdc.approve(tmAddress, amountAtomic)
            await approveTx.wait()

            // 3. DepositForBurn
            console.log("Calling depositForBurn...")
            const destinationDomain = CCTP_DOMAINS['arcTestnet']; // Arc Testnet
            const mintRecipient = zeroPadValue(backendAddress, 32);
            const burnToken = usdcAddress;

            // V2 Params (usually needed for Testnet CCTP)
            const destinationCaller = zeroPadValue(ZeroAddress, 32); // Anyone
            const maxFee = 500; // Match backend config (0.0005 USDC) to enable Fast Transfer?
            const minFinalityThreshold = 1000; // 1000 = Fast Transfer

            // Try V2 call first (with extra params)
            // Note: ethers will pick the matching function signature if overloaded
            const burnTx = await tokenMessenger.depositForBurn(
                amountAtomic,
                destinationDomain,
                mintRecipient,
                burnToken,
                destinationCaller,
                maxFee,
                minFinalityThreshold
            )

            console.log("Burn Tx Sent:", burnTx.hash)

            // Optimistic Update: Show Bridging
            setProgressStep(2)

            // Wait for confirmation? Or send hash immediately?
            // Usually safer to wait for 1 block so backend can find it.
            await burnTx.wait(1)

            // 4. Call Backend Relay
            const response = await fetch('http://localhost:3001/api/cctp/deposit', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    txHash: burnTx.hash,
                    sourceChain: chainKey,
                    userAddress: address
                })
            })

            const result = await response.json()

            if (!response.ok) {
                throw new Error('Transaction failed')
            }

        } catch (error: any) {
            console.error("Deposit error:", error)
            setErrorMessage(error.message || "Failed to process deposit")
            setDepositStatus('error')
            setIsProcessing(false) // Stop spinner 
        }
    }

    // Reset step if wallet disconnects
    useEffect(() => {
        if (!isConnected) {
            setStep(1)
            setAmount("")
            setBalance("0.00")
            setIsProcessing(false)
            setDepositStatus('idle')
            setErrorMessage("")
        }
    }, [isConnected])

    if (!isConnected) {
        return (
            <div className="rounded-xl border border-border bg-card/60 glass overflow-hidden flex flex-col items-center justify-center p-8 text-center space-y-4">
                <div className="h-16 w-16 rounded-full bg-primary/10 flex items-center justify-center mb-2">
                    <Wallet className="h-8 w-8 text-primary" />
                </div>
                <h3 className="text-xl font-bold">Connect Wallet</h3>
                <p className="text-muted-foreground max-w-xs">
                    Connect your wallet to deposit USDC from your current chain into the Yield Vault.
                </p>
                <button
                    onClick={() => connect()}
                    disabled={isConnecting}
                    className="mt-4 px-6 py-3 bg-primary hover:bg-primary/90 text-primary-foreground rounded-lg font-medium transition-colors"
                >
                    {isConnecting ? "Connecting..." : "Connect Wallet"}
                </button>
            </div>
        )
    }

    if (isUnsupportedChain) {
        return (
            <div className="rounded-xl border border-border bg-card/60 glass overflow-hidden flex flex-col items-center justify-center p-8 text-center space-y-4">
                <div className="h-16 w-16 rounded-full bg-yellow-500/10 flex items-center justify-center mb-2">
                    <AlertCircle className="h-8 w-8 text-yellow-500" />
                </div>
                <h3 className="text-xl font-bold">Unsupported Chain</h3>
                <p className="text-muted-foreground max-w-xs">
                    You are connected to an unsupported network (Chain ID: {chainId}).
                    Please switch to Ethereum, Base, Polygon, Arbitrum, Arc, or their testnets.
                </p>
            </div>
        )
    }

    return (
        <div className="rounded-xl border border-border bg-card/60 glass overflow-hidden relative">
            <Confetti
                ref={confettiRef}
                className="absolute inset-0 pointer-events-none z-50 h-full w-full"
            />
            {/* Header */}
            <div className="border-b border-border/50 bg-secondary/40 px-4 py-3">
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                        <div className="flex items-center gap-1.5 px-2 py-1 rounded-md bg-background/50 border border-border/50 text-xs">
                            <span>{connectedChain!.icon}</span>
                            <span className="font-medium">{connectedChain!.name}</span>
                        </div>
                        <ArrowRight className="h-3 w-3 text-muted-foreground" />
                        <div className="flex items-center gap-1.5 px-2 py-1 rounded-md bg-background/50 border border-border/50 text-xs">
                            <VaultIcon className="h-3 w-3 text-primary" />
                            <span className="font-medium">Vault</span>
                        </div>
                    </div>
                    <span className="font-mono text-[10px] text-muted-foreground">
                        Powered by Circle Arc
                    </span>
                </div>
            </div>

            <div className="p-6 space-y-6">
                {/* Progress Steps */}
                <div className="flex items-center justify-center gap-2">
                    {[1, 2].map((s) => (
                        <div key={s} className="flex items-center gap-2">
                            <div className={cn(
                                "flex h-6 w-6 items-center justify-center rounded-full transition-colors",
                                step >= s ? "bg-primary text-primary-foreground" : "bg-secondary text-muted-foreground"
                            )}>
                                {step > s ? (
                                    <CheckCircle className="h-4 w-4" />
                                ) : (
                                    <span className="font-mono text-xs">{s}</span>
                                )}
                            </div>
                            {s < 2 && (
                                <div className={cn(
                                    "h-0.5 w-8",
                                    step > s ? "bg-primary" : "bg-border"
                                )} />
                            )}
                        </div>
                    ))}
                </div>

                {/* Step 1: Enter Amount (formerly Step 2) */}
                {step === 1 && (
                    <div className="space-y-4">
                        <label className="block font-mono text-xs text-muted-foreground uppercase tracking-wider">
                            Deposit Amount (USDC)
                        </label>
                        <div className="relative">
                            <input
                                type="number"
                                value={amount}
                                onChange={(e) => setAmount(e.target.value)}
                                placeholder="0.00"
                                className="w-full rounded-lg border border-border bg-secondary/50 px-4 py-2 pr-20 font-mono text-2xl focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"

                            />
                            <div className="absolute right-4 top-1/2 -translate-y-1/2 flex items-center gap-2">
                                <span className="font-mono text-sm text-muted-foreground">USDC</span>
                            </div>
                        </div>
                        <div className="flex items-center justify-between text-xs text-muted-foreground">
                            <span>Available: {isLoadingBalance ? "Loading..." : `${Number(balance).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 6 })} USDC`}</span>
                            <button
                                onClick={() => setAmount(balance)}
                                className="text-primary hover:underline"
                                disabled={isLoadingBalance}
                            >
                                MAX
                            </button>
                        </div>

                        <div className="rounded-lg bg-secondary/30 p-3 text-xs text-muted-foreground flex items-center gap-2">
                            <span className="text-xl">{connectedChain!.icon}</span>
                            <span>
                                Depositing from <strong>{connectedChain!.name}</strong>.
                                Estimated fee: {connectedChain!.fee}
                            </span>
                        </div>
                    </div>
                )}

                {/* Step 2: Confirm (formerly Step 3) */}
                {step === 2 && (
                    <div className="space-y-4">
                        <div className="rounded-lg border border-primary/30 bg-primary/10 p-4 space-y-3">
                            <div className="flex items-center justify-between text-sm">
                                <span className="text-muted-foreground">From</span>
                                <span className="font-medium flex items-center gap-1">
                                    {connectedChain!.icon} {connectedChain!.name}
                                </span>
                            </div>
                            <div className="flex items-center justify-center">
                                <ArrowRight className="h-4 w-4 text-primary" />
                            </div>
                            <div className="flex items-center justify-between text-sm">
                                <span className="text-muted-foreground">To</span>
                                <span className="font-medium">Basis Zero Vault</span>
                            </div>
                            <div className="border-t border-border/50 pt-3 flex items-center justify-between">
                                <span className="text-muted-foreground">Amount</span>
                                <span className="font-mono font-bold text-lg">${Number(amount).toLocaleString()} USDC</span>
                            </div>
                            <div className="flex items-center justify-between text-sm">
                                <span className="text-muted-foreground">Est. Fee</span>
                                <span>{connectedChain!.fee}</span>
                            </div>
                        </div>
                        <p className="text-xs text-center text-muted-foreground">
                            Your USDC will be deposited into the RWA yield vault, earning 5.12% APY
                        </p>
                    </div>
                )}

                {/* Action Button */}
                {/* Action Button */}
                {/* Action Button */}
                {/* Action Button or Progress View */}
                {isProcessing || depositStatus === 'success' ? (
                    <div className="w-full rounded-xl border border-border bg-black/40 p-4 space-y-3">
                        {STEPS_LIST.map((s, i) => {
                            const isCompleted = i + 1 < progressStep || depositStatus === 'success';
                            const isCurrent = i + 1 === progressStep && depositStatus !== 'success';
                            const isPending = i + 1 > progressStep && depositStatus !== 'success';

                            return (
                                <div key={s.id} className="flex items-center gap-3">
                                    <div className={cn(
                                        "flex items-center justify-center h-6 w-6 rounded-full border transition-all",
                                        isCompleted ? "bg-green-500 border-green-500 text-black" :
                                            isCurrent ? "border-primary text-primary" :
                                                "border-muted text-muted-foreground"
                                    )}>
                                        {isCompleted ? <CheckCircle className="h-4 w-4" /> :
                                            isCurrent ? <Loader2 className="h-3 w-3 animate-spin" /> :
                                                <div className="h-2 w-2 rounded-full bg-current opacity-50" />}
                                    </div>
                                    <span className={cn(
                                        "text-sm font-medium transition-colors",
                                        isCompleted ? "text-white" :
                                            isCurrent ? "text-white animate-pulse" :
                                                "text-muted-foreground"
                                    )}>
                                        {s.label}
                                    </span>
                                </div>
                            )
                        })}

                        {depositStatus === 'success' && (
                            <div className="pt-2 text-center">
                                <p className="text-green-400 text-sm font-bold flex items-center justify-center gap-2">
                                    <CheckCircle className="h-4 w-4" />
                                    Deposit Successful!
                                </p>
                            </div>
                        )}
                    </div>
                ) : (
                    <button
                        onClick={handleDeposit}
                        disabled={step === 1 && !amount}
                        className="group relative w-full outline-none focus:outline-none"
                    >
                        {/* Background Layer (Static/Base) */}
                        <div className={cn(
                            "absolute inset-0 border-2 border-dashed transition-all duration-300 rounded-xl",
                            step === 1 && !amount
                                ? "border-muted bg-muted/5"
                                : "border-gray-600 bg-gray-900/20 group-hover:border-gray-400 group-hover:shadow-lg group-hover:shadow-white/10"
                        )} />

                        {/* Foreground Layer (Moves) */}
                        <div className={cn(
                            "relative flex items-center justify-center border-2 border-dashed px-8 py-4 text-base font-bold transition-all duration-300 transform rounded-xl",
                            step === 1 && !amount
                                ? "border-muted text-muted-foreground translate-x-0 translate-y-0"
                                : "border-gray-400 bg-transparent text-white translate-x-1 translate-y-1 group-hover:translate-x-0 group-hover:translate-y-0 group-hover:border-gray-300 group-hover:bg-gray-900/30"
                        )}>
                            <span className="flex items-center gap-3">
                                {step === 1 ? (
                                    <>
                                        <span>Review Deposit</span>
                                        <ArrowRight className="h-4 w-4" />
                                    </>
                                ) : (
                                    <>
                                        <span>Confirm Deposit</span>
                                        <CheckCircle className="h-4 w-4" />
                                    </>
                                )}
                            </span>
                        </div>
                    </button>
                )}

                {errorMessage && (
                    <div className="mt-3 p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-500 text-sm text-center">
                        {errorMessage}
                    </div>
                )}

                {step > 1 && (
                    <button
                        onClick={() => setStep(step - 1)}
                        className="w-full text-center text-sm text-muted-foreground hover:text-foreground"
                    >
                        ← Back
                    </button>
                )}
            </div>
        </div>
    )
}

function VaultIcon({ className }: { className?: string }) {
    return (
        <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className={className}
        >
            <rect width="18" height="18" x="3" y="3" rx="2" />
            <circle cx="7.5" cy="7.5" r=".5" fill="currentColor" />
            <path d="m7.9 7.9 2.7 2.7" />
            <circle cx="16.5" cy="7.5" r=".5" fill="currentColor" />
            <path d="m13.4 10.6 2.7-2.7" />
            <circle cx="7.5" cy="16.5" r=".5" fill="currentColor" />
            <path d="m7.9 16.1 2.7-2.7" />
            <circle cx="16.5" cy="16.5" r=".5" fill="currentColor" />
            <path d="m13.4 13.4 2.7 2.7" />
            <circle cx="12" cy="12" r="2" />
        </svg>
    )
}
