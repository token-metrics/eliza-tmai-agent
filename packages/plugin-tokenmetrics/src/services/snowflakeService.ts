import snowflake, { Connection, ConnectionOptions } from 'snowflake-sdk';
import { elizaLogger } from "@ai16z/eliza";

interface SnowflakeCredentials {
    user: string;
    password: string;
    account: string;
    warehouse: string;
    database: string;
    schema: string;
}

export class SnowflakeService {
    private connection: Connection | null = null;
    private cursor: any = null;
    private static instance: SnowflakeService;

    private constructor(private credentials: SnowflakeCredentials) {
        this.initializeConnection();
    }

    public static getInstance(credentials: SnowflakeCredentials): SnowflakeService {
        if (!SnowflakeService.instance) {
            SnowflakeService.instance = new SnowflakeService(credentials);
        }
        return SnowflakeService.instance;
    }

    private initializeConnection(): void {
        const connectionOptions: ConnectionOptions = {
            account: process.env.SNOWFLAKE_ACCOUNT || "",
            username: process.env.SNOWFLAKE_USER_TMAI || "",
            password: process.env.SNOWFLAKE_PASSWORD_TMAI || "",
            warehouse: process.env.SNOWFLAKE_WAREHOUSE_TMAI || "",
            database: process.env.SNOWFLAKE_DATABASE_TMAI || "TOKENMETRICS_PROD",
            schema: process.env.SNOWFLAKE_SCHEMA_TMAI || "ANALYTICS",
            role: process.env.SNOWFLAKE_ROLE_TMAI || "CHAT_BOT",
            clientSessionKeepAlive: true
        };

        this.connection = snowflake.createConnection(connectionOptions);

        this.connection.connect((err, conn) => {
            if (err) {
                elizaLogger.error('Unable to connect to Snowflake:', err);
                throw err;
            }
            elizaLogger.info('Successfully connected to Snowflake');
            this.cursor = conn;
        });
    }

    public async executeQuery<T>(query: string): Promise<T[]> {
        return new Promise((resolve, reject) => {
            if (!this.connection) {
                reject(new Error('No active Snowflake connection'));
                return;
            }

            this.connection.execute({
                sqlText: query,
                complete: (err, stmt, rows) => {
                    if (err) {
                        elizaLogger.error('Failed to execute query:', err);
                        reject(err);
                    } else {
                        elizaLogger.info('Query executed successfully');
                        resolve(rows as T[]);
                    }
                }
            });
        });
    }

    public async disconnect(): Promise<void> {
        if (this.connection) {
            return new Promise((resolve, reject) => {
                this.connection!.destroy((err) => {
                    if (err) {
                        elizaLogger.error('Error disconnecting from Snowflake:', err);
                        reject(err);
                    } else {
                        elizaLogger.info('Successfully disconnected from Snowflake');
                        this.connection = null;
                        this.cursor = null;
                        resolve();
                    }
                });
            });
        }
    }
}