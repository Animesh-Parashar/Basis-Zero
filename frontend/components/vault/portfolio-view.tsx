"use client"

import { TrendingUp, Shield, DollarSign, Lock, Loader2 } from "lucide-react"
import { useSessionEscrow, SessionState } from "@/hooks/use-session-escrow"

export function PortfolioView() {
    const { 
        deposited,
        available,
        locked,
        sessionState,
        available: availableYield, // Maps to available for now
    } = useSessionEscrow()

    // Simplified checks
    const isConnected = !!deposited 
    
    const depositedNum = parseFloat(deposited) || 0
    const availableNum = parseFloat(available) || 0
    const lockedNum = parseFloat(locked) || 0
    
    // Hardcoded for demo/hackathon as "BlackRock BUIDL" rate
    const apy = 5.2

    // Session label
    const getSessionLabel = () => {
        switch (sessionState) {
            case SessionState.Active: return "Session Active"
            case SessionState.Settled: return "Settled"
            default: return null
        }
    }
    const sessionLabel = getSessionLabel()

    if (!isConnected) {
        return (
            <div className="rounded-xl border border-border bg-card/60 glass overflow-hidden p-8 text-center">
                <Shield className="h-12 w-12 mx-auto mb-4 text-muted-foreground" />
                <p className="text-muted-foreground">Connect wallet to view portfolio</p>
            </div>
        )
    }

    return (
        <div className="rounded-xl border border-border bg-card/60 glass overflow-hidden">
            {/* Header */}
            <div className="border-b border-border/50 bg-secondary/40 px-4 py-3">
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                        <Shield className="h-4 w-4 text-primary" />
                        <h3 className="font-mono text-xs uppercase tracking-wider text-primary">
                            RWA Portfolio
                        </h3>
                    </div>
                    <span className="flex items-center gap-1.5 font-mono text-xs text-green-500">
                        <span className="h-1.5 w-1.5 rounded-full bg-green-500 animate-pulse" />
                        BlackRock BUIDL
                    </span>
                </div>
            </div>

            <div className="p-6 space-y-6">
                {/* Total Value */}
                <div className="text-center">
                    <p className="font-mono text-xs text-muted-foreground uppercase tracking-wider mb-2">
                        Total Balance
                    </p>
                    <p className="font-mono text-4xl font-bold">
                        {`$${depositedNum.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
                    </p>
                    <p className="mt-1 text-sm text-green-500">
                        Earning {apy}% APY
                    </p>
                </div>

                {/* Stats Grid */}
                <div className="grid grid-cols-2 gap-4">
                    <div className="rounded-lg border border-border/50 bg-secondary/30 p-4">
                        <div className="flex items-center gap-2 mb-2">
                            <DollarSign className="h-4 w-4 text-blue-500" />
                            <span className="font-mono text-[10px] text-muted-foreground uppercase tracking-wider">
                                Available
                            </span>
                        </div>
                        <p className="font-mono text-xl font-bold">${availableNum.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
                    </div>

                    <div className="rounded-lg border border-yellow-500/30 bg-yellow-500/10 p-4">
                        <div className="flex items-center gap-2 mb-2">
                            <Lock className="h-4 w-4 text-yellow-500" />
                            <span className="font-mono text-[10px] text-muted-foreground uppercase tracking-wider">
                                Locked in Session
                            </span>
                        </div>
                        <p className="font-mono text-xl font-bold text-yellow-500">${lockedNum.toFixed(2)}</p>
                    </div>
                </div>

                {/* Session State (if active) */}
                {sessionLabel && (
                    <div className="rounded-lg border border-green-500/30 bg-green-500/10 p-4">
                        <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                                <TrendingUp className="h-4 w-4 text-green-500" />
                                <span className="font-mono text-xs text-green-500 uppercase tracking-wider">
                                    {sessionLabel}
                                </span>
                            </div>
                            <span className="font-mono text-sm text-green-500">
                                Trading Active
                            </span>
                        </div>
                    </div>
                )}
            </div>
        </div>
    )
}
