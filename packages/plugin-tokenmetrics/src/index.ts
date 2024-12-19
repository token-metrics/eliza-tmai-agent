import { Plugin, IAgentRuntime, Memory, State, Content } from "@ai16z/eliza";
import { TokenMetricsConfig, TokenMetricsAction } from "./types";
import { tokenMetricsProvider } from "./providers/tokenMetricsProvider";
import { sqlPromptProvider } from "./providers/sqlPromptProvider";
import { tavilySearchProvider } from "./providers/tavilySearchProvider";
import { validateConfig, formatTokenMetrics, handleApiError } from "./utils";

const DEFAULT_CONFIG: Partial<TokenMetricsConfig> = {
    maxResults: 10,
    cacheTimeout: 5 * 60 * 1000 // 5 minutes
};

export class TokenMetricsPlugin implements Plugin {
    readonly name: string = "tokenmetrics";
    readonly description: string = "TokenMetrics integration for market analysis and trading signals";
    private config: TokenMetricsConfig = { ...DEFAULT_CONFIG };

    constructor(config: TokenMetricsConfig) {
        this.config = { ...this.config, ...config };
        validateConfig(this.config);
    }

    actions: TokenMetricsAction[] = [
        {
            name: "GET_TOKEN_METRICS",
            description: "Get detailed metrics for a specific token",
            config: this.config,
            similes: ["token analysis", "token metrics", "token info"],
            examples: [
                [
                    {
                        user: "user",
                        content: { text: "Get metrics for Bitcoin" }
                    }
                ],
                [
                    {
                        user: "user",
                        content: { text: "Analyze ETH token" }
                    }
                ]
            ],
            validate: async (runtime: IAgentRuntime, message: Memory) => {
                const text = (message.content as Content).text;
                return Boolean(text && text.length > 0);
            },
            handler: async (runtime: IAgentRuntime, message: Memory, state?: State) => {
                try {
                    const text = (message.content as Content).text;
                    const tokenMatch = text.match(/\b[A-Z]{2,10}\b/);

                    if (!tokenMatch) {
                        return {
                            success: false,
                            response: "Please provide a valid token name or symbol"
                        };
                    }

                    const metrics = await tokenMetricsProvider.getTokenMetrics(tokenMatch[0]);

                    if (!metrics) {
                        return {
                            success: false,
                            response: `No metrics found for token: ${tokenMatch[0]}`
                        };
                    }

                    return {
                        success: true,
                        response: formatTokenMetrics(metrics)
                    };
                } catch (error) {
                    return handleApiError(error);
                }
            }
        },
        {
            name: "SEARCH_TOKENS",
            description: "Search for tokens by name or symbol",
            config: this.config,
            similes: ["find tokens", "token search", "lookup tokens"],
            examples: [
                [
                    {
                        user: "user",
                        content: { text: "Search for defi tokens" }
                    }
                ]
            ],
            validate: async (runtime: IAgentRuntime, message: Memory) => {
                const text = (message.content as Content).text;
                return Boolean(text && text.length > 0);
            },
            handler: async (runtime: IAgentRuntime, message: Memory, state?: State) => {
                try {
                    const text = (message.content as Content).text;
                    const tokens = await tokenMetricsProvider.searchTokens(text);

                    if (tokens.length === 0) {
                        return {
                            success: false,
                            response: "No tokens found matching your search"
                        };
                    }

                    const response = tokens.map(token => formatTokenMetrics(token)).join('\n\n');
                    return {
                        success: true,
                        response
                    };
                } catch (error) {
                    return handleApiError(error);
                }
            }
        },
        {
            name: "GET_SQL_PROMPT",
            description: "Get SQL query for token metrics analysis",
            config: this.config,
            similes: ["generate sql", "create query", "sql analysis"],
            examples: [
                [
                    {
                        user: "user",
                        content: { text: "Get SQL query for top performing tokens" }
                    }
                ]
            ],
            validate: async (runtime: IAgentRuntime, message: Memory) => {
                const text = (message.content as Content).text;
                return Boolean(text && text.length > 0);
            },
            handler: async (runtime: IAgentRuntime, message: Memory, state?: State) => {
                try {
                    const result = await sqlPromptProvider.get(runtime, message, state);

                    if (!result) {
                        return {
                            success: false,
                            response: "Could not generate SQL query"
                        };
                    }

                    return {
                        success: true,
                        response: `Generated SQL Query:\n\n${result.query}\n\nRules Applied:\n${result.rules.join('\n')}`
                    };
                } catch (error) {
                    return handleApiError(error);
                }
            }
        },
        {
            name: "TAVILY_SEARCH",
            description: "Search the web using Tavily API",
            config: this.config,
            similes: ["tavily", "tavilysearch", "agent search"],
            examples: [
                [
                    {
                        user: "user",
                        content: { text: "Search for recent AI developments" }
                    }
                ]
            ],
            validate: async (runtime: IAgentRuntime, message: Memory) => {
                const text = (message.content as Content).text;
                return Boolean(text && text.length > 0);
            },
            handler: async (runtime: IAgentRuntime, message: Memory, state?: State) => {
                try {
                    const result = await tavilySearchProvider.get(runtime, message, state);

                    if (!result || !result.results) {
                        return {
                            success: false,
                            response: "No search results found"
                        };
                    }

                    const formattedResults = result.results.map((r: any, i: number) =>
                        `${i + 1}. [${r.title}](${r.url})\n${r.snippet}`
                    ).join('\n\n');

                    return {
                        success: true,
                        response: formattedResults
                    };
                } catch (error) {
                    return handleApiError(error);
                }
            }
        }
    ];

    providers = [tokenMetricsProvider, sqlPromptProvider, tavilySearchProvider];
}

// Export default instance
export default new TokenMetricsPlugin({
    snowflakeUrl: process.env.SNOWFLAKE_URL || "",
    apiKey: process.env.SNOWFLAKE_API_KEY || "",
});