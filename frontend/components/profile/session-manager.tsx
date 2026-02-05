"use client"

import { useState, useEffect } from "react"
import { Wifi, WifiOff, Zap, Clock, RefreshCw, Loader2, XCircle, AlertTriangle, ExternalLink, CheckCircle, Banknote } from "lucide-react"
import { cn } from "@/lib/utils"
import { useArcVault, SessionState } from "@/hooks/use-arc-vault"
import { useWriteContract, useWaitForTransactionReceipt, useAccount, useReadContract, useChainId, useSwitchChain } from "wagmi"
import { ARC_VAULT_ADDRESS, ARC_VAULT_ABI, ARC_USDC_ADDRESS, ERC20_ABI } from "@/lib/contracts"
import { useQuery } from "@tanstack/react-query"
import { parseUnits, formatUnits } from "viem"
import { arcTestnet } from "@/lib/wagmi"
import Link from "next/link"

// Fetch user positions
async function fetchUserPositions(userId: string) {
    if (!userId) return { positions: [], totalValue: '0' };
    const response = await fetch(`/api/amm/positions/${userId}`);
    if (!response.ok) return { positions: [], totalValue: '0' };
    return response.json();
}

export function SessionManager() {
    const { 
        sessionState, 
        lockedAmount, 
        sessionId, 
        sessionStartedAt,
        timeUntilTimeout,
        isLoading,
        refetch 
    } = useArcVault()
    
    const { address } = useAccount()
    const chainId = useChainId()
    const { switchChain } = useSwitchChain()
    
    // UI State
    const [showCloseModal, setShowCloseModal] = useState(false)
    const [showFundModal, setShowFundModal] = useState(false)
    
    // Fetch positions to check if user can close directly
    const { data: positionsData, refetch: refetchPositions } = useQuery({
        queryKey: ['user-positions', sessionId],
        queryFn: () => fetchUserPositions(sessionId || ''),
        enabled: !!sessionId,
    })
    
    const totalPositionsValue = parseFloat(positionsData?.totalValue || '0') / 1_000_000
    // Only consider positions if they have actual value (not just empty records)
    const hasPositions = totalPositionsValue > 0
    
    // Read wallet USDC balance
    const { data: usdcBalance, refetch: refetchBalance } = useReadContract({
        address: ARC_USDC_ADDRESS,
        abi: ERC20_ABI,
        functionName: "balanceOf",
        args: [address!],
        chainId: arcTestnet.id,
        query: { enabled: !!address }
    })
    
    const walletBalance = usdcBalance ? formatUnits(usdcBalance as bigint, 6) : "0"
    const walletBalanceNum = parseFloat(walletBalance)
    const lockedAmountNum = parseFloat(lockedAmount) || 0
    const hasEnoughForFunding = walletBalanceNum >= lockedAmountNum
    
    // Cancel session tx
    const { writeContract: writeCancelSession, data: cancelHash, isPending: isCancelling } = useWriteContract()
    const { isLoading: isWaitingCancel, isSuccess: isCancelSuccess } = useWaitForTransactionReceipt({ hash: cancelHash })

    // Fund escrow tx (transfer USDC to vault)
    const { writeContract: writeFund, data: fundHash, isPending: isFunding, error: fundError } = useWriteContract()
    const { isLoading: isWaitingFund, isSuccess: isFundSuccess } = useWaitForTransactionReceipt({ hash: fundHash })

    // Refetch after cancel
    useEffect(() => {
        if (isCancelSuccess) {
            refetch()
            refetchPositions()
            setShowCloseModal(false)
        }
    }, [isCancelSuccess])

    // Refetch after funding
    useEffect(() => {
        if (isFundSuccess) {
            refetchBalance()
            setShowFundModal(false)
        }
    }, [isFundSuccess])

    const isSessionActive = sessionState === SessionState.Active || sessionState === SessionState.PendingBridge
    const isPendingBridge = sessionState === SessionState.PendingBridge
    const isActive = sessionState === SessionState.Active
    const canCancel = isPendingBridge && timeUntilTimeout <= 0
    
    // Format session duration
    const formatDuration = () => {
        if (!sessionStartedAt || sessionStartedAt === 0) return "N/A"
        const now = Math.floor(Date.now() / 1000)
        const duration = now - sessionStartedAt
        const minutes = Math.floor(duration / 60)
        const seconds = duration % 60
        return `${minutes}m ${seconds}s`
    }

    // Get session state label
    const getSessionLabel = () => {
        switch (sessionState) {
            case SessionState.None: return "No Session"
            case SessionState.PendingBridge: return "Pending Bridge"
            case SessionState.Active: return "Active"
            case SessionState.Settled: return "Settled"
            case SessionState.Cancelled: return "Cancelled"
            default: return "Unknown"
        }
    }

    const handleCancelSession = () => {
        if (!address) return
        
        writeCancelSession({
            address: ARC_VAULT_ADDRESS,
            abi: ARC_VAULT_ABI,
            functionName: "cancelTimedOutSession",
            args: [address]
        })
    }

    // State for backend close session API
    const [isClosingViaBackend, setIsClosingViaBackend] = useState(false)
    const [closeError, setCloseError] = useState<string | null>(null)
    const [closeSuccess, setCloseSuccess] = useState(false)

    const handleCloseSession = async () => {
        if (!address) return
        
        setIsClosingViaBackend(true)
        setCloseError(null)
        setCloseSuccess(false)
        
        try {
            // Call backend API to close session (backend has authorized relayer)
            const response = await fetch('/api/session/close', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ user: address, pnl: 0 })
            })
            
            const data = await response.json()
            
            if (!response.ok) {
                throw new Error(data.error || 'Failed to close session')
            }
            
            setCloseSuccess(true)
            refetch()
            refetchPositions()
            
            // Close modal after short delay to show success
            setTimeout(() => {
                setShowCloseModal(false)
                setCloseSuccess(false)
            }, 2000)
        } catch (error) {
            console.error('Close session error:', error)
            setCloseError(error instanceof Error ? error.message : 'Failed to close session')
        } finally {
            setIsClosingViaBackend(false)
        }
    }

    const handleFundEscrow = () => {
        if (!address || !lockedAmountNum) return
        
        if (chainId !== arcTestnet.id) {
            switchChain({ chainId: arcTestnet.id })
            return
        }
        
        // Transfer USDC = locked amount to the vault
        const amountBig = parseUnits(lockedAmount, 6)
        writeFund({
            address: ARC_USDC_ADDRESS,
            abi: ERC20_ABI,
            functionName: "transfer",
            args: [ARC_VAULT_ADDRESS, amountBig]
        })
    }

    const isProcessing = isCancelling || isWaitingCancel || isClosingViaBackend
    const isFundingProcessing = isFunding || isWaitingFund

    return (
        <>
            <div className="rounded-xl border border-border bg-card/60 glass overflow-hidden">
                {/* Header */}
                <div className="border-b border-border/50 bg-secondary/40 px-4 py-3">
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                            <Zap className="h-4 w-4 text-primary" />
                            <h3 className="font-mono text-xs uppercase tracking-wider text-primary">
                                Trading Session
                            </h3>
                        </div>
                        <div className={cn(
                            "flex items-center gap-2 px-2 py-1 rounded-full text-xs font-mono",
                            isSessionActive
                                ? "bg-green-500/20 text-green-500"
                                : "bg-muted/20 text-muted-foreground"
                        )}>
                            {isSessionActive ? (
                                <>
                                    <Wifi className="h-3 w-3" />
                                    {getSessionLabel()}
                                </>
                            ) : (
                                <>
                                    <WifiOff className="h-3 w-3" />
                                    {getSessionLabel()}
                                </>
                            )}
                        </div>
                    </div>
                </div>

                <div className="p-6 space-y-6">
                    {isLoading ? (
                        <div className="flex items-center justify-center py-8">
                            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                        </div>
                    ) : (
                        <>
                            {/* Session Stats */}
                            <div className="grid grid-cols-3 gap-4">
                                <div className="text-center p-3 rounded-lg bg-secondary/30">
                                    <p className="font-mono text-xl font-bold text-foreground">
                                        {isSessionActive ? 1 : 0}
                                    </p>
                                    <p className="font-mono text-[10px] text-muted-foreground uppercase">Active</p>
                                </div>
                                <div className="text-center p-3 rounded-lg bg-secondary/30">
                                    <p className="font-mono text-xl font-bold text-primary">
                                        ${parseFloat(lockedAmount).toFixed(2)}
                                    </p>
                                    <p className="font-mono text-[10px] text-muted-foreground uppercase">Locked</p>
                                </div>
                                <div className="text-center p-3 rounded-lg bg-secondary/30">
                                    <p className="font-mono text-xl font-bold text-foreground">
                                        {isSessionActive ? formatDuration() : "N/A"}
                                    </p>
                                    <p className="font-mono text-[10px] text-muted-foreground uppercase">Duration</p>
                                </div>
                            </div>

                            {/* Session Details */}
                            {isSessionActive && (
                                <div className="space-y-2">
                                    <div className="flex items-center justify-between mb-3">
                                        <p className="font-mono text-xs text-muted-foreground uppercase tracking-wider">
                                            Session Details
                                        </p>
                                        <button 
                                            onClick={() => refetch()}
                                            className="text-xs text-primary hover:underline flex items-center gap-1"
                                        >
                                            <RefreshCw className="h-3 w-3" />
                                            Refresh
                                        </button>
                                    </div>

                                    <div className="p-4 rounded-lg border border-border/50 bg-secondary/20 space-y-2">
                                        <div className="flex items-center justify-between text-sm">
                                            <span className="text-muted-foreground">Session ID</span>
                                            <span className="font-mono text-xs truncate max-w-[180px]">{sessionId}</span>
                                        </div>
                                        <div className="flex items-center justify-between text-sm">
                                            <span className="text-muted-foreground">State</span>
                                            <span className={cn(
                                                "font-mono text-xs px-2 py-0.5 rounded",
                                                isPendingBridge ? "bg-yellow-500/20 text-yellow-500" : "bg-green-500/20 text-green-500"
                                            )}>
                                                {getSessionLabel()}
                                            </span>
                                        </div>
                                        <div className="flex items-center justify-between text-sm">
                                            <span className="text-muted-foreground">Locked Amount</span>
                                            <span className="font-mono">${parseFloat(lockedAmount).toFixed(2)}</span>
                                        </div>
                                        {isPendingBridge && (
                                            <div className="flex items-center justify-between text-sm">
                                                <span className="text-muted-foreground">Timeout In</span>
                                                <span className="font-mono flex items-center gap-1">
                                                    <Clock className="h-3 w-3" />
                                                    {timeUntilTimeout > 0 ? `${timeUntilTimeout}s` : "Expired"}
                                                </span>
                                            </div>
                                        )}
                                    </div>
                                </div>
                            )}

                            {/* No Active Session */}
                            {!isSessionActive && (
                                <div className="p-6 text-center border border-dashed border-border/50 rounded-lg">
                                    <WifiOff className="h-10 w-10 mx-auto mb-3 text-muted-foreground" />
                                    <p className="text-sm text-muted-foreground">
                                        No active session. Go to the Trade page to start one.
                                    </p>
                                </div>
                            )}

                            {/* Close Session Button - Always visible for Active and PendingBridge */}
                            {isSessionActive && (
                                <div className="space-y-2">
                                    <button 
                                        onClick={() => setShowCloseModal(true)}
                                        className="w-full py-3 rounded-lg font-mono text-sm border border-orange-500/20 bg-orange-500/10 text-orange-500 hover:bg-orange-500/20 transition-colors flex items-center justify-center gap-2"
                                    >
                                        <XCircle className="h-4 w-4" />
                                        Close Session
                                    </button>
                                    
                                    {/* Fund Escrow Button - for when bridge was bypassed */}
                                    <button 
                                        onClick={handleFundEscrow}
                                        disabled={!hasEnoughForFunding || isFundingProcessing}
                                        className={cn(
                                            "w-full py-3 rounded-lg font-mono text-sm border transition-colors flex items-center justify-center gap-2",
                                            hasEnoughForFunding && !isFundingProcessing
                                                ? "border-blue-500/20 bg-blue-500/10 text-blue-500 hover:bg-blue-500/20"
                                                : "border-border bg-secondary/50 text-muted-foreground cursor-not-allowed"
                                        )}
                                    >
                                        {isFundingProcessing ? (
                                            <>
                                                <Loader2 className="h-4 w-4 animate-spin" />
                                                Funding Escrow...
                                            </>
                                        ) : (
                                            <>
                                                <Banknote className="h-4 w-4" />
                                                Fund Escrow (${lockedAmountNum.toFixed(2)})
                                            </>
                                        )}
                                    </button>
                                    <p className="text-xs text-muted-foreground text-center">
                                        Wallet: ${walletBalanceNum.toFixed(2)} USDC
                                        {!hasEnoughForFunding && lockedAmountNum > 0 && (
                                            <span className="text-orange-500 ml-1">(Need ${lockedAmountNum.toFixed(2)})</span>
                                        )}
                                    </p>
                                    {isFundSuccess && (
                                        <p className="text-xs text-green-500 text-center flex items-center justify-center gap-1">
                                            <CheckCircle className="h-3 w-3" />
                                            Escrow funded successfully!
                                        </p>
                                    )}
                                    {fundError && (
                                        <p className="text-xs text-red-500 text-center">
                                            {fundError.message?.slice(0, 100) || "Funding failed"}
                                        </p>
                                    )}
                                </div>
                            )}
                        </>
                    )}
                </div>
            </div>

            {/* Close Session Modal */}
            {showCloseModal && (
                <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
                    <div className="bg-card border border-border rounded-xl max-w-md w-full p-6 space-y-4">
                        <div className="flex items-center gap-3">
                            <AlertTriangle className="h-6 w-6 text-orange-500" />
                            <h3 className="text-lg font-bold">Close Trading Session</h3>
                        </div>
                        
                        <div className="space-y-4 text-sm">
                            {isActive ? (
                                <>
                                    {!hasPositions ? (
                                        // No positions - can close directly
                                        <>
                                            <div className="p-4 rounded-lg bg-green-500/10 border border-green-500/20">
                                                <div className="flex items-center gap-2 mb-2">
                                                    <CheckCircle className="h-5 w-5 text-green-500" />
                                                    <p className="font-medium text-green-500">Ready to Close</p>
                                                </div>
                                                <p className="text-sm text-muted-foreground">
                                                    You have no open positions. You can close this session now and unlock your funds.
                                                </p>
                                            </div>
                                            
                                            {closeSuccess ? (
                                                <div className="p-4 rounded-lg bg-green-500/10 border border-green-500/20 text-center">
                                                    <CheckCircle className="h-8 w-8 mx-auto mb-2 text-green-500" />
                                                    <p className="text-green-500 font-medium">Session Closed Successfully!</p>
                                                    <p className="text-xs text-muted-foreground">Your funds have been unlocked.</p>
                                                </div>
                                            ) : (
                                                <>
                                                    <button 
                                                        onClick={handleCloseSession}
                                                        disabled={isProcessing}
                                                        className="w-full py-3 rounded-lg font-mono text-sm bg-green-600 text-white hover:bg-green-700 transition-colors flex items-center justify-center gap-2 disabled:opacity-50"
                                                    >
                                                        {isProcessing ? (
                                                            <>
                                                                <Loader2 className="h-4 w-4 animate-spin" />
                                                                Closing Session...
                                                            </>
                                                        ) : (
                                                            <>
                                                                <CheckCircle className="h-4 w-4" />
                                                                Close Session Now
                                                            </>
                                                        )}
                                                    </button>
                                                    
                                                    {closeError && (
                                                        <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/20">
                                                            <p className="text-sm text-red-500">{closeError}</p>
                                                        </div>
                                                    )}
                                                </>
                                            )}
                                        </>
                                    ) : (
                                        // Has positions - show sell first instructions
                                        <>
                                            <p className="text-muted-foreground">
                                                Your session is <span className="text-green-500 font-medium">Active</span> with 
                                                <span className="text-orange-500 font-medium"> ${totalPositionsValue.toFixed(2)}</span> in open positions.
                                                To close it properly:
                                            </p>
                                            
                                            <div className="p-4 rounded-lg bg-secondary/30 space-y-3">
                                                <div className="flex items-start gap-3">
                                                    <span className="flex-shrink-0 h-5 w-5 rounded-full bg-primary/20 text-primary text-xs flex items-center justify-center font-bold">1</span>
                                                    <div>
                                                        <p className="font-medium">Sell your positions</p>
                                                        <p className="text-xs text-muted-foreground">Go to Trade page and sell all open positions</p>
                                                    </div>
                                                </div>
                                                <div className="flex items-start gap-3">
                                                    <span className="flex-shrink-0 h-5 w-5 rounded-full bg-primary/20 text-primary text-xs flex items-center justify-center font-bold">2</span>
                                                    <div>
                                                        <p className="font-medium">OR wait for market resolution</p>
                                                        <p className="text-xs text-muted-foreground">Markets resolve at expiry, then claim winnings</p>
                                                    </div>
                                                </div>
                                                <div className="flex items-start gap-3">
                                                    <span className="flex-shrink-0 h-5 w-5 rounded-full bg-primary/20 text-primary text-xs flex items-center justify-center font-bold">3</span>
                                                    <div>
                                                        <p className="font-medium">Session settles automatically</p>
                                                        <p className="text-xs text-muted-foreground">Funds unlock back to your vault balance</p>
                                                    </div>
                                                </div>
                                            </div>

                                            <Link 
                                                href="/trade"
                                                className="w-full py-3 rounded-lg font-mono text-sm bg-primary text-primary-foreground hover:bg-primary/90 transition-colors flex items-center justify-center gap-2"
                                            >
                                                <ExternalLink className="h-4 w-4" />
                                                Go to Trade Page
                                            </Link>
                                        </>
                                    )}
                                </>
                            ) : isPendingBridge ? (
                                <>
                                    <p className="text-muted-foreground">
                                        Your session is <span className="text-yellow-500 font-medium">Pending Bridge</span>.
                                        {canCancel 
                                            ? " The timeout has expired - you can cancel now."
                                            : ` Wait ${timeUntilTimeout} seconds for timeout to cancel.`
                                        }
                                    </p>
                                    
                                    <button 
                                        onClick={handleCancelSession}
                                        disabled={!canCancel || isProcessing}
                                        className={cn(
                                            "w-full py-3 rounded-lg font-mono text-sm transition-colors flex items-center justify-center gap-2",
                                            canCancel && !isProcessing
                                                ? "bg-red-500 text-white hover:bg-red-600"
                                                : "bg-secondary text-muted-foreground cursor-not-allowed"
                                        )}
                                    >
                                        {isProcessing ? (
                                            <Loader2 className="h-4 w-4 animate-spin" />
                                        ) : (
                                            <XCircle className="h-4 w-4" />
                                        )}
                                        {canCancel ? "Cancel & Unlock Funds" : `Wait ${timeUntilTimeout}s to Cancel`}
                                    </button>
                                </>
                            ) : null}
                        </div>

                        <button 
                            onClick={() => setShowCloseModal(false)}
                            className="w-full py-2 rounded-lg font-mono text-xs text-muted-foreground hover:text-foreground transition-colors"
                        >
                            Close
                        </button>
                    </div>
                </div>
            )}
        </>
    )
}
