import { createPool, Pool } from 'generic-pool';
import snowflake from 'snowflake-sdk';
import { elizaLogger } from "@ai16z/eliza";

export interface SnowflakeConfig {
    account: string;
    username: string;
    password: string;
    database: string;
    schema: string;
    warehouse: string;
}

export class SnowflakeService {
    private pool: Pool<snowflake.Connection>;

    constructor(config: SnowflakeConfig) {
        this.pool = createPool({
            create: async () => {
                return new Promise((resolve, reject) => {
                    const connection = snowflake.createConnection({
                        account: config.account,
                        username: config.username,
                        password: config.password,
                        database: config.database,
                        schema: config.schema,
                        warehouse: config.warehouse
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
                            elizaLogger.error('Error destroying connection:', err);
                        }
                        resolve();
                    });
                });
            }
        }, {
            min: 0,
            max: 5,
            acquireTimeoutMillis: 30000
        });
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
                    }
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
}