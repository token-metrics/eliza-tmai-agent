import { createPool, Pool } from "generic-pool";
import snowflake from "snowflake-sdk";
import { elizaLogger } from "@ai16z/eliza";

export interface SnowflakeConfig {
    account: string;
    username: string;
    password: string;
    warehouse: string;
}

export class SnowflakeService {
    private pool: Pool<snowflake.Connection>;
    private static cryptoHubCurrentView = 'TOKENMETRICS_PROD.ANALYTICS.CRYPTO_INFO_HUB_CURRENT_VIEW'
    private static marketVolumeTable = 'TOKENMETRICS_PROD.ANALYTICS.TM_MARKET_VOLUME'
    private static coingeckoTokensTable = 'CRYPTO_DB.COINGECKO.COINGECKO_TOKENS'
    private static marketMetricsTable = 'TOKENMETRICS_PROD.ANALYTICS.TM_MARKET_METRICS'
    private static sectorAnalysisTable = 'TOKENMETRICS_PROD.ANALYTICS.TM_MARKET_SECTOR_ANALYSIS'
    private static tradersHoldingTable = 'TOKENMETRICS_PROD.INDICES.TRADERS_PERFORMANCES'

    constructor(config: SnowflakeConfig) {
        this.pool = createPool(
            {
                create: async () => {
                    return new Promise((resolve, reject) => {
                        const connection = snowflake.createConnection({
                            account: config.account,
                            username: config.username,
                            password: config.password,
                            warehouse: config.warehouse,
                        });

                        connection.connect((err, conn) => {
                            if (err) {
                                reject(err);
                            } else {
                                resolve(conn);
                            }
                        });
                    });
                },
                destroy: async (connection) => {
                    return new Promise((resolve) => {
                        connection.destroy((err) => {
                            if (err) {
                                elizaLogger.error(
                                    "Error destroying connection:",
                                    err
                                );
                            }
                            resolve();
                        });
                    });
                },
            },
            {
                min: 0,
                max: 5,
                acquireTimeoutMillis: 30000,
            }
        );
    }

    async query<T>(sql: string): Promise<T[]> {
        const connection = await this.pool.acquire();

        try {
            return new Promise((resolve, reject) => {
                connection.execute({
                    sqlText: sql,
                    complete: (err, stmt, rows) => {
                        if (err) {
                            reject(err);
                        } else {
                            resolve(rows as T[]);
                        }
                    },
                });
            });
        } finally {
            await this.pool.release(connection);
        }
    }

    async getTokenMetrics(): Promise<any[]> {
        const query = `
            WITH RankedTokens AS (
                SELECT
                    token_symbol,
                    current_price,
                    tm_trader_grade,
                    trader_grade_signal,
                    volume_24h,
                    market_cap,
                    fully_diluted_valuation,
                    ROW_NUMBER() OVER (PARTITION BY token_symbol ORDER BY tm_trader_grade DESC NULLS LAST) as rn
                FROM TOKENMETRICS_DEV.ANALYTICS.CRYPTO_INFO_HUB_CURRENT_VIEW
                WHERE timestamp >= DATEADD(hour, -24, CURRENT_TIMESTAMP())
                AND market_cap > 1000000  -- Filter out very small caps
                AND volume_24h > 100000   -- Filter out low volume
            )
            SELECT
                token_symbol,
                current_price,
                volume_24h,
                trader_grade_signal,
                market_cap,
                fully_diluted_valuation,
            FROM RankedTokens
            WHERE rn = 1  -- Get latest data point for each token
            ORDER BY tm_trader_grade DESC NULLS LAST
            LIMIT 5;
        `;

        return this.query(query);
    }

    async getDailyTopPerformers(): Promise<any[]> {
      let topDailyPerformers = []

      const query = `
        SELECT * FROM ${SnowflakeService.cryptoHubCurrentView}
        WHERE VOLUME_24H >= 300000
        ORDER BY PRICE_CHANGE_PERCENTAGE['24h']::FLOAT DESC NULLS LAST
        LIMIT 5;
      `;

      topDailyPerformers = await this.query(query)

      if (topDailyPerformers.length) return topDailyPerformers

      const fallbackQuery = `
        SELECT * FROM ${SnowflakeService.marketVolumeTable}
        INNER JOIN ${SnowflakeService.coingeckoTokensTable} ON TOKEN_ID = ID
        WHERE date = (SELECT MAX(date) FROM ${SnowflakeService.marketVolumeTable})
        ORDER BY one_day_ret DESC
        LIMIT 5;
      `

      topDailyPerformers = await this.query(fallbackQuery)

      return topDailyPerformers
    }

