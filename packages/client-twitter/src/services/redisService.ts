import { createClient, RedisClientType } from 'redis';
import { elizaLogger } from "@ai16z/eliza";

export interface RedisConfig {
    host: string;
    port: number;
    password?: string;
}

export class RedisService {
    private client: RedisClientType;

    constructor(config: RedisConfig) {
        this.client = createClient({
            password: config.password,
            socket: {
                host: config.host,
                port: config.port
            }
        });

        this.client.on('error', (err) => {
            elizaLogger.error('Redis Client Error:', err);
        });

        this.client.connect().catch((err) => {
            elizaLogger.error('Redis Connection Error:', err);
        });
    }

    async get(key: string): Promise<string | null> {
        try {
            return await this.client.get(key);
        } catch (error) {
            elizaLogger.error('Redis GET Error:', error);
            throw error;
        }
    }

    async set(key: string, value: string, ttlSeconds?: number): Promise<void> {
        try {
            if (ttlSeconds) {
                await this.client.setEx(key, ttlSeconds, value);
            } else {
                await this.client.set(key, value);
            }
        } catch (error) {
            elizaLogger.error('Redis SET Error:', error);
            throw error;
        }
    }

    async delete(key: string): Promise<void> {
        try {
            await this.client.del(key);
        } catch (error) {
            elizaLogger.error('Redis DELETE Error:', error);
            throw error;
        }
    }

    async update(key: string, value: string, ttlSeconds?: number): Promise<void> {
        await this.set(key, value, ttlSeconds);
    }

    async disconnect(): Promise<void> {
        await this.client.disconnect();
    }
}
