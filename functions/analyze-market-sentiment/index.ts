/*
 * Analyze-Market-Sentiment Edge Function — AI Sentiment Oracle (v2)
 *
 * This is the "Brain" of the trading platform. It aggregates crypto market
 * sentiment from multiple sources, runs NLP-style analysis, and stores a
 * periodic snapshot in the sentiment_scores table.
 *
 * Flow:
 *   1. Fetches the Crypto Fear & Greed Index from alternative.me public API
 *   2. Fetches top crypto news headlines from CoinGecko/CryptoCompare
 *   3. Runs simplified NLP sentiment analysis on the headlines (bullish/bearish/neutral scoring)
 *   4. Computes a composite overall score blending Fear&Greed + news sentiment
 *   5. Generates an AI summary text with actionable recommendation
 *   6. Determines if long entries should be blocked (Extreme Fear) or trailing stops tightened (Extreme Greed)
 *   7. Stores the snapshot in sentiment_scores table
 *
 * Called by:
 *   - pg_cron every 5 minutes (autonomous)
 *   - Can be called manually via POST
 *
 * POST body: { } (no parameters needed)
 */

import { createClient } from "npm:@supabase/supabase-js@2.57.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

// ─── Types ───

interface FearGreedResponse {
  data: Array<{
    value: string;
    value_classification: string;
    timestamp: string;
  }>;
}

interface NewsItem {
  title: string;
  body?: string;
  categories?: string[];
}

interface SentimentSnapshot {
  overall_score: number;
  classification: string;
  fear_greed_index: number;
  news_sentiment_score: number;
  news_sentiment_label: string;
  bullish_percentage: number;
  bearish_percentage: number;
  ai_summary: string;
  recommendation: string;
  long_entries_blocked: boolean;
  trailing_tightened: boolean;
}

// ─── Fetch Fear & Greed Index ───

async function fetchFearGreedIndex(): Promise<{ value: number; classification: string }> {
  try {
    const resp = await fetch("https://api.alternative.me/fng/?limit=1");
    if (resp.ok) {
      const data = await resp.json() as FearGreedResponse;
      if (data.data && data.data.length > 0) {
        return {
          value: parseInt(data.data[0].value, 10),
          classification: data.data[0].value_classification,
        };
      }
    }
  } catch {
    // Non-fatal — will use fallback
  }
  return { value: 50, classification: "Neutral" };
}

// ─── Fetch Crypto News ───

async function fetchCryptoNews(): Promise<NewsItem[]> {
  const items: NewsItem[] = [];

  // Try CryptoCompare news API (free, no key required)
  try {
    const resp = await fetch("https://min-api.cryptocompare.com/data/v2/news/?lang=EN&limit=20");
    if (resp.ok) {
      const data = await resp.json() as { Data?: Array<{ title: string; body: string; categories: string }> };
      if (data.Data) {
        for (const article of data.Data) {
          items.push({
            title: article.title,
            body: article.body?.slice(0, 500),
            categories: article.categories?.split("|").map((c) => c.trim()) ?? [],
          });
        }
      }
    }
  } catch {
    // Non-fatal
  }

  return items;
}

// ─── NLP Sentiment Analysis (keyword-based heuristic) ───

const BULLISH_KEYWORDS = [
  "bullish", "surge", "rally", "breakout", "all-time high", "ath", "soar",
  "pump", "moon", "buy", "long", "support", "recovery", "gain", "rise",
  "positive", "optimism", "adoption", "institutional", "approve", "approved",
  "partnership", "upgrade", "milestone", "accumulate", "outflow", "demand",
  "green", "uptrend", "bounce", "breakthrough", "rallying",
];

const BEARISH_KEYWORDS = [
  "bearish", "crash", "plunge", "dump", "sell", "short", "resistance",
  "decline", "fall", "drop", "negative", "fear", "panic", "ban", "banned",
  "hack", "exploit", "liquidation", "liquidated", "outflow", "regulation",
  "lawsuit", "sec", "enforcement", "fraud", "scam", "collapse", "warning",
  "risk", "red", "downtrend", "breakdown", "selloff", "correction", "fud",
];

function analyzeTextSentiment(text: string): { score: number; bullish: boolean; bearish: boolean } {
  const lower = text.toLowerCase();
  let bullishCount = 0;
  let bearishCount = 0;

  for (const keyword of BULLISH_KEYWORDS) {
    if (lower.includes(keyword)) bullishCount++;
  }
  for (const keyword of BEARISH_KEYWORDS) {
    if (lower.includes(keyword)) bearishCount++;
  }

  const total = bullishCount + bearishCount;
  if (total === 0) return { score: 50, bullish: false, bearish: false };

  const bullishRatio = bullishCount / total;
  const score = Math.round(bullishRatio * 100);
  return {
    score,
    bullish: bullishCount > bearishCount,
    bearish: bearishCount > bullishCount,
  };
}

