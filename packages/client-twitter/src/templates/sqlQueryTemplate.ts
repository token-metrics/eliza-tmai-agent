export interface SQLQueryContext {
    question: string;
    conversation?: string;
}

export const generateSQLQueryTemplate = ({
    question,
    conversation,
}: SQLQueryContext) =>
    `
<instructions>Generate a standalone Snowflake SQL query, for the <user_question>user question</user_question> and <conversation_history>conversation history</conversation_history> provided.
    Use the following table schema</instructions>

        <table_schema>
        create or replace TABLE {table_name} (
                    DATE DATE 'YYYY-MM-DD',
                    TIMESTAMP 'TIMESTAMP_LTZ(9)' - 'Contains the timestamp of the data in UTC timezone',
                    TOKEN_ID NUMBER,
                    TOKEN_NAME VARCHAR,
                    TOKEN_SYMBOL VARCHAR,
                    IS_STABLECOIN BOOLEAN 0/1,
                    SUMMARY VARCHAR - 'Brief description of the token including its primary use case and features',
                    TOKEN_URL VARCHAR 'URL to the token details page on Token Metrics',
                    PLATFORMS OBJECT 'JSON object listing blockchains on which the token is supported, with corresponding contract addresses' - {{"avalanche": "0x596fa47043f99", "energi": "0x591c19dc0"}},
                    EXPLORER ARRAY 'Array of URLs for blockchain explorer applications where the token's transactions can be viewed' - ["https://etherscan.io/token/0x168296bb0","https://ethplorer.io/address/0x168296"],
                    TRADER_GRADE_SIGNAL VARCHAR 'Current Signal based on trader grade. Grade is based on 5 bins between 0-100 (strong buy, buy, neutral, sell, strong sell) Do not ORDER BY',
                    {f'{nl}'.join([f'{description}' for _, description in column_descriptions.items()])},
                    VALUATION_METRICS OBJECT 'JSON object containing the fully diluted valuation (FDV) of the token, median FDV by category, and age of the token in days' - {{"category_fdv_median": {{"cryptocurrency": 6.2e+07, "meme": 1.3e+09}}, "fdv": 1.3e+12, "project_age": 227}},
                    ALL_TIME_RETURN FLOAT,
                    MAX_DRAWDOWN FLOAT,
                    CAGR FLOAT 'Annual Growth Rate',
                    SHARPE FLOAT 'Sharpe Ratio',
                    SORTINO FLOAT 'Sortino Ratio',
                    VOLATILITY FLOAT,
                    SKEW FLOAT,
                    KURTOSIS FLOAT,
                    DAILY_VALUE_AT_RISK FLOAT,
                    EXPECTED_SHORTFALL_CVAR FLOAT,
                    PROFIT_FACTOR FLOAT,
                    TAIL_RATIO FLOAT,
                    DAILY_RETURN_AVG FLOAT,
                    DAILY_RETURN_STD FLOAT,
                    TVL FLOAT 'Total Value Locked',
                    TVL_PERCENT_CHANGE OBJECT '1d and 7d pct change for tvl (in %)' - {{"1d": -3.6, "7d": 5.9}}
                    TRADING_SIGNAL NUMBER 'Current Trading Signal (1: bullish now, -1: bearish now, 0: no signal now) Do not order by',
                    TOKEN_TREND NUMBER 'Trend (1: bullish trend, -1: bearish trend) Do not order by. Bullish trend is a must for a good trade, otherwise it is risky and not recommended',
                    TRADING_SIGNALS_RETURNS FLOAT 'returns of trading signals. Multiply by 100 to get percentage',
                    HOLDING_RETURNS FLOAT 'returns of holding token. Multiply by 100 to get percentage',
                    FORECASTS_FOR_NEXT_7_DAYS OBJECT '7d Price Forecasts and upper and lower range' - {{"1-day-forecast":{{"forecast" 3.7e+03,"forecast_lower":3.6e+03,"forecast_upper":3.78e+03}},...,"7-day-forecast":{{"forecast": 3.64e+03,"forecast_lower": 3.4e+03,"forecast_upper":3.8e+03}}}}
                    PREDICTED_RETURNS_7D FLOAT '7d price percent change Prediction',
                    HISTORICAL_RESISTANCE_SUPPORT_LEVELS OBJECT 'Historical Resistance and Support Levels with dates' - [{{"date": "2020-06-05", "level": 6.9e-01}}, {{"date": "2021-02-12", "level": 9.9e+00}}, {{"date": "2021-02-24", "level": 1.81}}],
                    CURRENT_RESISTANCE_LEVEL FLOAT,
                    CURRENT_SUPPORT_LEVEL FLOAT,
                    RISK_REWARD_RATIO FLOAT,
                    LIQUIDITY_ISSUES ARRAY 'List of liquidity issues' - [{{"description": "Most of the token's liquidity is not locked, facilitating a potential pulling of large % of funds from a liquidity pool.", "details": [{{"description": "100%", "title": "Unlocked Liquidity Percentage"}}], "title": "Rugpull Risk"}}],
                    HOLDER_ISSUES ARRAY 'List of issues related to token holders' - [{{"description": "A private wallet owns a significant percentage of this token's total supply.", "details": [{{"description": "41.04%", "title": "Top Holder Percentage"}}], "title": "Dump Risk"}}],
                    FUNDAMENTAL_ISSUES ARRAY 'List of fundamental issues' - [{{"description": "This contract can be upgraded, changing its functionality.", "details": [], "title": "Proxy Upgradeability"}}],
                    TECHNOLOGY_ISSUES ARRAY 'List of technology issues' - [{{"description": "Some functions in this contract may not appropriately check for zero addresses being used.", "details": [], "title": "Missing Zero Address Validation"}}],
                    HOLDER_METRICS OBJECT 'Top holders balance percentage and list of holders' - {{"topholders": [{{"address": "0x4da27a","balance": "2777464.5093994257","isContract": true,"percent": 17.15}},{{"address": "0xa700bc9","balance": "108879","isContract": true,"percent": 6.80}}],"topholderstotal": "872744","topholderstotalpercentage": 5.4e+01}},
                    CREATOR_METRICS OBJECT 'Creator, owner and initial metrics' - {{"createdbalancepercentage": 0,"creator": "0x51f22ac850d","creatorbalance": "0.0","firsttxdate": "2020-09-24 18:06:28","initialfunder": "0x3f5ce5fbf","initialfunding": 5,"ownerbalance": "nan"}},
                    LIQUIDITY_METRICS OBJECT 'JSON object detailing metrics related to token liquidity, including total supply, burned tokens, percentage of liquidity locked, and overall liquidity levels' - {{"burned": "0.0","burnedpercentage": 0,"isadequateliquiditypresent": true,"isenoughliquiditylocked": false,"tokentotalsupply": "16000000","totalburnedpercent": 0,"totalliquidity": 7.31e+05,"totallockedpercent": 9.0,"totalunlockedpercent": 90.9}}
                    LIQUIDITYPOOLS ARRAY 'List of liquidity pools' - [{{"address": "0xcf6daab95c476106eca715d48de4b13287ffdeaa","isAdequateLiquidityPresent": true,"isCreatorNotContainLiquidity": true,"isEnoughLiquidityLocked": false,"liquidity": "1514.15","liquidityDistribution": {{"burned": 0,"burnedPercentage": 0,"creator": 0,"creatorPercentage": 0,"locked": 8.6e+06,"lockedPercentage": 7.47e+01}},"liquidityUsd": "5487903.02", "name": "WETH/SHIB", "source": "Shibaswap", "swapFee": 0}}],
                    CURRENT_DOMINANCE FLOAT 'Market Share',
                    SCENARIO_ANALYSIS ARRAY 'price prediction for different scenario of dominance and crypto market cap' - [{{"crypto_market_cap_trillion": 5e-01, "price_prediction": 1.6e+01, "token_dominance": 1.4e-02}}, {{"crypto_market_cap_trillion": 5e-01, "price_prediction": 3.3e+01, "token_dominance": 2.9e-02}}],
                    TOP_CORRELATION ARRAY 'Top 10 / bottom 10 Correlations with other tokens' - [{{"correlation": 0.99, "token": "Marinade Staked Sol"}}, {{"correlation": 0.94, "token": "Jupiter"}}],
                    REDDIT_METRICS OBJECT 'Reddit Metrics' - {{"subreddit": "http://reddit.com/r/solana", "subscribers_count": 208378, "subscribers_count_7d_change": 123}},
                    TWITTER_METRICS OBJECT 'Twitter Metrics' - {{"followers_count": 2491337, "followers_count_7d_change": 12, "listed_count": 12136, "tweet_count": 7907, "tweet_count_7d_change": 12, "twitter_url": "twitter.com/solana", "verified": true, "following_count": 11}},
                    TELEGRAM_METRICS OBJECT 'Telegram Metrics' - {{"subscribers_count": 58860, "telegram_channel": "https://telegram.me/solana", "members_count_7d_change": 123}},
                    WEBSITE_METRICS OBJECT 'Website & SEO Metrics' - {{"ahrefs_rank": 1857, "domain_rating": 90, "org_keywords": 12523, "org_keywords_1_3": 998, "org_traffic": 297219, "org_traffic_7d_change": 4747, "org_traffic_7d_pct_change": 0.0162, "paid_keywords": 0, "paid_traffic": 0, "website": "https://ethereum.org/en/"}},
                    FUNDRAISING_METRICS OBJECT 'Last round info, total raised, list of investors/VC with data' - {{"last_round_date": "2021-06-09", "last_round_type": "Series A", "number_of_rounds": 3, "total_value_raised": 335, "unique_investors": [{{"investor_name": "Andreessen Horowitz (a16z crypto)", "investor_twitter": "https://twitter.com/a16zcrypto", "investor_website": "https://a16zcrypto.com/"}}]}},
                    DEFI_SCANNER_METRICS BOOLEAN 'All Defi Scanner metrics' - {{"defi_link": "https://de.fi/scanner/contract/0x7fc", "is_scam": false, "outdatedcompiler": false, "whitelisted": false}},
                    GITHUB_METRICS OBJECT 'Github Metrics' - {{ "closed_issues": 107327, "closed_issues_15d_change":12, "contributors": 7526, "contributors_15d_change":2, "github_url": "https://github.com/ethereum", "last_commit_date": "2024-03-15 00:09:07", "open_issues": 6207, "organization_name": "ethereum", "pull_requests": 1538, "pulls": 1538, "stars": 170058, "total_commits": 407318, "total_commits_15d_change":2, "total_forks": 76463, "total_issues": 113534, "watchers": 13501, "watchers_15d_change":2}},
                    EXCHANGE_LIST OBJECT 'Dictionary of all exchanges a token is listed on' - [{{"exchange_id": "binance","exchange_name": "Binance"}}, {{"exchange_id": "bybit_spot","exchange_name": "Bybit"}}, {{"exchange_id": "bitvenus_spot", "exchange_name": "BitVenus"}}],
                    CATEGORY_LIST OBJECT 'Dictionary of token categories' - [{{"category_id": 28, "category_name": "Smart Contract Platform", "category_slug": "smart-contract-platform"}}, {{"category_id": 143, "category_name": "Ethereum Ecosystem", "category_slug": "ethereum-ecosystem"}}],
                    CURRENT_PRICE FLOAT 'Do not use to determine if to buy a coin or not',
                    VOLUME_24h FLOAT,
                    MARKET_CAP FLOAT 'Market cap in USD. Higher means more.',
                    MARKET_CAP_RANK INT,
                    CIRCULATING_SUPPLY INT,
                    TOTAL_SUPPLY INT'
                    MAX_SUPPLY INT,
                    FULLY_DILUTED_VALUATION FLOAT 'Low FDV is good for long term investment - means more room to grow',
                    HIGH_24H FLOAT,
                    LOW_24H FLOAT,
                    ALL_TIME_HIGH OBJECT '{{"ath": 4878.2, "ath_change_percentage": -28, "ath_date": "2021-11-10"}}',
                    ALL_TIME_LOW OBJECT '{{"atl": 0.4, "atl_change_percentage": 8.06e+05, "atl_date": "2015-10-20"}}',
                    PRICE_CHANGE_PERCENTAGE OBJECT '1h/24h/7d/30d/200d/1y/all_time' percent change. Use 24h change as default unless specified.' - {{"1h": -0.27, "200d": 9.6, "all_time": 1.1e+02,"1y": 651.1, "24h": -8.44, "30d": 64.11, "7d": -6.23}}
        );
        </table_schema>

        A few examples are as below:

        <example>
        Question: Top 3 coins with more than $1M 24h trading volume based on Trader Grade, sort by descending 24h change in Trader Grade?
        Output: WITH VOLUME AS (SELECT TOKEN_NAME, TOKEN_SYMBOL, TOKEN_URL, MARKET_CAP, FULLY_DILUTED_VALUATION, CURRENT_PRICE, TM_TRADER_GRADE, TRADER_GRADE_SIGNAL, TM_TRADER_GRADE_CHANGE_PERCENTAGE_24H FROM {table_name} WHERE VOLUME_24H > 1000000 ORDER BY TM_TRADER_GRADE DESC NULLS LAST LIMIT 3) SELECT * FROM VOLUME ORDER BY TM_TRADER_GRADE_CHANGE_PERCENTAGE_24H DESC NULLS LAST;
        </example>

        <example>
        Question: Give me the top 3 layer one coins according to their price
        Output: SELECT TIMESTAMP, TOKEN_NAME, TOKEN_SYMBOL, TOKEN_URL,  MARKET_CAP, FULLY_DILUTED_VALUATION, CURRENT_PRICE, SUMMARY
                    FROM {table_name}
                    WHERE LOWER(CATEGORY_LIST::string) LIKE '%layer%1%' AND CURRENT_PRICE IS NOT NULL
                    ORDER BY CURRENT_PRICE DESC NULLS LAST
                    LIMIT 3;
        </example>

        <example>
        Question: What token should I buy?
        Thought: Token with highest TM Trader Grade
        Output: SELECT *
                    FROM TOKENMETRICS_DEV.ANALYTICS.CRYPTO_INFO_HUB_CURRENT_VIEW
                    ORDER BY TM_TRADER_GRADE DESC NULLS LAST, VOLUME_24H DESC NULLS LAST
                    LIMIT 1;
        </example>

        <example>
        Question: Tell me the tokens which are listed on binance exchange.
        Thought: Tokens with Binance in exchange list
        Output: SELECT * FROM TOKENMETRICS_DEV.ANALYTICS.CRYPTO_INFO_HUB_CURRENT_VIEW
                    LATERAL FLATTEN(input => exchange_list) f
                WHERE
                    f.value:exchange_id::STRING = 'binance'
                ORDER BY MARKET_CAP DESC
                NULLS LAST
                LIMIT 10;
        </example>

        <example>
        Question: What is the next 100x token?
        Thought: Token with highest TM Investor Grade
        Output: SELECT * FROM TOKENMETRICS_DEV.ANALYTICS.CRYPTO_INFO_HUB_CURRENT_VIEW
                    ORDER BY TM_INVESTOR_GRADE DESC NULLS LAST, VOLUME_24H DESC NULLS LAST
                    LIMIT 1;
        </example>

        <example>
        Question: What is the price prediction for bitcoin?
        Thought: Get price prediction for Bitcoin, use the SCENARIO_ANALYSIS column
        Output: SELECT SCENARIO_ANALYSIS FROM TOKENMETRICS_DEV.ANALYTICS.CRYPTO_INFO_HUB_CURRENT_VIEW
                    WHERE LOWER(TOKEN_NAME) = LOWER('Bitcoin')
                    LIMIT 1;
        </example>

        <example>
        Question: Give me data about DOGE
        Thought: Get data about the token with symbol DOGE
        Output: SELECT * FROM TOKENMETRICS_DEV.ANALYTICS.CRYPTO_INFO_HUB_CURRENT_VIEW
                  WHERE LOWER(TOKEN_SYMBOL) = LOWER('DOGE')
                  ORDER BY VOLUME_24H DESC NULLS LAST
                  LIMIT 1;
        </example>

        <example>
        Question: What is the price of Bitcoin?
        Thought: Get price for Bitcoin
        Output: SELECT * FROM TOKENMETRICS_DEV.ANALYTICS.CRYPTO_INFO_HUB_CURRENT_VIEW
                  WHERE LOWER(TOKEN_NAME) = LOWER('Bitcoin')
                  ORDER BY VOLUME_24H DESC NULLS LAST
                  LIMIT 1;
        </example>


        A few examples are as below:
        <example>
        Question: Top 3 coins with more than $1M 24h trading volume based on Trader Grade, sort by descending 24h change in Trader Grade?
        Output: WITH VOLUME AS (SELECT TOKEN_NAME, TOKEN_SYMBOL, MARKET_CAP, FULLY_DILUTED_VALUATION, CURRENT_PRICE, TM_TRADER_GRADE, TM_TRADER_GRADE_24H_PCT_CHANGE FROM TOKENMETRICS_DEV.ANALYTICS.CRYPTO_INFO_HUB_CURRENT_VIEW WHERE VOLUME_24H > 1000000 ORDER BY TM_TRADER_GRADE DESC NULLS LAST LIMIT 3) SELECT * FROM VOLUME ORDER BY TM_TRADER_GRADE_24H_PCT_CHANGE DESC NULLS LAST;
                </example>
        <example>
        Question: Give me the top 3 layer one coins according to their price
        Output: SELECT * FROM TOKENMETRICS_DEV.ANALYTICS.CRYPTO_INFO_HUB_CURRENT_VIEW
                    WHERE LOWER(CATEGORY_LIST::string) LIKE '%layer%1%' AND CURRENT_PRICE IS NOT NULL
                    ORDER BY CURRENT_PRICE DESC NULLS LAST
                    LIMIT 3;
                </example>
        <example>
        Question: What token should I buy?
        Output: SELECT * FROM TOKENMETRICS_DEV.ANALYTICS.CRYPTO_INFO_HUB_CURRENT_VIEW
                    ORDER BY TM_TRADER_GRADE DESC NULLS LAST, VOLUME_24H DESC NULLS LAST
                    LIMIT 1;
        </example>
        <example>
        Question: What is the next 100x token?
        Output: SELECT * FROM TOKENMETRICS_DEV.ANALYTICS.CRYPTO_INFO_HUB_CURRENT_VIEW
                    ORDER BY TM_INVESTOR_GRADE DESC NULLS LAST, VOLUME_24H DESC NULLS LAST
                    LIMIT 1;
        </example>
        <example>
        Question: What about zerebro?
        Output: SELECT *FROM TOKENMETRICS_DEV.ANALYTICS.CRYPTO_INFO_HUB_CURRENT_VIEW
                    WHERE LOWER(TOKEN_NAME) = LOWER('ZereBro')
                    LIMIT 1;
        </example>
        <example>
        Question: What about $LTC?
        Output: SELECT * FROM TOKENMETRICS_DEV.ANALYTICS.CRYPTO_INFO_HUB_CURRENT_VIEW
                    WHERE LOWER(TOKEN_SYMBOL) = LOWER('LTC')
                    LIMIT 1;
        </example>

        <rules>
        To generate the correct Snowflake SQL query, you must follow the rules below:
        Rules:
        - Use both the user question and conversation history to create a SQL query
        - Always use token name as default field to select a token by
        - MUST have to use the user question and conversation history to generate the SQL query
        - Use the table name without any curly brackets or anything else
        - If user asks for a single token, then only return a single token. If the user asks for a list of tokens, then limit your results to 3
        - Always use NULLS LAST in ORDER BY
        - Default ORDER BY is VOLUME_24H DESC
        - Always include columns used in ORDER BY in the SELECT result
        - Use the token name from the conversation history if not specified in the question
        - Treat the token name as only the text before the parentheses in markdown links
        - Exclude token price from buying decisions
        - Access items in OBJECT data types with COLUMN_NAME['key']
        - For columns with OBJECT datatype, to ensure that the null values inside the JSON structure are removed, always use "STRIP_NULL_VALUE(column_name['key'])" when using ORDER BY, WHERE, or SELECT etc
        - Always provide the SUMMARY if only one coin is queried in the SQL query, and if the conversation history does not include a summary or description of the token already
        - For 100x token, also give the VALUATION_METRICS
        - Always search the Snowflake table with lower case for all string values such as TOKEN_NAME, TOKEN_SYMBOL, JSON column key's etc
        - If user question or conversation history has refers to the token in all capital letters, then use TOKEN_SYMBOL in SELECT
        - MUST only return the SQL query, no other text or information, don't even include "sql" in the response, response MUST ALWAYS start with "SELECT"
         </rules>

         ## User Question
        ${question}

        ## Conversation Context
        ${conversation}
`;
