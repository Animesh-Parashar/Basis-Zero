/**
 * AMM Repository - Database Access Layer for Markets, Sessions, and Positions
 */

import { getSupabase } from './supabase';
import { PoolState, Outcome } from '../amm/types';

// ═══════════════════════════════════════════════════════════════════════════
// TYPE DEFINITIONS
// ═══════════════════════════════════════════════════════════════════════════

export interface MarketRow {
    market_id: string;
    title: string;
    description: string | null;
    category: string | null;
    expires_at: string;
    yes_reserves: string;
    no_reserves: string;
    k_invariant: string;
    status: 'ACTIVE' | 'RESOLVED' | 'CANCELLED';
    resolution_value: 'YES' | 'NO' | null;
    resolution_type: 'manual' | 'oracle' | null;
    oracle_config: Record<string, unknown> | null;
    resolver_address: string | null;
    resolved_at: string | null;
    resolved_by: string | null;
    created_at: string;
}

export interface SessionRow {
    session_id: string;
    user_address: string;
    status: 'OPEN' | 'CLOSING' | 'CLOSED';
    initial_collateral: string;
    current_balance: string;
    latest_signature: string;
    nonce: number;
    created_at: string;
    updated_at: string;
}

export interface PositionRow {
    id: string;
    user_id: string;
    market_id: string;
    outcome: 'YES' | 'NO';
    shares: string;
    average_entry_price: number;
    created_at: string;
}

export interface CreateMarketInput {
    marketId: string;
    title: string;
    description?: string;
    category?: string;
    expiresAt: Date;
    yesReserves: bigint;
    noReserves: bigint;
    kInvariant: bigint;
    resolutionType?: 'manual' | 'oracle';
    oracleConfig?: Record<string, unknown>;
    resolverAddress?: string;
}

// ═══════════════════════════════════════════════════════════════════════════
// MARKET OPERATIONS
// ═══════════════════════════════════════════════════════════════════════════

export async function createMarket(input: CreateMarketInput): Promise<MarketRow> {
    const supabase = getSupabase();

    const { data, error } = await supabase
        .from('markets')
        .insert({
            market_id: input.marketId,
            title: input.title,
            description: input.description ?? null,
            category: input.category ?? 'general',
            expires_at: input.expiresAt.toISOString(),
            yes_reserves: input.yesReserves.toString(),
            no_reserves: input.noReserves.toString(),
            k_invariant: input.kInvariant.toString(),
            status: 'ACTIVE',
            resolution_type: input.resolutionType ?? 'manual',
            oracle_config: input.oracleConfig ?? null,
            resolver_address: input.resolverAddress ?? null
        })
        .select()
        .single();

    if (error) throw new Error(`Failed to create market: ${error.message}`);
    return data;
}

export async function getMarket(marketId: string): Promise<MarketRow | null> {
    const supabase = getSupabase();

    const { data, error } = await supabase
        .from('markets')
        .select('*')
        .eq('market_id', marketId)
        .single();

    if (error?.code === 'PGRST116') return null; // Not found
    if (error) throw new Error(`Failed to get market: ${error.message}`);
    return data;
}

export async function getActiveMarkets(): Promise<MarketRow[]> {
    const supabase = getSupabase();

    const { data, error } = await supabase
        .from('markets')
        .select('*')
        .eq('status', 'ACTIVE')
        .order('created_at', { ascending: false });

    if (error) throw new Error(`Failed to get active markets: ${error.message}`);
    return data ?? [];
}

export async function updateMarketReserves(
    marketId: string,
    yesReserves: bigint,
    noReserves: bigint,
    kInvariant: bigint
): Promise<void> {
    const supabase = getSupabase();

    const { error } = await supabase
        .from('markets')
        .update({
            yes_reserves: yesReserves.toString(),
            no_reserves: noReserves.toString(),
            k_invariant: kInvariant.toString()
        })
        .eq('market_id', marketId);

    if (error) throw new Error(`Failed to update market reserves: ${error.message}`);
}

export async function resolveMarket(
    marketId: string,
    winner: Outcome,
    resolvedBy?: string
): Promise<void> {
    const supabase = getSupabase();

    const { error } = await supabase
        .from('markets')
        .update({
            status: 'RESOLVED',
            resolution_value: winner === Outcome.YES ? 'YES' : 'NO',
            resolved_at: new Date().toISOString(),
            resolved_by: resolvedBy ?? 'system'
        })
        .eq('market_id', marketId);

    if (error) throw new Error(`Failed to resolve market: ${error.message}`);
}

/**
 * Get markets that are expired and pending resolution
 */
export async function getMarketsToResolve(): Promise<MarketRow[]> {
    const supabase = getSupabase();

    const { data, error } = await supabase
        .from('markets')
        .select('*')
        .eq('status', 'ACTIVE')
        .lt('expires_at', new Date().toISOString())
        .order('expires_at', { ascending: true });

    if (error) throw new Error(`Failed to get markets to resolve: ${error.message}`);
    return data ?? [];
}

/**
 * Get oracle markets that are expired
 */
export async function getOracleMarketsToResolve(): Promise<MarketRow[]> {
    const supabase = getSupabase();

    const { data, error } = await supabase
        .from('markets')
        .select('*')
        .eq('status', 'ACTIVE')
        .eq('resolution_type', 'oracle')
        .lt('expires_at', new Date().toISOString())
        .order('expires_at', { ascending: true });

    if (error) throw new Error(`Failed to get oracle markets to resolve: ${error.message}`);
    return data ?? [];
}

// ═══════════════════════════════════════════════════════════════════════════
// SESSION OPERATIONS
// ═══════════════════════════════════════════════════════════════════════════

