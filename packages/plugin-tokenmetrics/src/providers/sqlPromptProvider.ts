import { IAgentRuntime, Memory, Provider, State, elizaLogger } from "@ai16z/eliza";
import { TokenMetricsConfig } from "../types";
import { createRateLimiter } from "../utils";
import { SnowflakeService } from "../services/snowflakeService";

interface ColumnDescription {
    name: string;
    type: string;
    description: string;
}

export class SQLPromptProvider implements Provider {
    private config: TokenMetricsConfig;
    private tableSchema: string;
    private queryRules: string[];
    private columnDescriptions: Map<string, ColumnDescription>;
    private snowflakeService: SnowflakeService;
    private rateLimiter = createRateLimiter(60, 60000); // 60 requests per minute

    constructor(config: TokenMetricsConfig) {
        this.config = {
            maxResults: 5,
            ...config
        };
        this.initializeSchema();
        this.initializeRules();
        this.initializeColumnDescriptions();
        this.initializeSnowflake();
    }

    private initializeSnowflake() {
        const credentials = {
            user: process.env.SNOWFLAKE_USER || "",
            password: process.env.SNOWFLAKE_PASSWORD || "",
            account: process.env.SNOWFLAKE_ACCOUNT || "",
            warehouse: process.env.SNOWFLAKE_WAREHOUSE || "",
            database: "TOKENMETRICS_DEV",
            schema: "ANALYTICS"
        };
        this.snowflakeService = SnowflakeService.getInstance(credentials);
    }

    private initializeColumnDescriptions() {
        this.columnDescriptions = new Map([
            ["TM_TRADER_GRADE", {
                name: "TM_TRADER_GRADE",
                type: "FLOAT",
                description: "TM Trader Grade (%) for short term traders. Higher is more bullish."
            }],
            ["TA_GRADE", {
                name: "TA_GRADE",
                type: "FLOAT",
                description: "Technical Analysis Grade (%). Higher means more bullish."
            }],
            ["QUANT_GRADE", {
                name: "QUANT_GRADE",
                type: "FLOAT",
                description: "Quantitative analysis grade based on market metrics."
            }],
            ["TM_INVESTOR_GRADE", {
                name: "TM_INVESTOR_GRADE",
                type: "FLOAT",
                description: "Long-term investor grade considering fundamentals and tokenomics."
            }],
            ["FUNDAMENTAL_GRADE", {
                name: "FUNDAMENTAL_GRADE",
                type: "FLOAT",
                description: "Project fundamentals score including team, roadmap, and adoption."
            }],
            ["TECHNOLOGY_GRADE", {
                name: "TECHNOLOGY_GRADE",
                type: "FLOAT",
                description: "Technical implementation and innovation score."
            }],
            ["VALUATION_GRADE", {
                name: "VALUATION_GRADE",
                type: "FLOAT",
                description: "Token valuation analysis compared to peers."
            }],
            ["TVL", {
                name: "TVL",
                type: "FLOAT",
                description: "Total Value Locked in USD for DeFi protocols."
            }],
            ["TRADING_SIGNAL", {
                name: "TRADING_SIGNAL",
                type: "NUMBER",
                description: "Trading signal indicator (-1: Bearish, 0: Neutral, 1: Bullish)."
            }],
            ["TOKEN_TREND", {
                name: "TOKEN_TREND",
                type: "NUMBER",
                description: "Overall token trend (-1: Downtrend, 0: Sideways, 1: Uptrend)."
            }],
            ["MARKET_CAP", {
                name: "MARKET_CAP",
                type: "FLOAT",
                description: "Current market capitalization in USD."
            }],
            ["VOLUME_24H", {
                name: "VOLUME_24H",
                type: "FLOAT",
                description: "Trading volume in last 24 hours in USD."
            }]
        ]);
    }

