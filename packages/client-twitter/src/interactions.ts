import { SearchMode, Tweet } from "agent-twitter-client";
import {
    composeContext,
    generateMessageResponse,
    generateShouldRespond,
    messageCompletionFooter,
    shouldRespondFooter,
    Content,
    HandlerCallback,
    IAgentRuntime,
    Memory,
    ModelClass,
    State,
    stringToUuid,
    elizaLogger,
    getEmbeddingZeroVector,
    generateText,
} from "@ai16z/eliza";
import { ClientBase } from "./base";
import { buildConversationThread, sendTweet, wait } from "./utils.ts";
import { SnowflakeConfig } from "./services/snowflakeService.ts";
import { SnowflakeService } from "./services/snowflakeService.ts";

export const twitterMessageHandlerTemplate = (data: any) => `
# Areas of Expertise
{{knowledge}}

# About {{agentName}} (@{{twitterUserName}}):
{{bio}}
{{lore}}
{{topics}}

{{providers}}

{{characterPostExamples}}

{{postDirections}}

Recent interactions between {{agentName}} and other users:
{{recentPostInteractions}}

{{recentPosts}}

# Task: Generate a post/reply in the voice, style and perspective of {{agentName}} (@{{twitterUserName}}) while using the thread of tweets as additional context:
Current Post:
{{currentPost}}

Thread of Tweets You Are Replying To:
{{formattedConversation}}

Keeping in mind the Current Post, and the thread of tweets, generate a suitable response using the data given below:
Remember to adhere to the instruction, personality style, rules etc which you have been provided. Only use the data below to formulate an answer:
<data>
    ${data}
</data>

Rules:
1. If there is no relevant data available, clearly state that you do not have data for the question, ask another question.
2. Do not make up your own data, or answer from your own knowledge. Only use the provided data.
3. Formulate the answer like a human being in natural conversation, not as a computer.
4. Give answers as if they are being given by Token Metrics
5. Always use the TRADER_GRADE_SIGNAL (strong buy, buy, neutral, sell, strong sell) in the final response, do not use TRADER_GRADE percentage.
6. Do not tell the user that you were given data. Respond as if you already know the data.
7. If there are signals in the SQL data, then format them in the final response. 1 means bullish, -1 means bearish.

These are some examples of user question and data and final answer:
<example>
Question: What is the next 100x coin?
Data: {{'TIMESTAMP': ['2024-11-20 15:00:00.000 +0000'], 'TOKEN_NAME': ['Ethereum'], 'TOKEN_SYMBOL': ['ETH'], 'TOKEN_URL': ['https://app.tokenmetrics.com/ethereum'], 'TM_INVESTOR_GRADE': [98], 'TM_INVESTOR_GRADE_SIGNAL': ['strong buy'], 'MARKET_CAP': ['100B'], 'FULLY_DILUTED_VALUATION': ['200B'], 'CURRENT_PRICE': ['3000']}}
Answer: When hunting for the next 100x, it’s crucial to strike a balance between strong fundamentals and future potential. The Investor Grade for Ethereum ($ETH) currently shows a strong buy, indicating its solidity in the market. With a market cap of $100B and rich ecosystem prospects—think layer 2 scaling solutions—the path forward looks resilient. It may not 100x from here, but $ETH is a bedrock to watch. 🌐🚀

For more detailed analysis, check out [Ethereum's overview](https://app.tokenmetrics.com/ethereum).

Data last updated on 2024-11-20 15:00:00 UTC.
</example>

<example>
Question: What is the least risky token?
Data: {{'TIMESTAMP': ['2024-11-20 15:00:00.000 +0000'], 'TOKEN_NAME': ['GroveCoin'], 'TOKEN_SYMBOL': ['GRV'], 'TOKEN_URL': ['https://app.tokenmetrics.com/grove'], 'QUANT_GRADE': [Decimal('100.00')], 'MARKET_CAP': ['10M'], 'FULLY_DILUTED_VALUATION': ['20M'], 'CURRENT_PRICE': ['1']}}
Answer: Looking for low-risk plays? 🌿 GroveCoin ($GRV) holds a perfect Quant Grade of 100%, signaling strong risk-adjusted potential. With a market cap of just $10M, it's positioning itself as a stable pick in a volatile market. While the growth potential might be limited, its solid fundamentals and valuation suggest stability. Check out [GroveCoin's details](https://app.tokenmetrics.com/grove) for more.

Data last updated on 2024-11-20 15:00:00 UTC.
</example>

<example>
Question: Top 3 coins with more than $1M 24h trading volume sorted by Trader Grade?
Data: {{'TIMESTAMP': ['2024-11-20 15:00:00.000 +0000'], 'TOKEN_NAME': ['Banana Gun', 'TON Raffles', 'Aerodrome Finance'], 'TOKEN_SYMBOL': ['BANANA', 'RAFF', 'AERO'], 'TOKEN_URL': [ 'https://app.tokenmetrics.com/banana-gun', 'https://app.tokenmetrics.com/ton-raffles', 'https://app.tokenmetrics.com/aerodrome-finance'], 'TRADER_GRADE_SIGNAL': ['Strong Buy', 'Strong Buy', 'Strong Buy'], 'TM_TRADER_GRADE_CHANGE_PERCENTAGE_24H': [18.93, 1.81, 0.63], 'VOLUME_24H': [2807296.0, 1768122.0, 12248532.0], 'MARKET_CAP': ['1B', '500M', '200M'], 'FULLY_DILUTED_VALUATION': ['2B', '1B', '500M'], 'CURRENT_PRICE': ['10', '5', '2']}}
Answer: For traders hunting for action with substantial liquidity, here are the top 3 coins sorted by **Trader Grade Signal**:

| Token Name          | Symbol   | Trader Grade Signal | 24h Change (%) | 24h Volume   | Market Cap |
|---------------------|----------|---------------------|----------------|--------------|------------|
| [Banana Gun](https://app.tokenmetrics.com/banana-gun)       | BANANA   | Strong Buy          | 18.93          | $2.81M       | $1B        |
| [TON Raffles](https://app.tokenmetrics.com/ton-raffles)     | RAFF     | Strong Buy          | 1.81           | $1.77M       | $500M      |
| [Aerodrome Finance](https://app.tokenmetrics.com/aerodrome-finance) | AERO     | Strong Buy          | 0.63           | $12.25M      | $200M      |

Banana Gun ($BANANA) leads the way with a **Strong Buy** signal and an impressive 18.93% surge in the last 24 hours—an exciting prospect for momentum trades!

**Data last updated:** 2024-11-20 15:00:00 UTC.
</example>
` + messageCompletionFooter;