function analyzeNewsSentiment(newsItems: NewsItem[]): {
  score: number;
  label: string;
  bullishPct: number;
  bearishPct: number;
} {
  if (newsItems.length === 0) {
    return { score: 50, label: "neutral", bullishPct: 50, bearishPct: 50 };
  }

  let totalBullish = 0;
  let totalBearish = 0;
  let totalNeutral = 0;

  for (const item of newsItems) {
    const titleSentiment = analyzeTextSentiment(item.title);
    const bodySentiment = item.body ? analyzeTextSentiment(item.body) : { score: 50, bullish: false, bearish: false };

    // Weight title 70%, body 30%
    const combinedScore = Math.round(titleSentiment.score * 0.7 + bodySentiment.score * 0.3);

    if (titleSentiment.bullish || (combinedScore >= 60)) {
      totalBullish++;
    } else if (titleSentiment.bearish || (combinedScore <= 40)) {
      totalBearish++;
    } else {
      totalNeutral++;
    }
  }

  const total = newsItems.length;
  const bullishPct = Math.round((totalBullish / total) * 100);
  const bearishPct = Math.round((totalBearish / total) * 100);
  const score = Math.round(bullishPct * 0.6 + 50 * 0.4 + (bullishPct - bearishPct) * 0.2);
  const clampedScore = Math.max(0, Math.min(100, score));

  let label = "neutral";
  if (clampedScore >= 65) label = "bullish";
  else if (clampedScore <= 35) label = "bearish";

  return { score: clampedScore, label, bullishPct, bearishPct };
}

// ─── AI Summary Generation (with free-tier fallback chain) ───

interface AiKeys {
  gemini: string | null;
  deepseek: string | null;
  openai: string | null;
  anthropic: string | null;
}

async function fetchAiKeys(adminClient: ReturnType<typeof createClient>): Promise<AiKeys> {
  const { data } = await adminClient.from("api_settings").select("gemini_api_key, deepseek_api_key, openai_api_key, anthropic_api_key").limit(1).maybeSingle();
  const r = (data ?? {}) as Record<string, string | null>;
  return {
    gemini: r.gemini_api_key ?? null,
    deepseek: r.deepseek_api_key ?? null,
    openai: r.openai_api_key ?? null,
    anthropic: r.anthropic_api_key ?? null,
  };
}

async function callGemini(apiKey: string, prompt: string): Promise<string | null> {
  try {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.3, maxOutputTokens: 200 },
      }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
    return text ?? null;
  } catch { return null; }
}

async function callDeepSeek(apiKey: string, prompt: string): Promise<string | null> {
  try {
    const res = await fetch("https://api.deepseek.com/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: "deepseek-chat",
        messages: [{ role: "user", content: prompt }],
        max_tokens: 200,
        temperature: 0.3,
      }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data?.choices?.[0]?.message?.content ?? null;
  } catch { return null; }
}

async function callOpenAi(apiKey: string, prompt: string): Promise<string | null> {
  try {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [{ role: "user", content: prompt }],
        max_tokens: 200,
        temperature: 0.3,
      }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data?.choices?.[0]?.message?.content ?? null;
  } catch { return null; }
}

async function generateEnhancedAiSummary(
  keys: AiKeys,
  fearGreed: { value: number; classification: string },
  newsSentiment: { score: number; label: string; bullishPct: number; bearishPct: number },
  overallScore: number,
  classification: string,
): Promise<string> {
  const prompt = `You are a crypto market sentiment analyst. Provide a concise (2-3 sentence) summary and actionable recommendation.

Market data:
- Fear & Greed Index: ${fearGreed.value} (${fearGreed.classification})
- News sentiment: ${newsSentiment.label} (${newsSentiment.bullishPct}% bullish, ${newsSentiment.bearishPct}% bearish)
- Overall composite score: ${overallScore}/100 (${classification})

Give a brief professional summary with a trading recommendation.`;

  // Fallback chain: Gemini (free) -> DeepSeek (free) -> OpenAI (paid) -> Anthropic (paid) -> built-in NLP
  if (keys.gemini) {
    const result = await callGemini(keys.gemini, prompt);
    if (result) return `[Gemini] ${result.trim()}`;
  }
  if (keys.deepseek) {
    const result = await callDeepSeek(keys.deepseek, prompt);
    if (result) return `[DeepSeek] ${result.trim()}`;
  }
  if (keys.openai) {
    const result = await callOpenAi(keys.openai, prompt);
    if (result) return `[OpenAI] ${result.trim()}`;
  }
  // Final fallback: built-in NLP heuristic (zero cost, never crashes)
  return generateAiSummary(fearGreed, newsSentiment, overallScore, classification);
}