    private initializeSchema() {
        this.tableSchema = `
            CREATE OR REPLACE TABLE TOKENMETRICS_DEV.ANALYTICS.CRYPTO_INFO_HUB_CURRENT_VIEW (
                DATE DATE,
                TOKEN_NAME VARCHAR,
                TOKEN_SYMBOL VARCHAR,
                SUMMARY VARCHAR,
                TOKEN_URL VARCHAR,
                PLATFORMS OBJECT,
                TM_TRADER_GRADE FLOAT,
                TA_GRADE FLOAT,
                QUANT_GRADE FLOAT,
                TM_INVESTOR_GRADE FLOAT,
                FUNDAMENTAL_GRADE FLOAT,
                TECHNOLOGY_GRADE FLOAT,
                VALUATION_GRADE FLOAT,
                VALUATION_METRICS OBJECT,
                MAX_DRAWDOWN FLOAT,
                SORTINO FLOAT,
                TVL FLOAT,
                TRADING_SIGNAL NUMBER,
                TRADER_GRADE_SIGNAL VARCHAR,
                TOKEN_TREND NUMBER,
                VOLUME_24H FLOAT,
                MARKET_CAP FLOAT,
                MARKET_CAP_RANK INT,
                CIRCULATING_SUPPLY INT,
                TOTAL_SUPPLY INT,
                MAX_SUPPLY INT,
                FULLY_DILUTED_VALUATION FLOAT,
                HIGH_24H FLOAT,
                LOW_24H FLOAT,
                ALL_TIME_HIGH OBJECT,
                ALL_TIME_LOW OBJECT,
                PRICE_CHANGE_PERCENTAGE OBJECT
            )`;
    }

    private initializeRules() {
        this.queryRules = [
            "Always use LOWER(TOKEN_NAME) in WHERE clauses",
            "Include TOKEN_URL, MARKET_CAP, and FULLY_DILUTED_VALUATION in SELECT",
            "Use NULLS LAST in ORDER BY clauses",
            "Default sort is by VOLUME_24H DESC",
            "Limit results to 10 for list queries",
            "Include SUMMARY for single token queries",
            "Use STRIP_NULL_VALUE for OBJECT columns",
            "Include contributory metrics for primary grades"
        ];
    }

    async generateQuery(question: string): Promise<string> {
        try {
            if (!this.rateLimiter.checkLimit()) {
                throw new Error("Rate limit exceeded");
            }

            // Extract key metrics based on question context
            const metrics = Array.from(this.columnDescriptions.entries())
                .filter(([_, desc]) =>
                    question.toLowerCase().includes(desc.description.toLowerCase()) ||
                    question.toLowerCase().includes(desc.name.toLowerCase())
                )
                .map(([name]) => name);

            // Add default columns for context
            const defaultColumns = ["TOKEN_NAME", "TOKEN_SYMBOL", "TOKEN_URL", "MARKET_CAP"];
            const selectedColumns = [...new Set([...defaultColumns, ...metrics])];

            // Determine sorting based on question context
            let orderBy = "VOLUME_24H DESC";
            if (question.toLowerCase().includes("grade") || question.toLowerCase().includes("score")) {
                orderBy = "TM_TRADER_GRADE DESC";
            } else if (question.toLowerCase().includes("value") || question.toLowerCase().includes("price")) {
                orderBy = "MARKET_CAP DESC";
            }

            return `
                SELECT
                    ${selectedColumns.join(',\n                    ')}
                FROM TOKENMETRICS_DEV.ANALYTICS.CRYPTO_INFO_HUB_CURRENT_VIEW
                WHERE 1=1
                ${question.includes("high") ? "AND TM_TRADER_GRADE > 70" : ""}
                ${question.includes("low") ? "AND TM_TRADER_GRADE < 30" : ""}
                ORDER BY ${orderBy} NULLS LAST
                LIMIT ${this.config.maxResults}
            `;
        } catch (error) {
            elizaLogger.error('Error generating SQL query:', error);
            throw error;
        }
    }

    async executeQuery<T>(query: string): Promise<T[]> {
        try {
            return await this.snowflakeService.executeQuery<T>(query);
        } catch (error) {
            elizaLogger.error('Error executing Snowflake query:', error);
            throw error;
        }
    }

    async get(
        runtime: IAgentRuntime,
        message: Memory,
        state?: State
    ): Promise<any> {
        try {
            const question = (message.content as any)?.text;
            if (!question) return null;

            const query = await this.generateQuery(question);
            const results = await this.snowflakeService.executeQuery(query);

            return {
                query,
                results,
                rules: this.queryRules,
                schema: this.tableSchema,
                columnDescriptions: Object.fromEntries(this.columnDescriptions)
            };
        } catch (error) {
            elizaLogger.error('Error in SQLPromptProvider:', error);
            return null;
        }
    }
}

export const sqlPromptProvider = new SQLPromptProvider({
    snowflakeUrl: process.env.SNOWFLAKE_URL || "",
    apiKey: process.env.SNOWFLAKE_API_KEY || ""
});