export const twitterShouldRespondTemplate = (targetUsersStr: string) =>
    `# INSTRUCTIONS: Determine if {{agentName}} (@{{twitterUserName}}) should respond to the message and participate in the conversation. Do not comment. Just respond with "true" or "false".

Response options are RESPOND, IGNORE and STOP.

PRIORITY RULE: ALWAYS RESPOND to these users regardless of topic or message content: ${targetUsersStr}. Topic relevance should be ignored for these users.

For other users:
- {{agentName}} should RESPOND to messages directed at them
- {{agentName}} should RESPOND to conversations relevant to their background
- {{agentName}} should IGNORE irrelevant messages
- {{agentName}} should IGNORE very short messages unless directly addressed
- {{agentName}} should STOP if asked to stop
- {{agentName}} should STOP if conversation is concluded
- {{agentName}} is in a room with other users and wants to be conversational, but not annoying.

{{recentPosts}}

IMPORTANT: For users not in the priority list, {{agentName}} (@{{twitterUserName}}) should err on the side of IGNORE rather than RESPOND if in doubt.

{{recentPosts}}

IMPORTANT: {{agentName}} (aka @{{twitterUserName}}) is particularly sensitive about being annoying, so if there is any doubt, it is better to IGNORE than to RESPOND.

{{currentPost}}

Thread of Tweets You Are Replying To:

{{formattedConversation}}

# INSTRUCTIONS: Respond with [RESPOND] if {{agentName}} should respond, or [IGNORE] if {{agentName}} should not respond to the last message and [STOP] if {{agentName}} should stop participating in the conversation.
` + shouldRespondFooter;

export class TwitterInteractionClient {
    client: ClientBase;
    runtime: IAgentRuntime;
    snowflakeService: SnowflakeService;
    constructor(client: ClientBase, runtime: IAgentRuntime) {
        this.client = client;
        this.runtime = runtime;

        // Initialize services
        const snowflakeConfig: SnowflakeConfig = {
            account: runtime.getSetting("SNOWFLAKE_ACCOUNT"),
            username: runtime.getSetting("SNOWFLAKE_USERNAME"),
            password: runtime.getSetting("SNOWFLAKE_PASSWORD"),
            database: runtime.getSetting("SNOWFLAKE_DATABASE"),
            schema: runtime.getSetting("SNOWFLAKE_SCHEMA"),
            warehouse: runtime.getSetting("SNOWFLAKE_WAREHOUSE")
        };

        this.snowflakeService = new SnowflakeService(snowflakeConfig);
    }

