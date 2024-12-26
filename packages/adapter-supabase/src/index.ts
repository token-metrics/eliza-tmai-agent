import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import {
    type Memory,
    type Goal,
    type Relationship,
    Actor,
    GoalStatus,
    Account,
    type UUID,
    Participant,
    Room,
    IDatabaseCacheAdapter,
} from "@ai16z/eliza";
import { DatabaseAdapter } from "@ai16z/eliza";
import { v4 as uuid } from "uuid";

function pickMemoriesTable(embeddingLength: number): string {
    if (embeddingLength === 384) return "memories_384";
    if (embeddingLength === 1024) return "memories_1024";
    if (embeddingLength === 1536) return "memories_1536";
    throw new Error(
        `Unsupported embedding dimension: ${embeddingLength}. Expected one of 384, 1024, or 1536.`
    );
}

export class SupabaseDatabaseAdapter
    extends DatabaseAdapter
    implements IDatabaseCacheAdapter
{
    async getRoom(roomId: UUID): Promise<UUID | null> {
        console.log("DEBUG: Running new getRoom implementation");
        try {
            console.log("Getting room with ID:", roomId);

            const { data, error } = await this.supabase
                .from("rooms")
                .select("id")
                .eq("id", roomId)
                .maybeSingle();

            if (error) {
                console.error("Error getting room:", {
                    error,
                    roomId,
                    errorMessage: error.message,
                    errorDetails: error.details,
                });
                return null;
            }

            console.log("Room query result:", {
                roomId,
                found: !!data,
                data,
            });

            return data ? (data.id as UUID) : null;
        } catch (error) {
            console.error("Unexpected error getting room:", {
                error,
                roomId,
                errorMessage:
                    error instanceof Error ? error.message : String(error),
            });
            return null;
        }
    }

    async getParticipantsForAccount(userId: UUID): Promise<Participant[]> {
        const { data, error } = await this.supabase
            .from("participants")
            .select("*")
            .eq("userId", userId);

        if (error) {
            throw new Error(
                `Error getting participants for account: ${error.message}`
            );
        }

        return data as Participant[];
    }

    async getParticipantUserState(
        roomId: UUID,
        userId: UUID
    ): Promise<"FOLLOWED" | "MUTED" | null> {
        const { data, error } = await this.supabase
            .from("participants")
            .select("userState")
            .eq("roomId", roomId)
            .eq("userId", userId)
            .single();

        if (error) {
            console.error("Error getting participant user state:", error);
            return null;
        }

        return data?.userState as "FOLLOWED" | "MUTED" | null;
    }

    async setParticipantUserState(
        roomId: UUID,
        userId: UUID,
        state: "FOLLOWED" | "MUTED" | null
    ): Promise<void> {
        const { error } = await this.supabase
            .from("participants")
            .update({ userState: state })
            .eq("roomId", roomId)
            .eq("userId", userId);

        if (error) {
            console.error("Error setting participant user state:", error);
            throw new Error("Failed to set participant user state");
        }
    }

    async getParticipantsForRoom(roomId: UUID): Promise<UUID[]> {
        const { data, error } = await this.supabase
            .from("participants")
            .select("userId")
            .eq("roomId", roomId);

        if (error) {
            throw new Error(
                `Error getting participants for room: ${error.message}`
            );
        }

        return data.map((row) => row.userId as UUID);
    }

    supabase: SupabaseClient;

    constructor(supabaseUrl: string, supabaseKey: string) {
        super();
        this.supabase = createClient(supabaseUrl, supabaseKey);
    }

    async init() {
        // noop
    }

    async close() {
        // noop
    }

    async getMemoriesByRoomIds(params: {
        roomIds: UUID[];
        agentId?: UUID;
        tableName: string;
    }): Promise<Memory[]> {
        let query = this.supabase
            .from(params.tableName)
            .select("*")
            .in("roomId", params.roomIds);

        if (params.agentId) {
            query = query.eq("agentId", params.agentId);
        }

        const { data, error } = await query;

        if (error) {
            console.error("Error retrieving memories by room IDs:", error);
            return [];
        }

        // map createdAt to Date
        const memories = data.map((memory) => ({
            ...memory,
        }));

        return memories as Memory[];
    }

    async getAccountById(userId: UUID): Promise<Account | null> {
        const { data, error } = await this.supabase
            .from("accounts")
            .select("*")
            .eq("id", userId);
        if (error) {
            throw new Error(error.message);
        }
        return (data?.[0] as Account) || null;
    }

    async createAccount(account: Account): Promise<boolean> {
        const { error } = await this.supabase
            .from("accounts")
            .upsert([account]);
        if (error) {
            console.error(error.message);
            return false;
        }
        return true;
    }

    async getActorDetails(params: { roomId: UUID }): Promise<Actor[]> {
        try {
            const response = await this.supabase
                .from("rooms")
                .select(
                    `
          participants:participants(
            account:accounts(id, name, username, details)
          )
      `
                )
                .eq("id", params.roomId);

            if (response.error) {
                console.error("Error!" + response.error);
                return [];
            }
            const { data } = response;

            return data
                .map((room) =>
                    room.participants.map((participant) => {
                        const user = participant.account as unknown as Actor;
                        return {
                            name: user?.name,
                            details: user?.details,
                            id: user?.id,
                            username: user?.username,
                        };
                    })
                )
                .flat();
        } catch (error) {
            console.error("error", error);
            throw error;
        }
    }

    async searchMemories(params: {
        tableName: string;
        roomId: UUID;
        embedding: number[];
        match_threshold: number;
        match_count: number;
        unique: boolean;
    }): Promise<Memory[]> {
        const result = await this.supabase.rpc("search_memories", {
            query_table_name: params.tableName,
            query_roomId: params.roomId,
            query_embedding: params.embedding,
            query_match_threshold: params.match_threshold,
            query_match_count: params.match_count,
            query_unique: params.unique,
        });
        if (result.error) {
            throw new Error(JSON.stringify(result.error));
        }
        return result.data.map((memory) => ({
            ...memory,
        }));
    }

    async getCachedEmbeddings(opts: {
        query_table_name: string;
        query_threshold: number;
        query_input: string;
        query_field_name: string;
        query_field_sub_name: string;
        query_match_count: number;
    }): Promise<
        {
            embedding: number[];
            levenshtein_score: number;
        }[]
    > {
        console.log("Getting cached embeddings with opts:", opts);
        const result = await this.supabase.rpc("get_embedding_list", opts);
        console.log("Result:", result);
        if (result.error) {
            throw new Error(JSON.stringify(result.error));
        }
        return result.data;
    }

    async updateGoalStatus(params: {
        goalId: UUID;
        status: GoalStatus;
    }): Promise<void> {
        await this.supabase
            .from("goals")
            .update({ status: params.status })
            .match({ id: params.goalId });
    }

    async log(params: {
        body: { [key: string]: unknown };
        userId: UUID;
        roomId: UUID;
        type: string;
    }): Promise<void> {
        const { error } = await this.supabase.from("logs").insert({
            body: params.body,
            userId: params.userId,
            roomId: params.roomId,
            type: params.type,
        });

        if (error) {
            console.error("Error inserting log:", error);
            throw new Error(error.message);
        }
    }

    async getMemories(params: {
        roomId: UUID;
        count?: number;
        unique?: boolean;
        tableName: string;
        agentId?: UUID;
        start?: number;
        end?: number;
    }): Promise<Memory[]> {
        const query = this.supabase
            .from(params.tableName)
            .select("*")
            .eq("roomId", params.roomId);

        if (params.start) {
            query.gte("createdAt", params.start);
        }

        if (params.end) {
            query.lte("createdAt", params.end);
        }

        if (params.unique) {
            query.eq("unique", true);
        }

        if (params.agentId) {
            query.eq("agentId", params.agentId);
        }

        query.order("createdAt", { ascending: false });

        if (params.count) {
            query.limit(params.count);
        }

        const { data, error } = await query;

        if (error) {
            throw new Error(`Error retrieving memories: ${error.message}`);
        }

        return data as Memory[];
    }

    async searchMemoriesByEmbedding(
        embedding: number[],
        params: {
            match_threshold?: number;
            count?: number;
            roomId?: UUID;
            agentId?: UUID;
            unique?: boolean;
            tableName: string;
        }
    ): Promise<Memory[]> {
        const queryParams = {
            query_table_name: params.tableName,
            query_roomId: params.roomId,
            query_embedding: embedding,
            query_match_threshold: params.match_threshold,
            query_match_count: params.count,
            query_unique: !!params.unique,
        };
        if (params.agentId) {
            (queryParams as any).query_agentId = params.agentId;
        }

        const result = await this.supabase.rpc("search_memories", queryParams);
        if (result.error) {
            throw new Error(JSON.stringify(result.error));
        }
        return result.data.map((memory) => ({
            ...memory,
        }));
    }

    async getMemoryById(memoryId: UUID): Promise<Memory | null> {
        try {
            console.log("Getting memory with ID:", memoryId);

            const { data, error } = await this.supabase
                .from("memories")
                .select("*")
                .eq("id", memoryId)
                .maybeSingle();

            if (error) {
                console.error("Error retrieving memory by ID:", {
                    error,
                    memoryId,
                    errorMessage: error.message,
                    errorDetails: error.details,
                });
                return null;
            }

            return data as Memory;
        } catch (error) {
            console.error("Unexpected error retrieving memory:", {
                error,
                memoryId,
                errorMessage:
                    error instanceof Error ? error.message : String(error),
            });
            return null;
        }
    }

    async createMemory(
        memory: Memory,
        tableName: string,
        unique = false
    ): Promise<void> {
        try {
            const embeddingDim = memory.embedding?.length ?? 0;
            const dimensionTable = pickMemoriesTable(embeddingDim);

            const createdAt = memory.createdAt
                ? new Date(memory.createdAt).toISOString()
                : new Date().toISOString();

            if (unique) {
                const opts = {
                    query_table_name: dimensionTable,
                    query_userId: memory.userId,
                    query_content: memory.content.text,
                    query_roomId: memory.roomId,
                    query_embedding: memory.embedding,
                    query_createdAt: createdAt,
                    similarity_threshold: 0.95,
                };

                console.log(
                    "Checking similarity and inserting with opts:",
                    opts
                );

                const result = await this.supabase.rpc(
                    "check_similarity_and_insert",
                    opts
                );

                if (result.error) {
                    console.error("Error in check_similarity_and_insert:", {
                        error: result.error,
                        memoryId: memory.id,
                        tableName: dimensionTable,
                    });
                    throw new Error(JSON.stringify(result.error));
                }

                console.log("Successfully inserted unique memory:", memory.id);
            } else {
                console.log("Inserting non-unique memory:", {
                    memoryId: memory.id,
                    tableName: dimensionTable,
                });

                const result = await this.supabase.from(dimensionTable).insert({
                    ...memory,
                    createdAt: createdAt,
                    type: tableName,
                });

                if (result.error) {
                    console.error("Error inserting memory:", {
                        error: result.error,
                        memoryId: memory.id,
                        tableName: dimensionTable,
                    });
                    throw new Error(JSON.stringify(result.error));
                }

                console.log("Successfully inserted memory:", memory.id);
            }
        } catch (error) {
            console.error("Unexpected error creating memory:", {
                error,
                memoryId: memory.id,
                errorMessage:
                    error instanceof Error ? error.message : String(error),
            });
            throw error;
        }
    }

    async removeMemory(memoryId: UUID): Promise<void> {
        const result = await this.supabase
            .from("memories")
            .delete()
            .eq("id", memoryId);
        const { error } = result;
        if (error) {
            throw new Error(JSON.stringify(error));
        }
    }

    async removeAllMemories(roomId: UUID, tableName: string): Promise<void> {
        const result = await this.supabase.rpc("remove_memories", {
            query_table_name: tableName,
            query_roomId: roomId,
        });

        if (result.error) {
            throw new Error(JSON.stringify(result.error));
        }
    }

    async countMemories(
        roomId: UUID,
        unique = true,
        tableName: string
    ): Promise<number> {
        if (!tableName) {
            throw new Error("tableName is required");
        }
        const query = {
            query_table_name: tableName,
            query_roomId: roomId,
            query_unique: !!unique,
        };
        const result = await this.supabase.rpc("count_memories", query);

        if (result.error) {
            throw new Error(JSON.stringify(result.error));
        }

        return result.data;
    }

    async getGoals(params: {
        roomId: UUID;
        userId?: UUID | null;
        onlyInProgress?: boolean;
        count?: number;
    }): Promise<Goal[]> {
        const opts = {
            query_roomId: params.roomId,
            query_userId: params.userId,
            only_in_progress: params.onlyInProgress,
            row_count: params.count,
        };

        const { data: goals, error } = await this.supabase.rpc(
            "get_goals",
            opts
        );

        if (error) {
            throw new Error(error.message);
        }

        return goals;
    }

    async updateGoal(goal: Goal): Promise<void> {
        const { error } = await this.supabase
            .from("goals")
            .update(goal)
            .match({ id: goal.id });
        if (error) {
            throw new Error(`Error creating goal: ${error.message}`);
        }
    }

    async createGoal(goal: Goal): Promise<void> {
        const { error } = await this.supabase.from("goals").insert(goal);
        if (error) {
            throw new Error(`Error creating goal: ${error.message}`);
        }
    }

    async removeGoal(goalId: UUID): Promise<void> {
        const { error } = await this.supabase
            .from("goals")
            .delete()
            .eq("id", goalId);
        if (error) {
            throw new Error(`Error removing goal: ${error.message}`);
        }
    }

    async removeAllGoals(roomId: UUID): Promise<void> {
        const { error } = await this.supabase
            .from("goals")
            .delete()
            .eq("roomId", roomId);
        if (error) {
            throw new Error(`Error removing goals: ${error.message}`);
        }
    }

    async getRoomsForParticipant(userId: UUID): Promise<UUID[]> {
        const { data, error } = await this.supabase
            .from("participants")
            .select("roomId")
            .eq("userId", userId);

        if (error) {
            throw new Error(
                `Error getting rooms by participant: ${error.message}`
            );
        }

        return data.map((row) => row.roomId as UUID);
    }

    async getRoomsForParticipants(userIds: UUID[]): Promise<UUID[]> {
        const { data, error } = await this.supabase
            .from("participants")
            .select("roomId")
            .in("userId", userIds);

        if (error) {
            throw new Error(
                `Error getting rooms by participants: ${error.message}`
            );
        }

        return [...new Set(data.map((row) => row.roomId as UUID))] as UUID[];
    }

    async createRoom(roomId?: UUID): Promise<UUID> {
        roomId = roomId ?? (uuid() as UUID);
        const { data, error } = await this.supabase.rpc("create_room", {
            roomid: roomId,
        });

        if (error) {
            throw new Error(`Error creating room: ${error.message}`);
        }

        if (!data || data.length === 0) {
            throw new Error("No data returned from room creation");
        }

        return data[0].id as UUID;
    }

    async removeRoom(roomId: UUID): Promise<void> {
        const { error } = await this.supabase
            .from("rooms")
            .delete()
            .eq("id", roomId);

        if (error) {
            throw new Error(`Error removing room: ${error.message}`);
        }
    }

    async addParticipant(userId: UUID, roomId: UUID): Promise<boolean> {
        const { error } = await this.supabase
            .from("participants")
            .insert({ userId: userId, roomId: roomId });

        if (error) {
            console.error(`Error adding participant: ${error.message}`);
            return false;
        }
        return true;
    }

    async removeParticipant(userId: UUID, roomId: UUID): Promise<boolean> {
        const { error } = await this.supabase
            .from("participants")
            .delete()
            .eq("userId", userId)
            .eq("roomId", roomId);

        if (error) {
            console.error(`Error removing participant: ${error.message}`);
            return false;
        }
        return true;
    }

    async createRelationship(params: {
        userA: UUID;
        userB: UUID;
    }): Promise<boolean> {
        const allRoomData = await this.getRoomsForParticipants([
            params.userA,
            params.userB,
        ]);

        let roomId: UUID;

        if (!allRoomData || allRoomData.length === 0) {
            // If no existing room is found, create a new room
            const { data: newRoomData, error: roomsError } = await this.supabase
                .from("rooms")
                .insert({})
                .single();

            if (roomsError) {
                throw new Error("Room creation error: " + roomsError.message);
            }

            roomId = (newRoomData as Room)?.id as UUID;
        } else {
            // If an existing room is found, use the first room's ID
            roomId = allRoomData[0];
        }

        const { error: participantsError } = await this.supabase
            .from("participants")
            .insert([
                { userId: params.userA, roomId },
                { userId: params.userB, roomId },
            ]);

        if (participantsError) {
            throw new Error(
                "Participants creation error: " + participantsError.message
            );
        }

        // Create or update the relationship between the two users
        const { error: relationshipError } = await this.supabase
            .from("relationships")
            .upsert({
                userA: params.userA,
                userB: params.userB,
                userId: params.userA,
                status: "FRIENDS",
            })
            .eq("userA", params.userA)
            .eq("userB", params.userB);

        if (relationshipError) {
            throw new Error(
                "Relationship creation error: " + relationshipError.message
            );
        }

        return true;
    }

    async getRelationship(params: {
        userA: UUID;
        userB: UUID;
    }): Promise<Relationship | null> {
        const { data, error } = await this.supabase.rpc("get_relationship", {
            usera: params.userA,
            userb: params.userB,
        });

        if (error) {
            throw new Error(error.message);
        }

        return data[0];
    }

    async getRelationships(params: { userId: UUID }): Promise<Relationship[]> {
        const { data, error } = await this.supabase
            .from("relationships")
            .select("*")
            .or(`userA.eq.${params.userId},userB.eq.${params.userId}`)
            .eq("status", "FRIENDS");

        if (error) {
            throw new Error(error.message);
        }

        return data as Relationship[];
    }

    async getCache(params: {
        key: string;
        agentId: UUID;
    }): Promise<string | undefined> {
        try {
            const { data, error } = await this.supabase
                .from("cache")
                .select("value")
                .eq("key", params.key)
                .eq("agentId", params.agentId)
                .single();

            if (error) {
                if (error.code === "PGRST116") {
                    // No rows found
                    return undefined;
                }
                console.error("Error in getCache:", error);
                return undefined;
            }

            return data?.value;
        } catch (error) {
            console.error("Unexpected error in getCache:", error);
            return undefined;
        }
    }

    async setCache(params: {
        key: string;
        agentId: UUID;
        value: string;
        expiresAt?: Date;
    }): Promise<boolean> {
        try {
            const { error } = await this.supabase.from("cache").upsert({
                key: params.key,
                agentId: params.agentId,
                value: params.value,
                createdAt: new Date().toISOString(),
                expiresAt: params.expiresAt?.toISOString(),
            });

            if (error) {
                console.error("Error in setCache:", error);
                return false;
            }
            return true;
        } catch (error) {
            console.error("Unexpected error in setCache:", error);
            return false;
        }
    }

    async deleteCache(params: {
        key: string;
        agentId: UUID;
    }): Promise<boolean> {
        try {
            const { error } = await this.supabase
                .from("cache")
                .delete()
                .eq("key", params.key)
                .eq("agentId", params.agentId);

            if (error) {
                console.error("Error in deleteCache:", error);
                return false;
            }
            return true;
        } catch (error) {
            console.error("Unexpected error in deleteCache:", error);
            return false;
        }
    }
}
