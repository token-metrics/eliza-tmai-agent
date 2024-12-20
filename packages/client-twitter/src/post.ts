import { Tweet } from "agent-twitter-client";
import {
    composeContext,
    generateText,
    getEmbeddingZeroVector,
    IAgentRuntime,
    ModelClass,
    stringToUuid,
    parseBooleanFromText,
} from "@ai16z/eliza";
import { elizaLogger } from "@ai16z/eliza";
import { ClientBase } from "./base.ts";
import { postActionResponseFooter } from "@ai16z/eliza";
import { generateTweetActions } from "@ai16z/eliza";
import { IImageDescriptionService, ServiceType } from "@ai16z/eliza";
import { buildConversationThread } from "./utils.ts";
import { twitterMessageHandlerTemplate } from "./interactions.ts";
import { SnowflakeService, SnowflakeConfig } from "./services/snowflakeService";
import { DataAnalysisService, TokenMetrics } from "./services/dataAnalysisService";

const twitterPostTemplate = `
# Areas of Expertise
{{knowledge}}

# About {{agentName}} (@{{twitterUserName}}):
{{bio}}
{{lore}}
{{topics}}

{{providers}}

{{characterPostExamples}}

{{postDirections}}

# Task: Generate a post in the voice and style and perspective of {{agentName}} @{{twitterUserName}}.
Write a 1-3 sentence post that is {{adjective}} about {{topic}} (without mentioning {{topic}} directly), from the perspective of {{agentName}}. Do not add commentary or acknowledge this request, just write the post.
Your response should not contain any questions. Brief, concise statements only. The total character count MUST be less than {{maxTweetLength}}. No emojis. Use \\n\\n (double spaces) between statements.`;

export const twitterActionTemplate = `
# INSTRUCTIONS: Determine actions for {{agentName}} (@{{twitterUserName}}) based on:
{{bio}}
{{postDirections}}

Guidelines:
- Highly selective engagement
- Direct mentions are priority
- Skip: low-effort content, off-topic, repetitive

Actions (respond only with tags):
[LIKE] - Resonates with interests (9.5/10)
[RETWEET] - Perfect character alignment (9/10)
[QUOTE] - Can add unique value (8/10)
[REPLY] - Memetic opportunity (9/10)

Tweet:
{{currentTweet}}

# Respond with qualifying action tags only.`
    + postActionResponseFooter;

const MAX_TWEET_LENGTH = 240;

/**
 * Truncate text to fit within the Twitter character limit, ensuring it ends at a complete sentence.
 */
function truncateToCompleteSentence(
    text: string,
    maxTweetLength: number
): string {
    if (text.length <= maxTweetLength) {
        return text;
    }

    // Attempt to truncate at the last period within the limit
    const truncatedAtPeriod = text.slice(
        0,
        text.lastIndexOf(".", maxTweetLength) + 1
    );
    if (truncatedAtPeriod.trim().length > 0) {
        return truncatedAtPeriod.trim();
    }

    // If no period is found, truncate to the nearest whitespace
    const truncatedAtSpace = text.slice(
        0,
        text.lastIndexOf(" ", maxTweetLength)
    );
    if (truncatedAtSpace.trim().length > 0) {
        return truncatedAtSpace.trim() + "...";
    }

    // Fallback: Hard truncate and add ellipsis
    return text.slice(0, maxTweetLength - 3).trim() + "...";
}


export class TwitterPostClient {
    client: ClientBase;
    runtime: IAgentRuntime;
    twitterUsername: string;
    private isProcessing: boolean = false;
    private lastProcessTime: number = 0;
    private stopProcessingActions: boolean = false;
    private snowflakeService: SnowflakeService;
    private dataAnalysisService: DataAnalysisService;


