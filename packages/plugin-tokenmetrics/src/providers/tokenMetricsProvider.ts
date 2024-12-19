import { IAgentRuntime, Memory, Provider, State, elizaLogger } from "@ai16z/eliza";
import { TokenMetricsConfig, TokenMetricsData } from "../types";
import { createRateLimiter } from "../utils";

export class TokenMetricsProvider implements Provider {
    private config: TokenMetricsConfig;
    private cache: Map<string, { data: TokenMetricsData; timestamp: number }>;
    private rateLimiter = createRateLimiter(60, 60000); // 60 requests per minute

    constructor(config: TokenMetricsConfig) {
        this.config = {
            maxResults: 10,
            cacheTimeout: 5 * 60 * 1000, // 5 minutes
            ...config
        };
        this.cache = new Map();
    }

    private async querySnowflake(query: string): Promise<any[]> {
        try {
            const response = await fetch(`${this.config.snowflakeUrl}/query`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${this.config.apiKey}`
                },
                body: JSON.stringify({ query })
            });

            if (!response.ok) {
                throw new Error(`Snowflake query failed: ${response.statusText}`);
            }

            return await response.json();
        } catch (error) {
            elizaLogger.error('Error querying Snowflake:', error);
            throw error;
        }
    }

    private transformSnowflakeData(data: any): TokenMetricsData {
        return {
            date: data.DATE,
            tokenName: data.TOKEN_NAME,
            tokenSymbol: data.TOKEN_SYMBOL,
            summary: data.SUMMARY,
            tokenUrl: data.TOKEN_URL,
            platforms: JSON.parse(data.PLATFORMS || '{}'),
            grades: {
                tmTraderGrade: data.TM_TRADER_GRADE,
                tmInvestorGrade: data.TM_INVESTOR_GRADE,
                taGrade: data.TA_GRADE,
                quantGrade: data.QUANT_GRADE,
                fundamentalGrade: data.FUNDAMENTAL_GRADE,
                technologyGrade: data.TECHNOLOGY_GRADE,
                valuationGrade: data.VALUATION_GRADE
            },
            scores: {
                defiUsage: data.DEFI_USAGE_SCORE,
                community: data.COMMUNITY_SCORE,
                exchange: data.EXCHANGE_SCORE,
                vc: data.VC_SCORE,
                tokenomics: data.TOKENOMICS_SCORE,
                defiScanner: data.DEFI_SCANNER_SCORE,
                activity: data.ACTIVITY_SCORE,
                repository: data.REPOSITORY_SCORE,
                collaboration: data.COLLABORATION_SCORE
            },
            valuationMetrics: JSON.parse(data.VALUATION_METRICS || '{}'),
            maxDrawdown: data.MAX_DRAWDOWN,
            sortino: data.SORTINO,
            tvl: data.TVL,
            tradingSignal: data.TRADING_SIGNAL,
            traderGradeSignal: data.TRADER_GRADE_SIGNAL,
            tokenTrend: data.TOKEN_TREND,
            volume24h: data.VOLUME_24H,
            marketCap: data.MARKET_CAP,
            marketCapRank: data.MARKET_CAP_RANK,
            circulatingSupply: data.CIRCULATING_SUPPLY,
            totalSupply: data.TOTAL_SUPPLY,
            maxSupply: data.MAX_SUPPLY,
            fullyDilutedValuation: data.FULLY_DILUTED_VALUATION,
            high24h: data.HIGH_24H,
            low24h: data.LOW_24H,
            allTimeHigh: JSON.parse(data.ALL_TIME_HIGH || '{}'),
            allTimeLow: JSON.parse(data.ALL_TIME_LOW || '{}'),
            priceChangePercentage: JSON.parse(data.PRICE_CHANGE_PERCENTAGE || '{}')
        };
    }

    async getTokenMetrics(tokenName: string): Promise<TokenMetricsData | null> {
        try {
            if (!this.rateLimiter.checkLimit()) {
                throw new Error('Rate limit exceeded');
            }

            // Check cache
            const cached = this.cache.get(tokenName.toLowerCase());
            if (cached && Date.now() - cached.timestamp < this.config.cacheTimeout!) {
                return cached.data;
            }

            const query = `
                SELECT *
                FROM TOKENMETRICS_DEV.ANALYTICS.CRYPTO_INFO_HUB_CURRENT_VIEW
                WHERE LOWER(TOKEN_NAME) = LOWER('${tokenName}')
            `;

            const results = await this.querySnowflake(query);
            if (!results || results.length === 0) {
                return null;
            }

            const metrics = this.transformSnowflakeData(results[0]);

            // Update cache
            this.cache.set(tokenName.toLowerCase(), {
                data: metrics,
                timestamp: Date.now()
            });

            return metrics;
        } catch (error) {
            elizaLogger.error('Error fetching token metrics:', error);
            return null;
        }
    }

    async searchTokens(query: string): Promise<TokenMetricsData[]> {
        try {
            if (!this.rateLimiter.checkLimit()) {
                throw new Error('Rate limit exceeded');
            }

            const sqlQuery = `
                SELECT *
                FROM TOKENMETRICS_DEV.ANALYTICS.CRYPTO_INFO_HUB_CURRENT_VIEW
                WHERE LOWER(TOKEN_NAME) LIKE LOWER('%${query}%')
                   OR LOWER(TOKEN_SYMBOL) LIKE LOWER('%${query}%')
                LIMIT ${this.config.maxResults}
            `;

            const results = await this.querySnowflake(sqlQuery);
            return results.map(result => this.transformSnowflakeData(result));
        } catch (error) {
            elizaLogger.error('Error searching tokens:', error);
            return [];
        }
    }

    async get(
        runtime: IAgentRuntime,
        message: Memory,
        state?: State
    ): Promise<any> {
        const text = (message.content as any)?.text;
        if (!text) return {};

        // Try to extract token name or symbol from message
        const tokenMatch = text.match(/\b[A-Z]{2,10}\b/);
        if (!tokenMatch) return {};

        return this.getTokenMetrics(tokenMatch[0]);
    }
}

export const tokenMetricsProvider = new TokenMetricsProvider({
    snowflakeUrl: process.env.SNOWFLAKE_URL,
    apiKey: process.env.SNOWFLAKE_API_KEY,
    maxResults: 10,
    cacheTimeout: 5 * 60 * 1000
});