    async start() {
        const handleTwitterInteractionsLoop = () => {
            this.handleTwitterInteractions();
            setTimeout(
                handleTwitterInteractionsLoop,
                Number(
                    this.runtime.getSetting("TWITTER_POLL_INTERVAL") || 120
                ) * 1000 // Default to 2 minutes
            );
        };
        handleTwitterInteractionsLoop();
    }

    async handleTwitterInteractions() {
        elizaLogger.log("Checking Twitter interactions");
        // Read from environment variable, fallback to default list if not set
        const targetUsersStr = this.runtime.getSetting("TWITTER_TARGET_USERS");

        const twitterUsername = this.client.profile.username;
        try {
            // Check for mentions
            const mentionCandidates = (
                await this.client.fetchSearchTweets(
                    `@${twitterUsername}`,
                    20,
                    SearchMode.Latest
                )
            ).tweets;

            elizaLogger.log(
                "Completed checking mentioned tweets:",
                mentionCandidates.length
            );
            let uniqueTweetCandidates = [...mentionCandidates];
            // Only process target users if configured
            if (targetUsersStr && targetUsersStr.trim()) {
                const TARGET_USERS = targetUsersStr
                    .split(",")
                    .map((u) => u.trim())
                    .filter((u) => u.length > 0); // Filter out empty strings after split

                elizaLogger.log("Processing target users:", TARGET_USERS);

                if (TARGET_USERS.length > 0) {
                    // Create a map to store tweets by user
                    const tweetsByUser = new Map<string, Tweet[]>();

                    // Fetch tweets from all target users
                    for (const username of TARGET_USERS) {
                        try {
                            const userTweets = (
                                await this.client.twitterClient.fetchSearchTweets(
                                    `from:${username}`,
                                    3,
                                    SearchMode.Latest
                                )
                            ).tweets;

                            // Filter for unprocessed, non-reply, recent tweets
                            const validTweets = userTweets.filter((tweet) => {
                                const isUnprocessed =
                                    !this.client.lastCheckedTweetId ||
                                    parseInt(tweet.id) >
                                        this.client.lastCheckedTweetId;
                                const isRecent =
                                    Date.now() - tweet.timestamp * 1000 <
                                    2 * 60 * 60 * 1000;

                                elizaLogger.log(`Tweet ${tweet.id} checks:`, {
                                    isUnprocessed,
                                    isRecent,
                                    isReply: tweet.isReply,
                                    isRetweet: tweet.isRetweet,
                                });

                                return (
                                    isUnprocessed &&
                                    !tweet.isReply &&
                                    !tweet.isRetweet &&
                                    isRecent
                                );
                            });

                            if (validTweets.length > 0) {
                                tweetsByUser.set(username, validTweets);
                                elizaLogger.log(
                                    `Found ${validTweets.length} valid tweets from ${username}`
                                );
                            }
                        } catch (error) {
                            elizaLogger.error(
                                `Error fetching tweets for ${username}:`,
                                error
                            );
                            continue;
                        }
                    }

                    // Select one tweet from each user that has tweets
                    const selectedTweets: Tweet[] = [];
                    for (const [username, tweets] of tweetsByUser) {
                        if (tweets.length > 0) {
                            // Randomly select one tweet from this user
                            const randomTweet =
                                tweets[
                                    Math.floor(Math.random() * tweets.length)
                                ];
                            selectedTweets.push(randomTweet);
                            elizaLogger.log(
                                `Selected tweet from ${username}: ${randomTweet.text?.substring(0, 100)}`
                            );
                        }
                    }

                    // Add selected tweets to candidates
                    uniqueTweetCandidates = [
                        ...mentionCandidates,
                        ...selectedTweets,
                    ];
                }
            } else {
                elizaLogger.log(
                    "No target users configured, processing only mentions"
                );
            }

            // Sort tweet candidates by ID in ascending order
            uniqueTweetCandidates
                .sort((a, b) => a.id.localeCompare(b.id))
                .filter((tweet) => tweet.userId !== this.client.profile.id);

            // for each tweet candidate, handle the tweet
            for (const tweet of uniqueTweetCandidates) {
                if (
                    !this.client.lastCheckedTweetId ||
                    BigInt(tweet.id) > this.client.lastCheckedTweetId
                ) {
                    // Generate the tweetId UUID the same way it's done in handleTweet
                    const tweetId = stringToUuid(
                        tweet.id + "-" + this.runtime.agentId
                    );

                    // Check if we've already processed this tweet
                    const existingResponse =
                        await this.runtime.messageManager.getMemoryById(
                            tweetId
                        );

                    if (existingResponse) {
                        elizaLogger.log(
                            `Already responded to tweet ${tweet.id}, skipping`
                        );
                        continue;
                    }
                    elizaLogger.log("New Tweet found", tweet.permanentUrl);

                    const roomId = stringToUuid(
                        tweet.conversationId + "-" + this.runtime.agentId
                    );

                    const userIdUUID =
                        tweet.userId === this.client.profile.id
                            ? this.runtime.agentId
                            : stringToUuid(tweet.userId!);

                    await this.runtime.ensureConnection(
                        userIdUUID,
                        roomId,
                        tweet.username,
                        tweet.name,
                        "twitter"
                    );

                    const thread = await buildConversationThread(
                        tweet,
                        this.client
                    );

                    const message = {
                        content: { text: tweet.text },
                        agentId: this.runtime.agentId,
                        userId: userIdUUID,
                        roomId,
                    };

                    await this.handleTweet({
                        tweet,
                        message,
                        thread,
                    });

                    // Update the last checked tweet ID after processing each tweet
                    this.client.lastCheckedTweetId = BigInt(tweet.id);
                }
            }

            // Save the latest checked tweet ID to the file
            await this.client.cacheLatestCheckedTweetId();

            elizaLogger.log("Finished checking Twitter interactions");
        } catch (error) {
            elizaLogger.error("Error handling Twitter interactions:", error);
        }
    }