export async function createSession(
    sessionId: string,
    userAddress: string,
    initialCollateral: bigint,
    signature: string
): Promise<SessionRow> {
    const supabase = getSupabase();

    const { data, error } = await supabase
        .from('sessions')
        .insert({
            session_id: sessionId,
            user_address: userAddress,
            initial_collateral: initialCollateral.toString(),
            current_balance: initialCollateral.toString(),
            latest_signature: signature,
            nonce: 0
        })
        .select()
        .single();

    if (error) throw new Error(`Failed to create session: ${error.message}`);
    return data;
}

export async function getSession(sessionId: string): Promise<SessionRow | null> {
    const supabase = getSupabase();

    const { data, error } = await supabase
        .from('sessions')
        .select('*')
        .eq('session_id', sessionId)
        .single();

    if (error?.code === 'PGRST116') return null;
    if (error) throw new Error(`Failed to get session: ${error.message}`);
    return data;
}

export async function getSessionByUser(userAddress: string): Promise<SessionRow | null> {
    const supabase = getSupabase();

    const { data, error } = await supabase
        .from('sessions')
        .select('*')
        .eq('user_address', userAddress)
        .eq('status', 'OPEN')
        .order('created_at', { ascending: false })
        .limit(1)
        .single();

    if (error?.code === 'PGRST116') return null;
    if (error) throw new Error(`Failed to get user session: ${error.message}`);
    return data;
}

export async function updateSessionBalance(
    sessionId: string,
    newBalance: bigint,
    newSignature: string,
    newNonce: number
): Promise<void> {
    const supabase = getSupabase();

    const { error } = await supabase
        .from('sessions')
        .update({
            current_balance: newBalance.toString(),
            latest_signature: newSignature,
            nonce: newNonce
        })
        .eq('session_id', sessionId);

    if (error) throw new Error(`Failed to update session: ${error.message}`);
}

// ═══════════════════════════════════════════════════════════════════════════
// POSITION OPERATIONS
// ═══════════════════════════════════════════════════════════════════════════

export async function getPosition(
    userId: string,
    marketId: string,
    outcome: Outcome
): Promise<PositionRow | null> {
    const supabase = getSupabase();

    const { data, error } = await supabase
        .from('positions')
        .select('*')
        .eq('user_id', userId)
        .eq('market_id', marketId)
        .eq('outcome', outcome === Outcome.YES ? 'YES' : 'NO')
        .single();

    if (error?.code === 'PGRST116') return null;
    if (error) throw new Error(`Failed to get position: ${error.message}`);
    return data;
}

export async function getUserPositions(userId: string): Promise<PositionRow[]> {
    const supabase = getSupabase();

    const { data, error } = await supabase
        .from('positions')
        .select('*')
        .eq('user_id', userId);

    if (error) throw new Error(`Failed to get user positions: ${error.message}`);
    return data ?? [];
}

export async function getMarketPositions(marketId: string): Promise<PositionRow[]> {
    const supabase = getSupabase();

    const { data, error } = await supabase
        .from('positions')
        .select('*')
        .eq('market_id', marketId);

    if (error) throw new Error(`Failed to get market positions: ${error.message}`);
    return data ?? [];
}

/**
 * Ensure a session exists in the database (auto-create if not)
 * This allows using on-chain sessionIds without explicit session registration
 * The positions table has FK to sessions.session_id, so we need sessions not users
 */
export async function ensureSessionExists(sessionId: string, userAddress?: string): Promise<void> {
    const supabase = getSupabase();

    // Check if session already exists
    const { data: existing } = await supabase
        .from('sessions')
        .select('session_id')
        .eq('session_id', sessionId)
        .single();

    if (existing) return; // Session exists

    // Auto-create session for betting
    const { error } = await supabase
        .from('sessions')
        .insert({
            session_id: sessionId,
            user_address: userAddress || sessionId, // Use sessionId as fallback
            status: 'OPEN',
            initial_collateral: '0',
            current_balance: '0',
            latest_signature: 'auto-created',
            nonce: 0
        });

    if (error && !error.message.includes('duplicate')) {
        console.warn(`Warning: Could not ensure session exists: ${error.message}`);
    } else {
        console.log(`[AMM] Auto-created session: ${sessionId}`);
    }
}

export async function upsertPosition(
    userId: string,
    marketId: string,
    outcome: Outcome,
    shares: bigint,
    averageEntryPrice: number
): Promise<PositionRow> {
    const supabase = getSupabase();

    // Auto-create session if not exists (userId is actually sessionId due to FK)
    await ensureSessionExists(userId);

    const { data, error } = await supabase
        .from('positions')
        .upsert({
            user_id: userId,
            market_id: marketId,
            outcome: outcome === Outcome.YES ? 'YES' : 'NO',
            shares: shares.toString(),
            average_entry_price: averageEntryPrice
        }, {
            onConflict: 'user_id,market_id,outcome'
        })
        .select()
        .single();

    if (error) throw new Error(`Failed to upsert position: ${error.message}`);
    return data;
}

// ═══════════════════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════════════════

export function marketRowToPoolState(row: MarketRow): PoolState {
    return {
        marketId: row.market_id,
        yesReserves: BigInt(row.yes_reserves),
        noReserves: BigInt(row.no_reserves),
        k: BigInt(row.k_invariant),
        virtualLiquidity: BigInt(row.yes_reserves), // Assume initial liquidity = reserves
        totalCollateral: 0n,
        createdAt: new Date(row.created_at).getTime(),
        updatedAt: Date.now()
    };
}
