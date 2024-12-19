import { IAgentRuntime, Memory, Provider, State, elizaLogger } from "@ai16z/eliza";
import { TokenMetricsConfig } from "../types";
import { createRateLimiter } from "../utils";

interface TavilySearchResponse {
    results: Array<{
        title: string;
        url: string;
        content: string;
    }>;
}

export interface TavilySearchConfig extends TokenMetricsConfig {
    searchType?: "search" | "news" | "academic";
}

export class TavilySearchProvider implements Provider {
    private config: TavilySearchConfig;
    private rateLimiter = createRateLimiter(60, 60000); // 60 requests per minute

    constructor(config: TavilySearchConfig) {
        this.config = {
            maxResults: 5,
            searchType: "search",
            ...config
        };
    }

    async search(query: string): Promise<TavilySearchResponse> {
        if (!this.rateLimiter.checkLimit()) {
            throw new Error("Rate limit exceeded. Please try again later.");
        }

        const response = await fetch("https://api.tavily.com/search", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${this.config.apiKey}`
            },
            body: JSON.stringify({
                query,
                search_type: this.config.searchType,
                max_results: this.config.maxResults
            })
        });

        if (!response.ok) {
            throw new Error(`Tavily API error: ${response.statusText}`);
        }

        return await response.json();
    }

    async get(
        runtime: IAgentRuntime,
        message: Memory,
        state?: State
    ): Promise<any> {
        try {
            const query = (message.content as any)?.text;
            if (!query) return null;

            const results = await this.search(query);
            return {
                results: results.results.map(result => ({
                    title: result.title,
                    url: result.url,
                    snippet: result.content,
                    source: "tavily"
                }))
            };
        } catch (error) {
            elizaLogger.error('Error in TavilySearchProvider:', error);
            return null;
        }
    }
}

export const tavilySearchProvider = new TavilySearchProvider({
    apiKey: process.env.TAVILY_API_KEY || "",
    maxResults: 5,
    searchType: "search"
});