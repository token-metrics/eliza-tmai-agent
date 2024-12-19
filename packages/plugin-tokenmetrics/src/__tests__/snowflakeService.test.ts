import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { SnowflakeService } from '../services/snowflakeService';

// Mock snowflake-sdk
vi.mock('snowflake-sdk', () => ({
    default: {
        createConnection: vi.fn().mockReturnValue({
            connect: vi.fn((callback) => callback(null, { execute: vi.fn() })),
            execute: vi.fn(),
            destroy: vi.fn((callback) => callback(null))
        })
    }
}));

describe("SnowflakeService", () => {
    const mockCredentials = {
        user: 'test-user',
        password: 'test-pass',
        account: 'test-account',
        warehouse: 'test-warehouse',
        database: 'TOKENMETRICS_DEV',
        schema: 'ANALYTICS'
    };

    let service: SnowflakeService;

    beforeEach(() => {
        vi.clearAllMocks();
        service = SnowflakeService.getInstance(mockCredentials);
    });

    afterEach(() => {
        vi.clearAllTimers();
    });

    describe("Instance Management", () => {
        it("should maintain singleton instance", () => {
            const instance1 = SnowflakeService.getInstance(mockCredentials);
            const instance2 = SnowflakeService.getInstance(mockCredentials);
            expect(instance1).toBe(instance2);
        });
    });

    describe("Query Execution", () => {
        it("should execute query successfully", async () => {
            const mockResults = [{ id: 1, name: 'Test' }];
            const mockExecute = vi.fn((opts, callback) => {
                callback(null, {}, mockResults);
            });

            (service as any).connection = { execute: mockExecute };

            const results = await service.executeQuery('SELECT * FROM test');
            expect(results).toEqual(mockResults);
            expect(mockExecute).toHaveBeenCalledTimes(1);
        });

        it("should handle query errors", async () => {
            const mockError = new Error('Query failed');
            const mockExecute = vi.fn((opts, callback) => {
                callback(mockError);
            });

            (service as any).connection = { execute: mockExecute };

            await expect(service.executeQuery('SELECT * FROM test'))
                .rejects
                .toThrow('Query failed');
        });
    });

    describe("Connection Management", () => {
        it("should disconnect successfully", async () => {
            await service.disconnect();
            expect((service as any).connection).toBeNull();
            expect((service as any).cursor).toBeNull();
        });

        it("should handle disconnect errors", async () => {
            const mockError = new Error('Disconnect failed');
            (service as any).connection = {
                destroy: vi.fn((callback) => callback(mockError))
            };

            await expect(service.disconnect())
                .rejects
                .toThrow('Disconnect failed');
        });
    });
});