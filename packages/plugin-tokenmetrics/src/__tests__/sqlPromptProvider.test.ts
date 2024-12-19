import { describe, it, expect, beforeEach, vi } from "vitest";
import { SQLPromptProvider } from '../providers/sqlPromptProvider';
import { TokenMetricsConfig } from '../types';

// Mock the SnowflakeService
vi.mock('../services/snowflakeService', () => ({
    SnowflakeService: {
        getInstance: vi.fn().mockReturnValue({
            executeQuery: vi.fn().mockResolvedValue([]),
            disconnect: vi.fn()
        })
    }
}));

describe("SQLPromptProvider", () => {
    let provider: SQLPromptProvider;
    const mockConfig: TokenMetricsConfig = {
        snowflakeUrl: 'mock-url',
        apiKey: 'mock-key',
        maxResults: 5
    };

    beforeEach(() => {
        vi.clearAllMocks();
        provider = new SQLPromptProvider(mockConfig);
    });

    describe("Query Generation", () => {
        it("should generate query for high grade tokens", async () => {
            const question = "Show me tokens with high trader grades";
            const query = await provider.generateQuery(question);

            expect(query).toContain('TM_TRADER_GRADE > 70');
            expect(query).toContain('ORDER BY TM_TRADER_GRADE DESC');
        });

        it("should generate query for market cap analysis", async () => {
            const question = "What are the most valuable tokens by market cap?";
            const query = await provider.generateQuery(question);

            expect(query).toContain('MARKET_CAP');
            expect(query).toContain('ORDER BY MARKET_CAP DESC');
        });

        it("should include default columns", async () => {
            const question = "Show basic token info";
            const query = await provider.generateQuery(question);

            expect(query).toContain('TOKEN_NAME');
            expect(query).toContain('TOKEN_SYMBOL');
            expect(query).toContain('TOKEN_URL');
        });

        it("should respect maxResults from config", async () => {
            const question = "List all tokens";
            const query = await provider.generateQuery(question);

            expect(query).toContain(`LIMIT ${mockConfig.maxResults}`);
        });
    });

    describe("Provider Interface", () => {
        it("should return null for empty question", async () => {
            const result = await provider.get({} as any, { content: { text: '' } } as any);
            expect(result).toBeNull();
        });

        it("should return query and metadata", async () => {
            const result = await provider.get(
                {} as any,
                { content: { text: 'Show top tokens' } } as any
            );

            expect(result).toHaveProperty('query');
            expect(result).toHaveProperty('rules');
            expect(result).toHaveProperty('schema');
            expect(result).toHaveProperty('columnDescriptions');
        });
    });
});