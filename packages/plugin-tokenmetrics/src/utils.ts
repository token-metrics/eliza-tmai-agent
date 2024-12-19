import { TokenMetricsConfig, TokenMetricsData } from "./types";
import { elizaLogger } from "@ai16z/eliza";

export function validateConfig(config: TokenMetricsConfig): void {
    if (!config.snowflakeUrl) {
        throw new Error("Snowflake URL is required");
    }
    if (!config.apiKey) {
        throw new Error("API key is required");
    }
}

export function createRateLimiter(limit: number, interval: number) {
    const timestamps: number[] = [];

    return {
        checkLimit: (): boolean => {
            const now = Date.now();
            // Remove timestamps outside the interval
            while (timestamps.length > 0 && timestamps[0] < now - interval) {
                timestamps.shift();
            }
            if (timestamps.length >= limit) {
                return false;
            }
            timestamps.push(now);
            return true;
        }
    };
}

export function formatTokenMetrics(metrics: TokenMetricsData): string {
    try {
        return `
Token: ${metrics.tokenName} (${metrics.tokenSymbol})
Price Changes: ${formatPriceChanges(metrics.priceChangePercentage)}
Market Cap: $${formatNumber(metrics.marketCap)}
Volume (24h): $${formatNumber(metrics.volume24h)}
Grades:
- Trader: ${metrics.grades.tmTraderGrade}
- Investor: ${metrics.grades.tmInvestorGrade}
- Technical: ${metrics.grades.taGrade}
- Fundamental: ${metrics.grades.fundamentalGrade}
Signals:
- Trading: ${formatSignal(metrics.tradingSignal)}
- Trend: ${formatTrend(metrics.tokenTrend)}
- Grade: ${metrics.traderGradeSignal}
More Info: ${metrics.tokenUrl}
`;
    } catch (error) {
        elizaLogger.error('Error formatting token metrics:', error);
        return 'Error formatting metrics data';
    }
}

function formatNumber(num: number): string {
    if (num >= 1e9) {
        return (num / 1e9).toFixed(2) + 'B';
    }
    if (num >= 1e6) {
        return (num / 1e6).toFixed(2) + 'M';
    }
    if (num >= 1e3) {
        return (num / 1e3).toFixed(2) + 'K';
    }
    return num.toFixed(2);
}

function formatPriceChanges(changes: TokenMetricsData['priceChangePercentage']): string {
    return `1h: ${changes['1h'].toFixed(2)}% | 24h: ${changes['24h'].toFixed(2)}% | 7d: ${changes['7d'].toFixed(2)}%`;
}

function formatSignal(signal: number): string {
    switch (signal) {
        case 1: return '🟢 Bullish';
        case -1: return '🔴 Bearish';
        default: return '⚪ Neutral';
    }
}

function formatTrend(trend: number): string {
    switch (trend) {
        case 1: return '📈 Uptrend';
        case -1: return '📉 Downtrend';
        default: return '➡️ Sideways';
    }
}

export function handleApiError(error: any): { success: false; response: string } {
    elizaLogger.error('API Error:', error);
    return {
        success: false,
        response: `Error: ${error.message || 'Unknown error occurred'}`
    };
}