    async start(postImmediately: boolean = false) {
        if (!this.client.profile) {
            await this.client.init();
        }

        const generateNewTweetLoop = async () => {
            const lastPost = await this.runtime.cacheManager.get<{
                timestamp: number;
            }>(
                "twitter/" +
                    this.twitterUsername +
                    "/lastPost"
            );

            const lastPostTimestamp = lastPost?.timestamp ?? 0;
            const minMinutes =
                parseInt(this.runtime.getSetting("POST_INTERVAL_MIN")) || 90;
            const maxMinutes =
                parseInt(this.runtime.getSetting("POST_INTERVAL_MAX")) || 180;
            const randomMinutes =
                Math.floor(Math.random() * (maxMinutes - minMinutes + 1)) +
                minMinutes;
            const delay = randomMinutes * 60 * 1000;

            if (Date.now() > lastPostTimestamp + delay) {
                await this.generateNewTweet();
            }

            setTimeout(() => {
                generateNewTweetLoop(); // Set up next iteration
            }, delay);

            elizaLogger.log(`Next tweet scheduled in ${randomMinutes} minutes`);
        };

        const processActionsLoop = async () => {
            const actionInterval = parseInt(
                this.runtime.getSetting("ACTION_INTERVAL")
            ) || 300000; // Default to 5 minutes

            while (!this.stopProcessingActions) {
                try {
                    const results = await this.processTweetActions();
                    if (results) {
                        elizaLogger.log(`Processed ${results.length} tweets`);
                        elizaLogger.log(`Next action processing scheduled in ${actionInterval / 1000} seconds`);
                        // Wait for the full interval before next processing
                        await new Promise(resolve => setTimeout(resolve, actionInterval));
                    }
                } catch (error) {
                    elizaLogger.error("Error in action processing loop:", error);
                    // Add exponential backoff on error
                    await new Promise(resolve => setTimeout(resolve, 30000)); // Wait 30s on error
                }
            }
        };

        if (
            this.runtime.getSetting("POST_IMMEDIATELY") != null &&
            this.runtime.getSetting("POST_IMMEDIATELY") != ""
        ) {
            postImmediately = parseBooleanFromText(
                this.runtime.getSetting("POST_IMMEDIATELY")
            );
        }

        if (postImmediately) {
            await this.generateNewTweet();
        }
        generateNewTweetLoop();

        // Add check for ENABLE_ACTION_PROCESSING before starting the loop
        const enableActionProcessing = parseBooleanFromText(
            this.runtime.getSetting("ENABLE_ACTION_PROCESSING") ?? "true"
        );

        if (enableActionProcessing) {
            processActionsLoop().catch(error => {
                elizaLogger.error("Fatal error in process actions loop:", error);
            });
        } else {
            elizaLogger.log("Action processing loop disabled by configuration");
        }
        generateNewTweetLoop();
    }

    constructor(client: ClientBase, runtime: IAgentRuntime) {
        this.client = client;
        this.runtime = runtime;
        this.twitterUsername = runtime.getSetting("TWITTER_USERNAME");

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
        this.dataAnalysisService = new DataAnalysisService();
    }

