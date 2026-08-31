import { config } from '../config';
import type { RepoMetrics } from '../metrics/health';

// ─────────────────────────────────────────────────────────────────────────────
// AI Insights — Gemini integration
//
// Sends the repo's computed RepoMetrics to Gemini 3.6 Flash and returns
// structured, evidence-backed observations. Results are cached in the
// database (see routes/insights.ts) so Gemini is not called on every
// dashboard load.
//
// FUTURE SCHEDULING: This module is deployment-agnostic. A real scheduled
// analysis (e.g. weekly) would call generateInsights() for each synced repo
// and persist the result via the same cache logic used by the route layer.
// ─────────────────────────────────────────────────────────────────────────────

// ── Types ────────────────────────────────────────────────────────────────────

export interface InsightObservation {
  finding: string;
  evidence: string;
  recommendation: string;
  severity: 'high' | 'medium' | 'low' | 'positive';
}

export interface InsightsResponse {
  observations: InsightObservation[];
}

// ── Prompt construction ──────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are RepoPulse's engineering intelligence engine.

Your job is to analyze repository engineering-health metrics and identify meaningful patterns, risks, and positive signals.

Rules:
1. Use ONLY evidence contained in the supplied metrics.
2. Never invent facts, users, causes, or numbers.
3. Do not simply restate every metric.
4. Look for relationships between metrics.
5. Prefer specific observations over generic software-engineering advice.
6. Every observation must cite the actual metric/value that supports it.
7. Recommendations must be concrete and actionable.
8. Do not recommend actions that are unsupported by the available data.
9. If the data is healthy, report positive findings instead of inventing problems.
10. Do not diagnose individual developers or assign blame.
11. Avoid vague recommendations such as "improve communication" or "write better code".
12. Return 2–4 observations.
13. Prioritize the most important findings.
14. A repository with limited data should result in fewer, appropriately cautious observations rather than fabricated conclusions.
15. When comparing metrics (e.g. review latency vs CI failure rate), use cautious language: "suggests", "may indicate", "is consistent with". Do not claim causation from correlation.`;

function buildUserPrompt(metrics: RepoMetrics): string {
  // Build a concise, structured snapshot for Gemini — only the numbers that
  // matter, no formatting artifacts or internal IDs.
  const snapshot = {
    summary: metrics.summary,
    timeToFirstReview: {
      averageHours: metrics.timeToFirstReview.averageHours,
      sampleSize: metrics.timeToFirstReview.sampleSize,
    },
    timeToMerge: {
      averageHours: metrics.timeToMerge.averageHours,
      sampleSize: metrics.timeToMerge.sampleSize,
    },
    stalePrs: {
      staleCount: metrics.stalePrs.staleCount,
      openCount: metrics.stalePrs.openCount,
      staleThresholdDays: metrics.stalePrs.staleThresholdDays,
    },
    busFactor: {
      risk: metrics.busFactor.risk,
      top1SharePercentage: metrics.busFactor.top1SharePercentage,
      top2SharePercentage: metrics.busFactor.top2SharePercentage,
      topContributors: metrics.busFactor.topContributors.slice(0, 5),
    },
    ci: {
      hasCiData: metrics.ciByPrSize.hasCiData,
      // All CI rates below are PERCENTAGES on a 0–100 scale, NOT decimals.
      // 0.6 means 0.6% (1 failure out of ~167 decided PRs), NOT 60%.
      overallCiFailureRatePct: metrics.overallCiFailureRate,
      failureRateBySize: metrics.ciByPrSize.buckets.map((b) => ({
        label: b.label,
        prCount: b.prCount,
        ciFailureCount: b.ciFailureCount,
        ciPassCount: b.ciPassCount,
        failureRatePct: b.failureRate, // 0–100 percentage, NOT 0–1 fraction
      })),
    },
  };

  return `Analyze the following repository engineering-health metrics and return 2–4 observations.

Each observation must have:
- finding: a short headline
- evidence: the specific metric/value supporting the finding
- recommendation: one concrete actionable suggestion
- severity: one of "high", "medium", "low", "positive"

IMPORTANT UNITS:
- Time fields (averageHours) are in hours.
- "failureRatePct" and "overallCiFailureRatePct" are PERCENTAGES on a 0–100 scale.
  Example: a value of 0.6 means 0.6% (1 failure out of ~167 PRs), NOT 60%.
  A value of 41.4 means 41.4% (e.g. 12 failures out of 29 PRs).
- "top1SharePercentage" and "top2SharePercentage" are also on a 0–100 scale.
- "staleCount" and "openCount" are raw integer counts.

