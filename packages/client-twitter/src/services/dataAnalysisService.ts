import { elizaLogger } from "@ai16z/eliza";

export interface TokenMetrics {
    symbol: string;
    price: number;
    price_change_24h: number;
    volume_24h: number;
    market_cap: number;
    fdv: number;
    timestamp: string;
}

export class DataAnalysisService {
    analyzeTokenData(data: TokenMetrics[]): {
        topGainers: TokenMetrics[];
        topVolume: TokenMetrics[];
        marketOverview: string;
    } {
        const topGainers = [...data]
            .sort((a, b) => b.price_change_24h - a.price_change_24h)
            .slice(0, 5);

        const topVolume = [...data]
            .sort((a, b) => b.volume_24h - a.volume_24h)
            .slice(0, 5);

        // Create a market overview string with key metrics
        const marketOverview = this.createMarketOverview(data);

        return {
            topGainers,
            topVolume,
            marketOverview,
        };
    }

    private createMarketOverview(data: TokenMetrics[]): string {
        const totalVolume = data.reduce(
            (sum, token) => sum + token.volume_24h,
            0
        );
        const averageChange =
            data.reduce((sum, token) => sum + token.price_change_24h, 0) /
            data.length;

        return JSON.stringify({
            totalVolume: totalVolume,
            averageChange: averageChange.toFixed(2),
            numberOfTokens: data.length,
            topGainers: data
                .sort((a, b) => b.price_change_24h - a.price_change_24h)
                .slice(0, 5)
                .map((token) => ({
                    symbol: token.symbol,
                    change: token.price_change_24h.toFixed(2),
                    volume: (token.volume_24h / 1e6).toFixed(2),
                })),
            topVolume: data
                .sort((a, b) => b.volume_24h - a.volume_24h)
                .slice(0, 5)
                .map((token) => ({
                    symbol: token.symbol,
                    volume: (token.volume_24h / 1e6).toFixed(2),
                    change: token.price_change_24h.toFixed(2),
                })),
        });
    }
}