    private async generateNewTweet() {
        elizaLogger.log("Generating new tweet");

        try {
            // Generate data-driven content
            const newTweetContent = await this.generateDataDrivenTweet();

            // First attempt to clean content
            let cleanedContent = '';

            // Try parsing as JSON first
            try {
                const parsedResponse = JSON.parse(newTweetContent);
                if (parsedResponse.text) {
                    cleanedContent = parsedResponse.text;
                } else if (typeof parsedResponse === 'string') {
                    cleanedContent = parsedResponse;
                }
            } catch (error) {
                error.linted = true; // make linter happy since catch needs a variable
                // If not JSON, clean the raw content
                cleanedContent = newTweetContent
                    .replace(/^\s*{?\s*"text":\s*"|"\s*}?\s*$/g, '') // Remove JSON-like wrapper
                    .replace(/^['"](.*)['"]$/g, '$1')  // Remove quotes
                    .replace(/\\"/g, '"')  // Unescape quotes
                    .replace(/\\n/g, '\n') // Unescape newlines
                    .trim();
            }

            if (!cleanedContent) {
                elizaLogger.error('Failed to extract valid content from response:', {
                    rawResponse: newTweetContent,
                    attempted: 'JSON parsing'
                });
                return;
            }

            // Use the helper function to truncate to complete sentence
            const content = truncateToCompleteSentence(cleanedContent, MAX_TWEET_LENGTH);

            const removeQuotes = (str: string) =>
                str.replace(/^['"](.*)['"]$/, "$1");

            const fixNewLines = (str: string) =>
                str.replaceAll(/\\n/g, "\n");

            // Final cleaning
            cleanedContent = removeQuotes(fixNewLines(content));

            if (this.runtime.getSetting("TWITTER_DRY_RUN") === "true") {
                elizaLogger.info(
                    `Dry run: would have posted tweet: ${cleanedContent}`
                );
                return;
            }

            try {
                elizaLogger.log(`Posting new tweet:\n ${cleanedContent}`);

                const result = await this.client.requestQueue.add(
                    async () =>
                        await this.client.twitterClient.sendTweet(cleanedContent)
                );
                const body = await result.json();
                if (!body?.data?.create_tweet?.tweet_results?.result) {
                    console.error("Error sending tweet; Bad response:", body);
                    return;
                }
                const tweetResult = body.data.create_tweet.tweet_results.result;

                const tweet = {
                    id: tweetResult.rest_id,
                    name: this.client.profile.screenName,
                    username: this.client.profile.username,
                    text: tweetResult.legacy.full_text,
                    conversationId: tweetResult.legacy.conversation_id_str,
                    createdAt: tweetResult.legacy.created_at,
                    timestamp: new Date(
                        tweetResult.legacy.created_at
                    ).getTime(),
                    userId: this.client.profile.id,
                    inReplyToStatusId:
                        tweetResult.legacy.in_reply_to_status_id_str,
                    permanentUrl: `https://twitter.com/${this.twitterUsername}/status/${tweetResult.rest_id}`,
                    hashtags: [],
                    mentions: [],
                    photos: [],
                    thread: [],
                    urls: [],
                    videos: [],
                } as Tweet;

                await this.runtime.cacheManager.set(
                    `twitter/${this.client.profile.username}/lastPost`,
                    {
                        id: tweet.id,
                        timestamp: Date.now(),
                    }
                );

                await this.client.cacheTweet(tweet);

                elizaLogger.log(`Tweet posted:\n ${tweet.permanentUrl}`);

                await this.runtime.ensureRoomExists(roomId);
                await this.runtime.ensureParticipantInRoom(
                    this.runtime.agentId,
                    roomId
                );

                await this.runtime.messageManager.createMemory({
                    id: stringToUuid(tweet.id + "-" + this.runtime.agentId),
                    userId: this.runtime.agentId,
                    agentId: this.runtime.agentId,
                    content: {
                        text: newTweetContent.trim(),
                        url: tweet.permanentUrl,
                        source: "twitter",
                    },
                    roomId,
                    embedding: getEmbeddingZeroVector(),
                    createdAt: tweet.timestamp,
                });
            } catch (error) {
                elizaLogger.error("Error sending tweet:", error);
            }
        } catch (error) {
            elizaLogger.error("Error generating new tweet:", error);
        }
    }

    private async generateTweetContent(tweetState: any, options?: {
        template?: string;
        context?: string;
    }): Promise<string> {
        const context = composeContext({
            state: tweetState,
            template: options?.template || this.runtime.character.templates?.twitterPostTemplate || twitterPostTemplate,
        });

        const response = await generateText({
            runtime: this.runtime,
            context: options?.context || context,
            modelClass: ModelClass.SMALL
        });
        console.log("generate tweet content response:\n" + response);

        // First clean up any markdown and newlines
        const cleanedResponse = response
            .replace(/```json\s*/g, '')  // Remove ```json
            .replace(/```\s*/g, '')      // Remove any remaining ```
            .replaceAll(/\\n/g, "\n")
            .trim();

        // Try to parse as JSON first
        try {
            const jsonResponse = JSON.parse(cleanedResponse);
            if (jsonResponse.text) {
                return this.trimTweetLength(jsonResponse.text);
            }
            if (typeof jsonResponse === 'object') {
                const possibleContent = jsonResponse.content || jsonResponse.message || jsonResponse.response;
                if (possibleContent) {
                    return this.trimTweetLength(possibleContent);
                }
            }
        } catch (error) {
            error.linted = true; // make linter happy since catch needs a variable

            // If JSON parsing fails, treat as plain text
            elizaLogger.debug('Response is not JSON, treating as plain text');
        }

        // If not JSON or no valid content found, clean the raw text
        return this.trimTweetLength(cleanedResponse);
    }

    // Helper method to ensure tweet length compliance
    private trimTweetLength(text: string, maxLength: number = 280): string {
        if (text.length <= maxLength) return text;

        // Try to cut at last sentence
        const lastSentence = text.slice(0, maxLength).lastIndexOf('.');
        if (lastSentence > 0) {
            return text.slice(0, lastSentence + 1).trim();
        }

        // Fallback to word boundary
        return text.slice(0, text.lastIndexOf(' ', maxLength - 3)).trim() + '...';
    }

    private async processTweetActions() {
        if (this.isProcessing) {
            elizaLogger.log('Already processing tweet actions, skipping');
            return null;
        }

        try {
            this.isProcessing = true;
            this.lastProcessTime = Date.now();

            elizaLogger.log("Processing tweet actions");

            await this.runtime.ensureUserExists(
                this.runtime.agentId,
                this.twitterUsername,
                this.runtime.character.name,
                "twitter"
            );

            const homeTimeline = await this.client.fetchTimelineForActions(15);
            const results = [];

            for (const tweet of homeTimeline) {
                try {
                    // Skip if we've already processed this tweet
                    const memory = await this.runtime.messageManager.getMemoryById(
                        stringToUuid(tweet.id + "-" + this.runtime.agentId)
                    );
                    if (memory) {
                        elizaLogger.log(`Already processed tweet ID: ${tweet.id}`);
                        continue;
                    }

                    const roomId = stringToUuid(
                        tweet.conversationId + "-" + this.runtime.agentId
                    );

                    const tweetState = await this.runtime.composeState(
                        {
                            userId: this.runtime.agentId,
                            roomId,
                            agentId: this.runtime.agentId,
                            content: { text: "", action: "" },
                        },
                        {
                            twitterUserName: this.twitterUsername,
                            currentTweet: `ID: ${tweet.id}\nFrom: ${tweet.name} (@${tweet.username})\nText: ${tweet.text}`,
                        }
                    );

                    const actionContext = composeContext({
                        state: tweetState,
                        template: this.runtime.character.templates?.twitterActionTemplate || twitterActionTemplate,
                    });

                    const actionResponse = await generateTweetActions({
                        runtime: this.runtime,
                        context: actionContext,
                        modelClass: ModelClass.SMALL,
                    });

                    if (!actionResponse) {
                        elizaLogger.log(`No valid actions generated for tweet ${tweet.id}`);
                        continue;
                    }

                    const executedActions: string[] = [];

                    // Execute actions
                    if (actionResponse.like) {
                        try {
                            await this.client.twitterClient.likeTweet(tweet.id);
                            executedActions.push('like');
                            elizaLogger.log(`Liked tweet ${tweet.id}`);
                        } catch (error) {
                            elizaLogger.error(`Error liking tweet ${tweet.id}:`, error);
                        }
                    }

                    if (actionResponse.retweet) {
                        try {
                            await this.client.twitterClient.retweet(tweet.id);
                            executedActions.push('retweet');
                            elizaLogger.log(`Retweeted tweet ${tweet.id}`);
                        } catch (error) {
                            elizaLogger.error(`Error retweeting tweet ${tweet.id}:`, error);
                        }
                    }

                    if (actionResponse.quote) {
                        try {
                            // Build conversation thread for context
                            const thread = await buildConversationThread(tweet, this.client);
                            const formattedConversation = thread
                                .map((t) => `@${t.username} (${new Date(t.timestamp * 1000).toLocaleString()}): ${t.text}`)
                                .join("\n\n");

                            // Generate image descriptions if present
                            const imageDescriptions = [];
                            if (tweet.photos?.length > 0) {
                                elizaLogger.log('Processing images in tweet for context');
                                for (const photo of tweet.photos) {
                                    const description = await this.runtime
                                        .getService<IImageDescriptionService>(ServiceType.IMAGE_DESCRIPTION)
                                        .describeImage(photo.url);
                                    imageDescriptions.push(description);
                                }
                            }

                            // Handle quoted tweet if present
                            let quotedContent = '';
                            if (tweet.quotedStatusId) {
                                try {
                                    const quotedTweet = await this.client.twitterClient.getTweet(tweet.quotedStatusId);
                                    if (quotedTweet) {
                                        quotedContent = `\nQuoted Tweet from @${quotedTweet.username}:\n${quotedTweet.text}`;
                                    }
                                } catch (error) {
                                    elizaLogger.error('Error fetching quoted tweet:', error);
                                }
                            }

                            // Compose rich state with all context
                            const enrichedState = await this.runtime.composeState(
                                {
                                    userId: this.runtime.agentId,
                                    roomId: stringToUuid(tweet.conversationId + "-" + this.runtime.agentId),
                                    agentId: this.runtime.agentId,
                                    content: { text: tweet.text, action: "QUOTE" }
                                },
                                {
                                    twitterUserName: this.twitterUsername,
                                    currentPost: `From @${tweet.username}: ${tweet.text}`,
                                    formattedConversation,
                                    imageContext: imageDescriptions.length > 0
                                        ? `\nImages in Tweet:\n${imageDescriptions.map((desc, i) => `Image ${i + 1}: ${desc}`).join('\n')}`
                                        : '',
                                    quotedContent,
                                }
                            );

                            const quoteContent = await this.generateTweetContent(enrichedState, {
                                template: this.runtime.character.templates?.twitterMessageHandlerTemplate || twitterMessageHandlerTemplate
                            });

                            if (!quoteContent) {
                                elizaLogger.error('Failed to generate valid quote tweet content');
                                return;
                            }

                            elizaLogger.log('Generated quote tweet content:', quoteContent);

                            // Send the tweet through request queue
                            const result = await this.client.requestQueue.add(
                                async () => await this.client.twitterClient.sendQuoteTweet(
                                    quoteContent,
                                    tweet.id
                                )
                            );

                            const body = await result.json();

                            if (body?.data?.create_tweet?.tweet_results?.result) {
                                elizaLogger.log('Successfully posted quote tweet');
                                executedActions.push('quote');

                                // Cache generation context for debugging
                                await this.runtime.cacheManager.set(
                                    `twitter/quote_generation_${tweet.id}.txt`,
                                    `Context:\n${enrichedState}\n\nGenerated Quote:\n${quoteContent}`
                                );
                            } else {
                                elizaLogger.error('Quote tweet creation failed:', body);
                            }
                        } catch (error) {
                            elizaLogger.error('Error in quote tweet generation:', error);
                        }
                    }

                    if (actionResponse.reply) {
                        try {
                            await this.handleTextOnlyReply(tweet, tweetState, executedActions);
                        } catch (error) {
                            elizaLogger.error(`Error replying to tweet ${tweet.id}:`, error);
                        }
                    }

                    // Add these checks before creating memory
                    await this.runtime.ensureRoomExists(roomId);
                    await this.runtime.ensureUserExists(
                        stringToUuid(tweet.userId),
                        tweet.username,
                        tweet.name,
                        "twitter"
                    );
                    await this.runtime.ensureParticipantInRoom(
                        this.runtime.agentId,
                        roomId
                    );

                    // Then create the memory
                    await this.runtime.messageManager.createMemory({
                        id: stringToUuid(tweet.id + "-" + this.runtime.agentId),
                        userId: stringToUuid(tweet.userId),
                        content: {
                            text: tweet.text,
                            url: tweet.permanentUrl,
                            source: "twitter",
                            action: executedActions.join(","),
                        },
                        agentId: this.runtime.agentId,
                        roomId,
                        embedding: getEmbeddingZeroVector(),
                        createdAt: tweet.timestamp * 1000,
                    });

                    results.push({
                        tweetId: tweet.id,
                        parsedActions: actionResponse,
                        executedActions
                    });

                } catch (error) {
                    elizaLogger.error(`Error processing tweet ${tweet.id}:`, error);
                    continue;
                }
            }

            return results; // Return results array to indicate completion

        } catch (error) {
            elizaLogger.error('Error in processTweetActions:', error);
            throw error;
        } finally {
            this.isProcessing = false;
        }
    }

    private async handleTextOnlyReply(tweet: Tweet, tweetState: any, executedActions: string[]) {
        try {
            // Build conversation thread for context
            const thread = await buildConversationThread(tweet, this.client);
            const formattedConversation = thread
                .map((t) => `@${t.username} (${new Date(t.timestamp * 1000).toLocaleString()}): ${t.text}`)
                .join("\n\n");

            // Generate image descriptions if present
            const imageDescriptions = [];
            if (tweet.photos?.length > 0) {
                elizaLogger.log('Processing images in tweet for context');
                for (const photo of tweet.photos) {
                    const description = await this.runtime
                        .getService<IImageDescriptionService>(ServiceType.IMAGE_DESCRIPTION)
                        .describeImage(photo.url);
                    imageDescriptions.push(description);
                }
            }

            // Handle quoted tweet if present
            let quotedContent = '';
            if (tweet.quotedStatusId) {
                try {
                    const quotedTweet = await this.client.twitterClient.getTweet(tweet.quotedStatusId);
                    if (quotedTweet) {
                        quotedContent = `\nQuoted Tweet from @${quotedTweet.username}:\n${quotedTweet.text}`;
                    }
                } catch (error) {
                    elizaLogger.error('Error fetching quoted tweet:', error);
                }
            }

            // Compose rich state with all context
            const enrichedState = await this.runtime.composeState(
                {
                    userId: this.runtime.agentId,
                    roomId: stringToUuid(tweet.conversationId + "-" + this.runtime.agentId),
                    agentId: this.runtime.agentId,
                    content: { text: tweet.text, action: "" }
                },
                {
                    twitterUserName: this.twitterUsername,
                    currentPost: `From @${tweet.username}: ${tweet.text}`,
                    formattedConversation,
                    imageContext: imageDescriptions.length > 0
                        ? `\nImages in Tweet:\n${imageDescriptions.map((desc, i) => `Image ${i + 1}: ${desc}`).join('\n')}`
                        : '',
                    quotedContent,
                }
            );

            // Generate and clean the reply content
            const replyText = await this.generateTweetContent(enrichedState, {
                template: this.runtime.character.templates?.twitterMessageHandlerTemplate || twitterMessageHandlerTemplate
            });

            if (!replyText) {
                elizaLogger.error('Failed to generate valid reply content');
                return;
            }

            elizaLogger.debug('Final reply text to be sent:', replyText);

            // Send the tweet through request queue
            const result = await this.client.requestQueue.add(
                async () => await this.client.twitterClient.sendTweet(
                    replyText,
                    tweet.id
                )
            );

            const body = await result.json();

            if (body?.data?.create_tweet?.tweet_results?.result) {
                elizaLogger.log('Successfully posted reply tweet');
                executedActions.push('reply');

                // Cache generation context for debugging
                await this.runtime.cacheManager.set(
                    `twitter/reply_generation_${tweet.id}.txt`,
                    `Context:\n${enrichedState}\n\nGenerated Reply:\n${replyText}`
                );
            } else {
                elizaLogger.error('Tweet reply creation failed:', body);
            }
        } catch (error) {
            elizaLogger.error('Error in handleTextOnlyReply:', error);
        }
    }

    async stop() {
        this.stopProcessingActions = true;
    }

    private async generateDataDrivenTweet(): Promise<string> {
        try {
            // Fetch token metrics data
            const tokenData = await this.snowflakeService.getTokenMetrics();

            // Analyze the data
            // const analysis = this.dataAnalysisService.analyzeTokenData(tokenData);

            // Create a prompt for the LLM
            const prompt = `
            You are TM-AI-Agent, a crypto twitter bot which posts regular updates about crypto markets, news, analysis etc.
            Create a short tweet considering the data below:
            ${JSON.stringify(tokenData, null, 2)}

            ## Instructions
            Write in the style of a professional yet relatable Crypto Twitter insider with INTJ-level strategic depth. Posts should deliver actionable alpha for traders and investors, balancing short-term opportunities with long-term plays.
            Each tweet must:
            - Be Substantiated by Data: Include specific metrics, indicators, or evidence to support claims, such as TVL, growth rates, funding activity, or historical trends.
            - Demonstrate Strategic Depth: Go beyond surface-level takes to showcase second-level thinking, considering long-term narratives and broader market forces.
            - Provide Clear Calls to Action: Include actionable insights, such as specific tokens, projects, or frameworks for decision-making.
            - Avoid Hype: Stay grounded, avoiding over-reliance on speculative narratives or generic ideas without evidence.
            - Incorporate Personality: Maintain a confident, approachable tone that balances professional insight with engaging language—smart, direct, and relatable.
            - Every answer should provide clarity, depth, and tangible opportunities while maintaining relevance to market conditions.
            - Do not include hashtags at all, use cashtags for token names.
            - Always formulate the answer in less than 280 characters for twitter.
            Here are 10 examples of tweets:
            1. "ETH staking has grown to $42B TVL, but decentralization matters. Rocket Pool ($ROCKET) offers ~4.3% APY with less regulatory risk, while Obol is innovating distributed validator tech. Balance yields with resilience—don’t overconcentrate in Lido. :shield::gem:"
            2. "Bitcoin is at $100K, but miners are the lagging alpha. $RIOT and $MARA historically rally 2-3 weeks after BTC pumps. Key signal: BTC DEVuction costs (~$20K). Miners with high hashrate efficiency often double in these conditions. :hammer_and_pick::chart_with_upwards_trend:"
            3. "zkEVM is hyped, but dev infra is where value sticks. $SAFE secures 40% of DAO multi-sigs, and EigenLayer ($EIGEN) is redefining data availability with $50M backing. Builders need tools—follow the funding and activity metrics. :hammer_and_wrench::rocket:"
            4. "NFTs are evolving: utility > hype. Boson Protocol ($BOSON) is bridging Web3 and real-world brands, facilitating over $10M in marketplace transactions. $ETH and $AVAX are the tech backbones for enterprise adoption. The next wave isn’t PFPs—it’s utility. :brain::sparkles:"
            5. "DeFi is back, and real yield is the name of the game. $GMX generated $130M in fees this year, rewarding stakers sustainably. $GNS (copy trading) and $VELA (perps) are next-gen fee models to watch. Focus on protocols generating consistent revenue. :bank::moneybag:"
            6. "Solana ($SOL) is more than its token—its an ecosystem. $MANGO is leading DeFi with $25M+ daily volume, while $JUP drives liquidity with 200% user growth this quarter. Track TVL increases and active users for hidden Solana gems. :sunrise::fire:"
            7. "As regulators target $USDT and $USDC, decentralized stablecoins like $RAI and Frax ($FRAX) are gaining momentum. $RAI’s non-pegged model and $FRAX’s hybrid design offer censorship resistance and lower systemic risk. Hedge your portfolio early. :seedling::chains:"
            8. "AI x blockchain isnt just hype—its infrastructure. Akash ($AKT) processes 10K+ decentralized workloads daily, and Ocean Protocol ($OCEAN) leads data markets with $25M+ staked. Verified, decentralized compute is critical for scalable AI. :brain::robot_face:"
            9. "BTC dominance nearing 50% signals altcoin rotations. Historically, $DOT and $ATOM outperform in these cycles, with $ATOM up 60% post-dominance peaks. Key triggers: funding rate flips (negative to positive) and sentiment spikes. :mantelpiece_clock::gem:"
            10. "Bear markets are for positioning. Middleware projects like Axelar ($AXL) handle $2B+ in cross-chain liquidity, while EigenLayer ($EIGEN) is building the backbone for modular scaling. Execution > hype—invest in infrastructure while its undervalued. :tractor::package:"
            Why These Examples Work:
            - Substantiated by Data: Every example includes metrics, trends, or historical references to validate the insights (e.g., TVL, hashrate efficiency, transaction volumes).
            - Strategic Depth: Goes beyond the obvious, offering second-order thinking about ecosystems, infrastructure, and emerging narratives.
            - Actionable: Provides clear tokens, signals, or metrics to research and act upon.
            - Avoids Hype: Focuses on sustainable, data-backed trends rather than speculative narratives.
            - Engaging Tone: Smart, professional, but approachable and clear for traders and investors.
            Never select token names on your own.
            Only use the provided data.
            `;

            const roomId = stringToUuid(
                "twitter_generate_room-" + this.client.profile.username
            );

            const state = await this.runtime.composeState(
                {
                    userId: this.runtime.agentId,
                    roomId: roomId,
                    agentId: this.runtime.agentId,
                    content: {
                        text: prompt,
                        action: "TWEET",
                    },
                },
                {
                    twitterUserName: this.client.profile.username,
                }
            );

            // Generate tweet using LLM
            const context = composeContext({
                state
            });

            const generatedTweet = await generateText({
                runtime: this.runtime,
                context,
                modelClass: ModelClass.LARGE
            });

            // Clean up the generated tweet
            const cleanedTweet = generatedTweet
                .replace(/```json\s*|\s*```/g, '')  // Remove JSON markers
                .replace(/^['"](.*)['"]$/g, '$1')   // Remove quotes
                .replace(/\\n/g, '\n')              // Handle newlines
                .trim();

            elizaLogger.debug('Generated tweet:', cleanedTweet);

            return cleanedTweet;

        } catch (error) {
            elizaLogger.error('Error generating data-driven tweet:', error);
            throw error;
        }
    }
}
