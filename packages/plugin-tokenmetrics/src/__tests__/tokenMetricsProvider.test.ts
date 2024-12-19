import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { TokenMetricsProvider } from '../providers/tokenMetricsProvider';
import { TokenMetricsConfig, TokenMetricsData } from '../types';

// Mock node-cache
vi.mock('node-cache', () => {
    return {
        default: vi.fn().mockImplementation(() => ({
            set: vi.fn(),
            get: vi.fn().mockReturnValue(null),
        })),
    };
});

// Mock fetch globally
const mockFetch = vi.fn();
global.fetch = mockFetch;

describe("TokenMetricsProvider", () => {
    let provider: TokenMetricsProvider;
    const mockConfig: TokenMetricsConfig = {
        snowflakeUrl: 'mock-url',
        apiKey: 'mock-key',
        maxResults: 10,
        cacheTimeout: 5000
    };

    const mockTokenData: TokenMetricsData = {
        date: '2024-01-01',
        tokenName: 'Bitcoin',
        tokenSymbol: 'BTC',
        summary: 'Test summary',
        tokenUrl: 'https://test.com',
        platforms: {},
        grades: {
            tmTraderGrade: 85,
            tmInvestorGrade: 80,
            taGrade: 75,
            quantGrade: 70,
            fundamentalGrade: 90,
            technologyGrade: 85,
            valuationGrade: 80
        },
        scores: {
            defiUsage: 80,
            community: 90,
            exchange: 85,
            vc: 75,
            tokenomics: 80,
            defiScanner: 70,
            activity: 85,
            repository: 80,
            collaboration: 75
        },
        valuationMetrics: {
            categoryFdvMedian: {},
            fdv: 1000000,
            projectAge: 365
        },
        maxDrawdown: 0.3,
        sortino: 2.5,
        tvl: 1000000,
        tradingSignal: 1,
        traderGradeSignal: 'BULLISH',
        tokenTrend: 1,
        volume24h: 1000000,
        marketCap: 10000000,
        marketCapRank: 1,
        circulatingSupply: 19000000,
        totalSupply: 21000000,
        maxSupply: 21000000,
        fullyDilutedValuation: 21000000,
        high24h: 50000,
        low24h: 45000,
        allTimeHigh: {
            ath: 69000,
            athChangePercentage: -30,
            athDate: '2021-11-10'
        },
        allTimeLow: {
            atl: 0.1,
            atlChangePercentage: 500000,
            atlDate: '2010-07-10'
        },
        priceChangePercentage: {
            "1h": 1,
            "24h": 5,
            "7d": 10,
            "30d": 15,
            "200d": 25,
            "1y": 50,
            allTime: 1000000
        }
    };

    beforeEach(() => {
        vi.clearAllMocks();
        provider = new TokenMetricsProvider(mockConfig);
        // Mock the querySnowflake method
        (provider as any).querySnowflake = vi.fn().mockResolvedValue([mockTokenData]);
    });

    afterEach(() => {
        vi.clearAllTimers();
    });

    describe("Cache Management", () => {
        it("should use cache for repeated requests", async () => {
            await provider.getTokenMetrics('BTC');
            await provider.getTokenMetrics('BTC');

            expect((provider as any).querySnowflake).toHaveBeenCalledTimes(1);
        });

        it("should refresh cache after timeout", async () => {
            await provider.getTokenMetrics('BTC');

            // Fast-forward time past cache timeout
            vi.advanceTimersByTime(mockConfig.cacheTimeout! + 1000);

            await provider.getTokenMetrics('BTC');
            expect((provider as any).querySnowflake).toHaveBeenCalledTimes(2);
        });
    });

    describe("Token Metrics", () => {
        it("should fetch and transform token metrics", async () => {
            const metrics = await provider.getTokenMetrics('BTC');
            expect(metrics).toEqual(mockTokenData);
        });

        it("should handle missing token data", async () => {
            (provider as any).querySnowflake = vi.fn().mockResolvedValue([]);
            const metrics = await provider.getTokenMetrics('NONEXISTENT');
            expect(metrics).toBeNull();
        });
    });

    describe("Token Search", () => {
        it("should search tokens with limit", async () => {
            const tokens = await provider.searchTokens('bitcoin');
            expect(tokens).toHaveLength(1);
            expect(tokens[0].tokenSymbol).toBe('BTC');
        });

        it("should handle empty search results", async () => {
            (provider as any).querySnowflake = vi.fn().mockResolvedValue([]);
            const tokens = await provider.searchTokens('nonexistent');
            expect(tokens).toHaveLength(0);
        });
    });

    describe("Provider Interface", () => {
        it("should extract token from message", async () => {
            const result = await provider.get(
                {} as any,
                { content: { text: 'Get info for BTC' } } as any
            );
            expect(result).toEqual(mockTokenData);
        });

        it("should return empty for no token match", async () => {
            const result = await provider.get(
                {} as any,
                { content: { text: 'random text' } } as any
            );
            expect(result).toEqual({});
        });
    });
});