    async getRecentlyTurnedBullish(): Promise<any[]> {
      const query = `
        SELECT * FROM ${SnowflakeService.cryptoHubCurrentView} c
        WHERE c.LAST_TRADING_SIGNAL['value'] = 1 AND c.VOLUME_24h >= 300000
        ORDER BY c.LAST_TRADING_SIGNAL['timestamp'] DESC, c.LAST_TRADING_SIGNAL['returns_since_last_signal'] DESC
        LIMIT 5;
      `;

      return this.query(query);
    }

    async getMarketMetrics(): Promise<any[]> {
      const query = `
        SELECT * FROM ${SnowflakeService.marketMetricsTable} ORDER BY date ASC;
      `;

      return this.query(query);
    }

    async getBitcoinVsAltcoinSeason(): Promise<any[]> {
      const query = `
        SELECT * FROM ${SnowflakeService.marketMetricsTable} ORDER BY date ASC;
      `;

      return this.query(query);
    }

    async getSectorAnalysis(): Promise<any[]> {
      const query = `
        WITH max_date AS (
          SELECT MAX(date) AS max_date FROM ${SnowflakeService.sectorAnalysisTable}
        ),
        sector_analysis AS (
          SELECT m.*
          FROM ${SnowflakeService.sectorAnalysisTable} m
          JOIN max_date d ON m.date = d.max_date
          WHERE m.token_daily_per_change = (
            SELECT MAX(token_daily_per_change)
            FROM ${SnowflakeService.sectorAnalysisTable} x
            WHERE x.sector_name = m.sector_name AND x.date = d.max_date
          )
        )
        SELECT
          s.*,
          ct.IMAGES as LOGO
        FROM sector_analysis s
        LEFT JOIN ${SnowflakeService.coingeckoTokensTable} ct
        ON s.TOKEN_ID = ct.ID
      `;

      return this.query(query);
    }

    async getTopTokensWith1MVolume(): Promise<any[]> {
      const query = `
        SELECT * FROM ${SnowflakeService.cryptoHubCurrentView}
        WHERE TM_TRADER_GRADE IS NOT NULL AND MARKET_CAP >= 100000 AND VOLUME_24H > 1000000
        ORDER BY TM_TRADER_GRADE DESC
        LIMIT 10;
      `;

      return this.query(query);
    }

    async getIndicesNewTokens(): Promise<any> {
      const query = `
        SELECT * FROM ${SnowflakeService.tradersHoldingTable} AS I
        LEFT JOIN ${SnowflakeService.coingeckoTokensTable} AS C ON C.ID = I.TOKEN_ID
        WHERE I.PORTFOLIO_DATE = (SELECT MAX(PORTFOLIO_DATE) FROM ${SnowflakeService.tradersHoldingTable});
      `;
      const prevQuery = `
        SELECT * FROM ${SnowflakeService.tradersHoldingTable} AS I
        LEFT JOIN ${SnowflakeService.coingeckoTokensTable} AS C ON C.ID = I.TOKEN_ID
        WHERE I.PORTFOLIO_DATE = (
          SELECT MAX(PORTFOLIO_DATE)
          FROM ${SnowflakeService.tradersHoldingTable}
          WHERE PORTFOLIO_DATE < (CURRENT_DATE - INTERVAL '1 DAY')
        );
      `

      const [currentIndexTokens, prevIndexTokens] = await Promise.all([this.query(query), this.query(prevQuery)])
      const newTokens = currentIndexTokens.filter((token: any) => !prevIndexTokens.some((prevToken: any) => prevToken.TOKEN_ID === token.TOKEN_ID))

      return newTokens
    }

    async getIndicesTokensWithHighestHoldings(): Promise<any> {
      const query = `
        SELECT * FROM ${SnowflakeService.tradersHoldingTable} AS I
        LEFT JOIN ${SnowflakeService.coingeckoTokensTable} AS C ON C.ID = I.TOKEN_ID
        WHERE I.PORTFOLIO_DATE = (SELECT MAX(PORTFOLIO_DATE) FROM ${SnowflakeService.tradersHoldingTable});
      `;

      const currentIndexTokens = await this.query(query)
      const tokensWithHighestHoldings = currentIndexTokens.sort((a: any, b: any) => b.INDEX_WEIGHT - a.INDEX_WEIGHT).slice(0, 5)

      return tokensWithHighestHoldings
    }
}