    private async handleTweet({
        tweet,
        message,
        thread,
    }: {
        tweet: Tweet;
        message: Memory;
        thread: Tweet[];
    }) {
        if (tweet.userId === this.client.profile.id) {
            // console.log("skipping tweet from bot itself", tweet.id);
            // Skip processing if the tweet is from the bot itself
            return;
        }

        if (!message.content.text) {
            elizaLogger.log("Skipping Tweet with no text", tweet.id);
            return { text: "", action: "IGNORE" };
        }

        elizaLogger.log("Processing Tweet: ", tweet.id);
        const formatTweet = (tweet: Tweet) => {
            return `  ID: ${tweet.id}
  From: ${tweet.name} (@${tweet.username})
  Text: ${tweet.text}`;
        };
        const currentPost = formatTweet(tweet);

        elizaLogger.debug("Thread: ", thread);
        const formattedConversation = thread
            .map(
                (tweet) => `@${tweet.username} (${new Date(
                    tweet.timestamp * 1000
                ).toLocaleString("en-US", {
                    hour: "2-digit",
                    minute: "2-digit",
                    month: "short",
                    day: "numeric",
                })}):
        ${tweet.text}`
            )
            .join("\n\n");

        elizaLogger.debug("formattedConversation: ", formattedConversation);

        let state = await this.runtime.composeState(message, {
            twitterClient: this.client.twitterClient,
            twitterUserName: this.runtime.getSetting("TWITTER_USERNAME"),
            currentPost,
            formattedConversation,
        });

        // check if the tweet exists, save if it doesn't
        const tweetId = stringToUuid(tweet.id + "-" + this.runtime.agentId);
        const tweetExists =
            await this.runtime.messageManager.getMemoryById(tweetId);

        if (!tweetExists) {
            elizaLogger.log("tweet does not exist, saving");
            const userIdUUID = stringToUuid(tweet.userId as string);
            const roomId = stringToUuid(tweet.conversationId);

            const message = {
                id: tweetId,
                agentId: this.runtime.agentId,
                content: {
                    text: tweet.text,
                    url: tweet.permanentUrl,
                    inReplyTo: tweet.inReplyToStatusId
                        ? stringToUuid(
                              tweet.inReplyToStatusId +
                                  "-" +
                                  this.runtime.agentId
                          )
                        : undefined,
                },
                userId: userIdUUID,
                roomId,
                createdAt: tweet.timestamp * 1000,
            };
            this.client.saveRequestMessage(message, state);
        }

        // 1. Get the raw target users string from settings
        const targetUsersStr = this.runtime.getSetting("TWITTER_TARGET_USERS");

        // 2. Process the string to get valid usernames
        const validTargetUsersStr =
            targetUsersStr && targetUsersStr.trim()
                ? targetUsersStr
                      .split(",") // Split by commas: "user1,user2" -> ["user1", "user2"]
                      .map((u) => u.trim()) // Remove whitespace: [" user1 ", "user2 "] -> ["user1", "user2"]
                      .filter((u) => u.length > 0)
                      .join(",")
                : "";

        const shouldRespondContext = composeContext({
            state,
            template:
                this.runtime.character.templates?.twitterShouldRespondTemplate?.(
                    validTargetUsersStr
                ) ||
                this.runtime.character?.templates?.shouldRespondTemplate ||
                twitterShouldRespondTemplate(validTargetUsersStr),
        });

        const shouldRespond = await generateShouldRespond({
            runtime: this.runtime,
            context: shouldRespondContext,
            modelClass: ModelClass.MEDIUM,
        });

        // Promise<"RESPOND" | "IGNORE" | "STOP" | null> {
        if (shouldRespond !== "RESPOND") {
            elizaLogger.log("Not responding to message");
            return { text: "Response Decision:", action: shouldRespond };
        }

        const sqlQueryContext = composeContext({
            state,
            template: `
            Recent interactions between {{agentName}} and other users:
            {{recentPostInteractions}}

            {{recentPosts}}

            Current Post:
            {{currentPost}}

            Thread of Tweets You Are Replying To:
            {{formattedConversation}}

            # Task: Using the following table schema, generate ONLY a SQL query. Nothing else. Do not give any additional information. Your output should only be a SQL query for snowflake. while using the thread of tweets as additional context:

    Always use LOWER(TOKEN_NAME) in the WHERE clause.
    </instructions>
        <table_schema>
        create or replace TABLE TOKENMETRICS_DEV.ANALYTICS.CRYPTO_INFO_HUB_CURRENT_VIEW (
            DATE DATE 'YYYY-MM-DD',
            TOKEN_NAME VARCHAR,
            TOKEN_SYMBOL VARCHAR,
            SUMMARY VARCHAR - 'Brief description of the token including its primary use case and features',
            TOKEN_URL VARCHAR 'URL to the token details page on Token Metrics',
            PLATFORMS OBJECT 'JSON object listing blockchains on which the token is supported, with corresponding contract addresses' - {{"avalanche": "0x596fa47043f99", "energi": "0x591c19dc0"}}
            "TM_TRADER_GRADE": "TM_TRADER_GRADE FLOAT 'TM Trader Grade (%) our proprietary main grade for short term traders, The higher the more bullish, the lower the more bearish. At 50, we are uncertain about the future price moves. It uses both TA and Quant Grades'",
            "TM_TRADER_GRADE_24H_PCT_CHANGE": "TM_TRADER_GRADE_24H_PCT_CHANGE FLOAT",
            "TA_GRADE": "TA_GRADE FLOAT 'Technical Analysis Grade (%) higher means more bullish, lower means more bearish. Around 50 is neutral. It reflects price momentum'",
            "TA_GRADE_24H_PCT_CHANGE": "TA_GRADE_24H_PCT_CHANGE FLOAT",
            "QUANT_GRADE": "QUANT_GRADE FLOAT 'Quantitative Grade (%) higher means less risky, lower means more risky. Around 50 is neutral. It reflects risk and volatility'",
            "QUANT_GRADE_24H_PCT_CHANGE": "QUANT_GRADE_24H_PCT_CHANGE FLOAT",
            "TM_INVESTOR_GRADE": "TM_INVESTOR_GRADE FLOAT 'TM Investor Grade (0-100) our proprietary main grade for long term investors. The higher the grade, the more 100x potential in long term. The lower, the less long term potential. It uses fundamental, technology, and valuation grades. High fundamentals, high technology, and undervalued tokens get higher values'",
            "TM_INVESTOR_GRADE_7D_PCT_CHANGE": "TM_INVESTOR_GRADE_7D_PCT_CHANGE FLOAT",
            "FUNDAMENTAL_GRADE": "FUNDAMENTAL_GRADE FLOAT 'Fundamental Grade (%) higher means better fundamentals, tokenomics, team, and adoption'",
            "FUNDAMENTAL_GRADE_7D_PCT_CHANGE": "FUNDAMENTAL_GRADE_7D_PCT_CHANGE FLOAT",
            "TECHNOLOGY_GRADE": "TECHNOLOGY_GRADE FLOAT 'Technology Grade (%) higher means better technology, security and robustness'",
            "TECHNOLOGY_GRADE_7D_PCT_CHANGE": "TECHNOLOGY_GRADE_7D_PCT_CHANGE FLOAT",
            "VALUATION_GRADE": "VALUATION_GRADE FLOAT 'A higher Valuation Grade (%) means undervalued, low valuation grade means overvalued. Based on similar tokens and age of token'",
            "VALUATION_GRADE_7D_PCT_CHANGE": "VALUATION_GRADE_7D_PCT_CHANGE FLOAT",
            "DEFI_USAGE_SCORE": "DEFI_USAGE_SCORE FLOAT 'DeFi activity (1-10)",
            "COMMUNITY_SCORE": "COMMUNITY_SCORE FLOAT 'Community (1-10)'",
            "EXCHANGE_SCORE": "EXCHANGE_SCORE FLOAT 'Exchange Listings (1-10)'",
            "VC_SCORE": "VC_SCORE FLOAT 'Fundraising support (1-10)'",
            "TOKENOMICS_SCORE": "TOKENOMICS_SCORE FLOAT 'Tokenomics quality (1-10)'",
            "DEFI_SCANNER_SCORE": "DEFI_SCANNER_SCORE FLOAT 'Overall score from DeFi Scanner, for fundamentals and technology (1-10)'",
            "ACTIVITY_SCORE": "ACTIVITY_SCORE FLOAT 'Github Activity and progress score (1-10)'",
            "REPOSITORY_SCORE": "REPOSITORY_SCORE FLOAT 'Github repo popularity score (1-10)'",
            "COLLABORATION_SCORE": "COLLABORATION_SCORE FLOAT 'Github Collaboration and involvement score (1-10)'",
            VALUATION_METRICS OBJECT 'JSON object containing the fully diluted valuation (FDV) of the token, median FDV by category, and age of the token in days' - {{"category_fdv_median": {{"cryptocurrency": 6.2e+07, "meme": 1.3e+09}}, "fdv": 1.3e+12, "project_age": 227}},
            MAX_DRAWDOWN FLOAT,
            SORTINO FLOAT 'Sortino Ratio',
            TVL FLOAT 'Total Value Locked',
            TRADING_SIGNAL NUMBER 'Current Trading Signal (1: bullish now, -1: bearish now, 0: no signal now) Do not order by',
            TRADER_GRADE_SIGNAL VARCHAR 'Current Signal based on trader grade (strong buy, buy, neutral, sell, strong sell) Do not order by',
            TOKEN_TREND NUMBER 'Trend (1: bullish trend, -1: bearish trend) Do not order by. Bullish trend is a must for a good trade, otherwise it is risky and not recommended',
            VOLUME_24h FLOAT,
            MARKET_CAP FLOAT 'Market cap in USD. Higher means more.',
            MARKET_CAP_RANK INT,
            CIRCULATING_SUPPLY INT,
            TOTAL_SUPPLY INT'
            MAX_SUPPLY INT,
            FULLY_DILUTED_VALUATION FLOAT 'Low FDV is good for long term investment - means more room to grow',
            HIGH_24H FLOAT,
            SCENARIO_PREDICTION OBJECT 'JSON object containing the scenario prediction for the token' - {{"scenario": "bullish", "probability": 0.7}},
            LOW_24H FLOAT,
            ALL_TIME_HIGH OBJECT '{{"ath": 4878.2, "ath_change_percentage": -28, "ath_date": "2021-11-10"}}',
            ALL_TIME_LOW OBJECT '{{"atl": 0.4, "atl_change_percentage": 8.06e+05, "atl_date": "2015-10-20"}}',
            PRICE_CHANGE_PERCENTAGE OBJECT '1h/24h/7d/30d/200d/1y/all_time' percent change. Use 24h change as default unless specified.' - {{"1h": -0.27, "200d": 9.6, "all_time": 1.1e+02,"1y": 651.1, "24h": -8.44, "30d": 64.11, "7d": -6.23}}
        );
        </table_schema>
        A few examples are as below:
        <example>
        Question: Top 3 coins with more than $1M 24h trading volume based on Trader Grade, sort by descending 24h change in Trader Grade?
        Output: WITH VOLUME AS (SELECT TOKEN_NAME, TOKEN_SYMBOL, TOKEN_URL, MARKET_CAP, FULLY_DILUTED_VALUATION, CURRENT_PRICE, TM_TRADER_GRADE, TM_TRADER_GRADE_24H_PCT_CHANGE FROM TOKENMETRICS_DEV.ANALYTICS.CRYPTO_INFO_HUB_CURRENT_VIEW WHERE VOLUME_24H > 1000000 ORDER BY TM_TRADER_GRADE DESC NULLS LAST LIMIT 3) SELECT * FROM VOLUME ORDER BY TM_TRADER_GRADE_24H_PCT_CHANGE DESC NULLS LAST;
                </example>
        <example>
        Question: Give me the top 3 layer one coins according to their price
        Output: SELECT TOKEN_NAME, TOKEN_SYMBOL, TOKEN_URL,  MARKET_CAP, FULLY_DILUTED_VALUATION, CURRENT_PRICE, SUMMARY
                    FROM TOKENMETRICS_DEV.ANALYTICS.CRYPTO_INFO_HUB_CURRENT_VIEW
                    WHERE LOWER(CATEGORY_LIST::string) LIKE '%layer%1%' AND CURRENT_PRICE IS NOT NULL
                    ORDER BY CURRENT_PRICE DESC NULLS LAST
                    LIMIT 3;
                </example>
        <example>
        Question: What token should I buy?
        Output: SELECT TOKEN_NAME, TOKEN_SYMBOL, TOKEN_URL, MARKET_CAP, FULLY_DILUTED_VALUATION, CURRENT_PRICE, TM_TRADER_GRADE, TA_GRADE, QUANT_GRADE
                    FROM TOKENMETRICS_DEV.ANALYTICS.CRYPTO_INFO_HUB_CURRENT_VIEW
                    ORDER BY TM_TRADER_GRADE DESC NULLS LAST, VOLUME_24H DESC NULLS LAST
                    LIMIT 1;
        </example>
        <example>
        Question: What is the next 100x token?
        Output: SELECT TOKEN_NAME, TOKEN_SYMBOL, TOKEN_URL, MARKET_CAP, FULLY_DILUTED_VALUATION, CURRENT_PRICE, TM_INVESTOR_GRADE, VALUATION_METRICS, FUNDAMENTAL_GRADE, TECHNOLOGY_GRADE, VALUATION_GRADE, SUMMARY
                    FROM TOKENMETRICS_DEV.ANALYTICS.CRYPTO_INFO_HUB_CURRENT_VIEW
                    ORDER BY TM_INVESTOR_GRADE DESC NULLS LAST, VOLUME_24H DESC NULLS LAST
                    LIMIT 1;
        </example>

        <rules>
        To generate the correct Snowflake SQL query, you must follow the rules below:
        Rules:
        - Use both the user question and conversation history to create a SQL query.
        - Always use token name as default field to select a token by. SELECT * FROM TABLE WHERE TOKEN_NAME=LOWER('Bitcoin')
        - Use the table name without any curly brackets or anything else.
        - If user asks for a single token, then only return a single token. If the user asks for a list of tokens, then limit your results to 10.
        - Always use NULLS LAST in ORDER BY.
        - Default ORDER BY is VOLUME_24H DESC.
        - Always include columns used in ORDER BY in the SELECT result.
        - Use the token name from the conversation history if not specified in the question.
        - Treat the token name as only the text before the parentheses in markdown links. For instance, in [QuantixAI (QAI)](https://app.tokenmetrics.com/quantixai), treat "QuantixAI" as the token name.
        - Exclude token price from buying decisions.
        - Access items in OBJECT data types with COLUMN_NAME['key'].
        - For columns with OBJECT datatype, to ensure that the null values inside the JSON structure are removed, always use "STRIP_NULL_VALUE(column_name['key'])" when using ORDER BY, WHERE, or SELECT etc.
        - Always provide name, symbol, TOKEN_URL, MARKET_CAP, FULLY_DILUTED_VALUATION, and CURRENT_PRICE of tokens in the query.
        - Always provide the SUMMARY if only one coin is queried in the SQL query, and if the conversation history does not include a summary or description of the token already.
        - Given a primary grade such as 'TM_TRADER_GRADE', automatically select its contributory metrics, such as 'TA_GRADE' and 'QUANT_GRADE'. Apply this behavior consistently for other primary grades by identifying and selecting their respective contributory metrics.
        - For 100x token, also give the VALUATION_METRICS.
        - ALways search the Snowflake table with lower case for all string values such as TOKEN_NAME, TOKEN_SYMBOL, JSON column key's etc. For example, SELECT * FROM TOKENMETRICS_DEV.ANALYTICS.CRYPTO_INFO_HUB_CURRENT_VIEW WHERE LOWER(TOKEN_NAME)= LOWER('QuantixAI').
        - If user question or conversation history has refers to the token in all capital letters, then use TOKEN_SYMBOL in SELECT.
        - Only return the SQL query, no extra text or headers or commas or any other formatting including back ticks or any other characters.
        </rules>
            `,
        });

        const generatedSqlQuery = await generateText({
            runtime: this.runtime,
            context: sqlQueryContext,
            modelClass: ModelClass.LARGE
        });

        const data = await this.snowflakeService.query(generatedSqlQuery);

        const context = composeContext({
            state,
            template: twitterMessageHandlerTemplate(data)
        });

        elizaLogger.debug("Interactions prompt:\n" + context);

        const response = await generateMessageResponse({
            runtime: this.runtime,
            context,
            modelClass: ModelClass.LARGE,
        });

        const removeQuotes = (str: string) =>
            str.replace(/^['"](.*)['"]$/, "$1");

        const stringId = stringToUuid(tweet.id + "-" + this.runtime.agentId);

        response.inReplyTo = stringId;

        response.text = removeQuotes(response.text);

        if (response.text) {
            try {
                const callback: HandlerCallback = async (response: Content) => {
                    const memories = await sendTweet(
                        this.client,
                        response,
                        message.roomId,
                        this.runtime.getSetting("TWITTER_USERNAME"),
                        tweet.id
                    );
                    return memories;
                };

                const responseMessages = await callback(response);

                state = (await this.runtime.updateRecentMessageState(
                    state
                )) as State;

                for (const responseMessage of responseMessages) {
                    if (
                        responseMessage ===
                        responseMessages[responseMessages.length - 1]
                    ) {
                        responseMessage.content.action = response.action;
                    } else {
                        responseMessage.content.action = "CONTINUE";
                    }
                    await this.runtime.messageManager.createMemory(
                        responseMessage
                    );
                }

                await this.runtime.processActions(
                    message,
                    responseMessages,
                    state,
                    callback
                );

                const responseInfo = `Context:\n\n${context}\n\nSelected Post: ${tweet.id} - ${tweet.username}: ${tweet.text}\nAgent's Output:\n${response.text}`;

                await this.runtime.cacheManager.set(
                    `twitter/tweet_generation_${tweet.id}.txt`,
                    responseInfo
                );
                await wait();
            } catch (error) {
                elizaLogger.error(`Error sending response tweet: ${error}`);
            }
        }
    }

    async buildConversationThread(
        tweet: Tweet,
        maxReplies: number = 10
    ): Promise<Tweet[]> {
        const thread: Tweet[] = [];
        const visited: Set<string> = new Set();

        async function processThread(currentTweet: Tweet, depth: number = 0) {
            elizaLogger.log("Processing tweet:", {
                id: currentTweet.id,
                inReplyToStatusId: currentTweet.inReplyToStatusId,
                depth: depth,
            });

            if (!currentTweet) {
                elizaLogger.log("No current tweet found for thread building");
                return;
            }

            if (depth >= maxReplies) {
                elizaLogger.log("Reached maximum reply depth", depth);
                return;
            }

            // Handle memory storage
            const memory = await this.runtime.messageManager.getMemoryById(
                stringToUuid(currentTweet.id + "-" + this.runtime.agentId)
            );
            if (!memory) {
                const roomId = stringToUuid(
                    currentTweet.conversationId + "-" + this.runtime.agentId
                );
                const userId = stringToUuid(currentTweet.userId);

                await this.runtime.ensureConnection(
                    userId,
                    roomId,
                    currentTweet.username,
                    currentTweet.name,
                    "twitter"
                );

                this.runtime.messageManager.createMemory({
                    id: stringToUuid(
                        currentTweet.id + "-" + this.runtime.agentId
                    ),
                    agentId: this.runtime.agentId,
                    content: {
                        text: currentTweet.text,
                        source: "twitter",
                        url: currentTweet.permanentUrl,
                        inReplyTo: currentTweet.inReplyToStatusId
                            ? stringToUuid(
                                  currentTweet.inReplyToStatusId +
                                      "-" +
                                      this.runtime.agentId
                              )
                            : undefined,
                    },
                    createdAt: currentTweet.timestamp * 1000,
                    roomId,
                    userId:
                        currentTweet.userId === this.twitterUserId
                            ? this.runtime.agentId
                            : stringToUuid(currentTweet.userId),
                    embedding: getEmbeddingZeroVector(),
                });
            }

            if (visited.has(currentTweet.id)) {
                elizaLogger.log("Already visited tweet:", currentTweet.id);
                return;
            }

            visited.add(currentTweet.id);
            thread.unshift(currentTweet);

            elizaLogger.debug("Current thread state:", {
                length: thread.length,
                currentDepth: depth,
                tweetId: currentTweet.id,
            });

            if (currentTweet.inReplyToStatusId) {
                elizaLogger.log(
                    "Fetching parent tweet:",
                    currentTweet.inReplyToStatusId
                );
                try {
                    const parentTweet = await this.twitterClient.getTweet(
                        currentTweet.inReplyToStatusId
                    );

                    if (parentTweet) {
                        elizaLogger.log("Found parent tweet:", {
                            id: parentTweet.id,
                            text: parentTweet.text?.slice(0, 50),
                        });
                        await processThread(parentTweet, depth + 1);
                    } else {
                        elizaLogger.log(
                            "No parent tweet found for:",
                            currentTweet.inReplyToStatusId
                        );
                    }
                } catch (error) {
                    elizaLogger.log("Error fetching parent tweet:", {
                        tweetId: currentTweet.inReplyToStatusId,
                        error,
                    });
                }
            } else {
                elizaLogger.log(
                    "Reached end of reply chain at:",
                    currentTweet.id
                );
            }
        }

        // Need to bind this context for the inner function
        await processThread.bind(this)(tweet, 0);

        elizaLogger.debug("Final thread built:", {
            totalTweets: thread.length,
            tweetIds: thread.map((t) => ({
                id: t.id,
                text: t.text?.slice(0, 50),
            })),
        });

        return thread;
    }
}
