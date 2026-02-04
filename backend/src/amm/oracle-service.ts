/**
 * Oracle Service - Price Feed Integration for Market Resolution
 * 
 * Supports:
 * - Chainlink price feeds (via public APIs)
 * - CoinGecko fallback for price data
 */

// ═══════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════

export type PriceCondition = '>' | '<' | '>=' | '<=' | '==';

export interface PriceOracleConfig {
    type: 'price';
    asset: string;           // e.g., 'BTC', 'ETH', 'SOL'
    condition: PriceCondition;
    targetPrice: number;     // Target price in USD
}

export interface OracleConfig {
    type: 'price' | 'manual';
    config?: PriceOracleConfig;
}

export interface PriceData {
    asset: string;
    price: number;
    timestamp: number;
    source: string;
}

// ═══════════════════════════════════════════════════════════════════════════
// SUPPORTED ASSETS
// ═══════════════════════════════════════════════════════════════════════════

const COINGECKO_IDS: Record<string, string> = {
    'BTC': 'bitcoin',
    'ETH': 'ethereum',
    'SOL': 'solana',
    'USDC': 'usd-coin',
    'USDT': 'tether',
    'BNB': 'binancecoin',
    'XRP': 'ripple',
    'ADA': 'cardano',
    'DOGE': 'dogecoin',
    'AVAX': 'avalanche-2',
    'DOT': 'polkadot',
    'MATIC': 'matic-network',
    'LINK': 'chainlink',
    'UNI': 'uniswap',
    'ATOM': 'cosmos',
    'ARB': 'arbitrum',
    'OP': 'optimism',
};

export const SUPPORTED_ASSETS = Object.keys(COINGECKO_IDS);

// ═══════════════════════════════════════════════════════════════════════════
// PRICE FETCHING
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Fetch current price for an asset from CoinGecko
 */
export async function fetchPrice(asset: string): Promise<PriceData> {
    const coingeckoId = COINGECKO_IDS[asset.toUpperCase()];
    if (!coingeckoId) {
        throw new Error(`Unsupported asset: ${asset}`);
    }

    try {
        const response = await fetch(
            `https://api.coingecko.com/api/v3/simple/price?ids=${coingeckoId}&vs_currencies=usd`
        );

        if (!response.ok) {
            throw new Error(`CoinGecko API error: ${response.status}`);
        }

        const data = await response.json();
        const price = data[coingeckoId]?.usd;

        if (price === undefined) {
            throw new Error(`No price data for ${asset}`);
        }

        return {
            asset: asset.toUpperCase(),
            price,
            timestamp: Date.now(),
            source: 'coingecko'
        };
    } catch (error) {
        console.error(`[Oracle] Failed to fetch price for ${asset}:`, error);
        throw error;
    }
}

/**
 * Fetch prices for multiple assets
 */
export async function fetchPrices(assets: string[]): Promise<PriceData[]> {
    const validAssets = assets.filter(a => COINGECKO_IDS[a.toUpperCase()]);

    if (validAssets.length === 0) {
        return [];
    }

    const coingeckoIds = validAssets.map(a => COINGECKO_IDS[a.toUpperCase()]).join(',');

    try {
        const response = await fetch(
            `https://api.coingecko.com/api/v3/simple/price?ids=${coingeckoIds}&vs_currencies=usd`
        );

        if (!response.ok) {
            throw new Error(`CoinGecko API error: ${response.status}`);
        }

        const data = await response.json();
        const timestamp = Date.now();

        return validAssets.map(asset => ({
            asset: asset.toUpperCase(),
            price: data[COINGECKO_IDS[asset.toUpperCase()]]?.usd || 0,
            timestamp,
            source: 'coingecko'
        }));
    } catch (error) {
        console.error('[Oracle] Failed to fetch prices:', error);
        throw error;
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// CONDITION EVALUATION
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Evaluate if a price condition is met
 */
export function evaluateCondition(
    currentPrice: number,
    condition: PriceCondition,
    targetPrice: number
): boolean {
    switch (condition) {
        case '>':
            return currentPrice > targetPrice;
        case '<':
            return currentPrice < targetPrice;
        case '>=':
            return currentPrice >= targetPrice;
        case '<=':
            return currentPrice <= targetPrice;
        case '==':
            // Allow 0.1% tolerance for equality
            const tolerance = targetPrice * 0.001;
            return Math.abs(currentPrice - targetPrice) <= tolerance;
        default:
            throw new Error(`Unknown condition: ${condition}`);
    }
}

/**
 * Check if a price oracle market should be resolved, and determine outcome
 */
export async function checkPriceResolution(
    oracleConfig: PriceOracleConfig
): Promise<{ shouldResolve: boolean; outcome: 'YES' | 'NO' | null; price: number }> {
    try {
        const priceData = await fetchPrice(oracleConfig.asset);
        const conditionMet = evaluateCondition(
            priceData.price,
            oracleConfig.condition,
            oracleConfig.targetPrice
        );

        console.log(`[Oracle] ${oracleConfig.asset}: $${priceData.price} ${oracleConfig.condition} $${oracleConfig.targetPrice} = ${conditionMet}`);

        return {
            shouldResolve: true,
            outcome: conditionMet ? 'YES' : 'NO',
            price: priceData.price
        };
    } catch (error) {
        console.error('[Oracle] Price check failed:', error);
        return {
            shouldResolve: false,
            outcome: null,
            price: 0
        };
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// UTILITIES
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Parse oracle config from JSON
 */
export function parseOracleConfig(json: unknown): OracleConfig | null {
    if (!json || typeof json !== 'object') return null;

    const config = json as Record<string, unknown>;

    if (config.type === 'price') {
        return {
            type: 'price',
            config: {
                type: 'price',
                asset: String(config.asset || ''),
                condition: (config.condition as PriceCondition) || '>',
                targetPrice: Number(config.targetPrice || 0)
            }
        };
    }

    if (config.type === 'manual') {
        return { type: 'manual' };
    }

    return null;
}

/**
 * Format condition for display
 */
export function formatCondition(condition: PriceCondition): string {
    const labels: Record<PriceCondition, string> = {
        '>': 'greater than',
        '<': 'less than',
        '>=': 'at least',
        '<=': 'at most',
        '==': 'equal to'
    };
    return labels[condition] || condition;
}