function generateAiSummary(
  fearGreed: { value: number; classification: string },
  newsSentiment: { score: number; label: string; bullishPct: number; bearishPct: number },
  overallScore: number,
  classification: string,
): string {
  const fgDesc = fearGreed.value < 25
    ? "extreme fear dominating market psychology"
    : fearGreed.value < 45
    ? "elevated fear among investors"
    : fearGreed.value < 55
    ? "neutral market sentiment with balanced positioning"
    : fearGreed.value < 75
    ? "growing greed and optimism"
    : "extreme greed with euphoric conditions";

  const newsDesc = newsSentiment.label === "bullish"
    ? `News sentiment is strongly bullish (${newsSentiment.bullishPct}% positive headlines)`
    : newsSentiment.label === "bearish"
    ? `News sentiment is bearish (${newsSentiment.bearishPct}% negative headlines detected by NLP)`
    : "News sentiment is neutral with mixed signals";

  let riskWarning = "";
  if (overallScore < 20) {
    riskWarning = " AI has detected extreme bearish momentum — long entries are paused platform-wide to protect capital.";
  } else if (overallScore < 35) {
    riskWarning = " Elevated risk detected — exercise caution with new long positions.";
  } else if (overallScore > 80) {
    riskWarning = " Extreme greed detected — trailing stops tightened globally. Potential reversal risk at elevated levels.";
  }

  return `Cortex AI analyzes ${fgDesc} (F&G: ${fearGreed.value}). ${newsDesc}.${riskWarning}`;
}

function generateRecommendation(overallScore: number): string {
  if (overallScore < 20) return "Pause all new long entries";
  if (overallScore < 35) return "Cautious trading — reduce position sizes";
  if (overallScore < 55) return "Normal trading with balanced risk";
  if (overallScore < 75) return "Favorable for long entries with standard risk";
  return "Tighten trailing stops — reversal risk elevated";
}

function classifyScore(score: number): string {
  if (score < 20) return "Extreme Fear";
  if (score < 40) return "Fear";
  if (score < 60) return "Neutral";
  if (score < 80) return "Greed";
  return "Extreme Greed";
}

// ─── Main Handler ───

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const adminClient = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    // 1. Fetch Fear & Greed Index
    const fearGreed = await fetchFearGreedIndex();

    // 2. Fetch crypto news
    const newsItems = await fetchCryptoNews();

    // 3. Analyze news sentiment with NLP
    const newsSentiment = analyzeNewsSentiment(newsItems);

    // 4. Compute composite overall score
    // Weight: 50% Fear & Greed, 40% News sentiment, 10% momentum adjustment
    const overallScore = Math.max(0, Math.min(100, Math.round(
      fearGreed.value * 0.5 + newsSentiment.score * 0.4 +
      (newsSentiment.bullishPct - newsSentiment.bearishPct) * 0.1 + 50 * 0.0
    )));

    const classification = classifyScore(overallScore);

    // 5. Determine AI risk guardrails
    const longEntriesBlocked = overallScore < 20;
    const trailingTightened = overallScore > 80;

    // 6. Generate AI summary — try AI keys in fallback chain, then NLP
    const aiKeys = await fetchAiKeys(adminClient);
    const aiSummary = await generateEnhancedAiSummary(aiKeys, fearGreed, newsSentiment, overallScore, classification);
    const recommendation = generateRecommendation(overallScore);

    // 7. Store snapshot in database
    const snapshot: SentimentSnapshot = {
      overall_score: overallScore,
      classification,
      fear_greed_index: fearGreed.value,
      news_sentiment_score: newsSentiment.score,
      news_sentiment_label: newsSentiment.label,
      bullish_percentage: newsSentiment.bullishPct,
      bearish_percentage: newsSentiment.bearishPct,
      ai_summary: aiSummary,
      recommendation: recommendation,
      long_entries_blocked: longEntriesBlocked,
      trailing_tightened: trailingTightened,
    };

    const { data: insertData, error: insertErr } = await adminClient
      .from("sentiment_scores")
      .insert({
        overall_score: snapshot.overall_score,
        classification: snapshot.classification,
        fear_greed_index: snapshot.fear_greed_index,
        news_sentiment_score: snapshot.news_sentiment_score,
        news_sentiment_label: snapshot.news_sentiment_label,
        bullish_percentage: snapshot.bullish_percentage,
        bearish_percentage: snapshot.bearish_percentage,
        ai_summary: snapshot.ai_summary,
        recommendation: snapshot.recommendation,
        long_entries_blocked: snapshot.long_entries_blocked,
        trailing_tightened: snapshot.trailing_tightened,
      })
      .select("*")
      .maybeSingle();

    if (insertErr) {
      return new Response(JSON.stringify({ error: insertErr.message }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({
      success: true,
      sentiment: snapshot,
      stored: insertData,
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