Metrics:
${JSON.stringify(snapshot, null, 2)}`;
}

// ── Gemini API call ──────────────────────────────────────────────────────────

interface GeminiCandidate {
  content: { parts: { text: string }[]; role: string };
  finishReason: string;
}

interface GeminiResponse {
  candidates?: GeminiCandidate[];
  promptFeedback?: { blockReason?: string };
  usageMetadata?: { promptTokenCount: number; candidatesTokenCount: number; totalTokenCount: number };
}

/**
 * Call the Gemini generateContent REST API and return the raw response.
 * Throws on network errors, HTTP failures, or blocked prompts.
 */
async function callGemini(prompt: string): Promise<string> {
  const apiKey = config.geminiApiKey;
  if (!apiKey) {
    throw new InsightsError('GEMINI_API_KEY is not configured. Set it in backend/.env to enable AI insights.', 'CONFIG_MISSING');
  }

  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:generateContent?key=${apiKey}`;

  const body = {
    contents: [{ parts: [{ text: `${SYSTEM_PROMPT}\n\n${prompt}` }] }],
    generationConfig: {
      responseMimeType: 'application/json',
      responseSchema: {
        type: 'OBJECT',
        properties: {
          observations: {
            type: 'ARRAY',
            items: {
              type: 'OBJECT',
              properties: {
                finding: { type: 'STRING' },
                evidence: { type: 'STRING' },
                recommendation: { type: 'STRING' },
                severity: { type: 'STRING', enum: ['high', 'medium', 'low', 'positive'] },
              },
              required: ['finding', 'evidence', 'recommendation', 'severity'],
            },
          },
        },
        required: ['observations'],
      },
    },
  };

  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new InsightsError(`Network error calling Gemini: ${msg}`, 'NETWORK_ERROR');
  }

  if (!res.ok) {
    const errorBody = await res.text().catch(() => '');
    if (res.status === 429) {
      throw new InsightsError('Gemini API rate limit exceeded. Please try again shortly.', 'RATE_LIMITED');
    }
    if (res.status === 403 || res.status === 401) {
      throw new InsightsError('Gemini API authentication failed. Check your GEMINI_API_KEY.', 'AUTH_ERROR');
    }
    throw new InsightsError(`Gemini API error (HTTP ${res.status}): ${errorBody || res.statusText}`, 'API_ERROR');
  }

  let geminiRes: GeminiResponse;
  try {
    geminiRes = (await res.json()) as GeminiResponse;
  } catch {
    throw new InsightsError('Failed to parse Gemini API response as JSON.', 'PARSE_ERROR');
  }

  if (geminiRes.promptFeedback?.blockReason) {
    throw new InsightsError(`Gemini blocked the prompt: ${geminiRes.promptFeedback.blockReason}`, 'BLOCKED');
  }

  const text = geminiRes.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) {
    throw new InsightsError('Gemini returned an empty response (no candidates).', 'EMPTY_RESPONSE');
  }

  return text;
}

// ── Defensive JSON parsing ───────────────────────────────────────────────────

const VALID_SEVERITIES = new Set(['high', 'medium', 'low', 'positive']);

export function parseInsightsResponse(raw: string): InsightsResponse {
  // Strip Markdown code fences if Gemini wraps the output despite instructions.
  let cleaned = raw.trim();
  if (cleaned.startsWith('```')) {
    cleaned = cleaned
      .replace(/^```(?:json)?\s*\n?/i, '')
      .replace(/\n?```\s*$/i, '')
      .trim();
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    throw new InsightsError('Gemini returned invalid JSON. Raw output: ' + raw.slice(0, 300), 'INVALID_JSON');
  }

  if (typeof parsed !== 'object' || parsed === null || !('observations' in parsed)) {
    throw new InsightsError('Gemini response missing "observations" field.', 'INVALID_STRUCTURE');
  }

  const obj = parsed as Record<string, unknown>;
  const observations = obj.observations;

  if (!Array.isArray(observations)) {
    throw new InsightsError('"observations" is not an array.', 'INVALID_STRUCTURE');
  }

  const validated: InsightObservation[] = [];
  for (const item of observations) {
    if (typeof item !== 'object' || item === null) continue;
    const obs = item as Record<string, unknown>;
    if (typeof obs.finding !== 'string' || typeof obs.evidence !== 'string' || typeof obs.recommendation !== 'string') {
      continue;
    }
    const severity = typeof obs.severity === 'string' ? obs.severity.toLowerCase() : '';
    if (!VALID_SEVERITIES.has(severity)) continue;
    validated.push({
      finding: obs.finding,
      evidence: obs.evidence,
      recommendation: obs.recommendation,
      severity: severity as InsightObservation['severity'],
    });
  }

  if (validated.length === 0) {
    throw new InsightsError('Gemini response contained no valid observations.', 'INVALID_STRUCTURE');
  }

  return { observations: validated };
}

// ── Public API ───────────────────────────────────────────────────────────────

export class InsightsError extends Error {
  constructor(
    message: string,
    public code: string
  ) {
    super(message);
    this.name = 'InsightsError';
  }
}

/**
 * Generate AI insights for a repository's current metrics.
 * Calls Gemini, defensively parses the response, and returns structured data.
 */
export async function generateInsights(metrics: RepoMetrics): Promise<InsightsResponse> {
  const prompt = buildUserPrompt(metrics);
  const raw = await callGemini(prompt);
  return parseInsightsResponse(raw);
}
