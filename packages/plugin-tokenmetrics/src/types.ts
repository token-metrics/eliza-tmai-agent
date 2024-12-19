import { Action, Plugin } from "@ai16z/eliza";

export interface TokenMetricsConfig {
    apiEndpoint?: string;
    apiKey?: string;
    snowflakeUrl?: string;
    maxResults?: number;
    cacheTimeout?: number;
}

export interface TokenGrades {
    tmTraderGrade: number;
    tmInvestorGrade: number;
    taGrade: number;
    quantGrade: number;
    fundamentalGrade: number;
    technologyGrade: number;
    valuationGrade: number;
}

export interface TokenScores {
    defiUsage: number;
    community: number;
    exchange: number;
    vc: number;
    tokenomics: number;
    defiScanner: number;
    activity: number;
    repository: number;
    collaboration: number;
}

export interface TokenMetricsData {
    date: string;
    tokenName: string;
    tokenSymbol: string;
    summary: string;
    tokenUrl: string;
    platforms: { [chain: string]: string };
    grades: TokenGrades;
    scores: TokenScores;
    valuationMetrics: {
        categoryFdvMedian: { [category: string]: number };
        fdv: number;
        projectAge: number;
    };
    maxDrawdown: number;
    sortino: number;
    tvl: number;
    tradingSignal: number;
    traderGradeSignal: string;
    tokenTrend: number;
    volume24h: number;
    marketCap: number;
    marketCapRank: number;
    circulatingSupply: number;
    totalSupply: number;
    maxSupply: number;
    fullyDilutedValuation: number;
    high24h: number;
    low24h: number;
    allTimeHigh: {
        ath: number;
        athChangePercentage: number;
        athDate: string;
    };
    allTimeLow: {
        atl: number;
        atlChangePercentage: number;
        atlDate: string;
    };
    priceChangePercentage: {
        "1h": number;
        "24h": number;
        "7d": number;
        "30d": number;
        "200d": number;
        "1y": number;
        allTime: number;
    };
}

export interface TokenMetricsAction extends Action {
    config: TokenMetricsConfig;
}

export interface TokenMetricsPlugin extends Plugin {
    config: TokenMetricsConfig;
    actions: TokenMetricsAction[];
}