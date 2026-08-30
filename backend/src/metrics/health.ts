import type { PullRequest } from '@prisma/client';

/**
 * Format hour durations into clean human strings ("2.5h", "3.1d", "45m").
 * "N/A" when the value is null or not a number.
 */
export function formatDuration(hours: number | null): string {
  if (hours === null || isNaN(hours)) {
    return 'N/A';
  }
  if (hours < 1) {
    const mins = Math.max(1, Math.round(hours * 60));
    return `${mins}m`;
  }
  if (hours < 48) {
    return `${hours.toFixed(1)}h`;
  }
  const days = (hours / 24).toFixed(1);
  return `${days}d`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Public health score (0 = worst, 100 = best).
//
// Every input below is "lower is better". Each is normalized linearly onto a
// 0–100 sub-score (at the "best" anchor = 100, at the "worst" anchor = 0,
// clamped) and combined as a *weighted average*. Weights are named constants
// that sum to 100, so they can be explained in the UI and retuned in one place.
//
// A component with no data for a repo (its raw value is null) is *excluded*:
// its weight is dropped from both sides, and the remaining weights are
// renormalized automatically (the score uses (Σ wᵢ·sᵢ) / Σ wᵢ over the
// included components only). Repos with no data at all get score = null.
// ─────────────────────────────────────────────────────────────────────────────
export const HEALTH_SCORE_CONFIG = {
  weights: {
    // Velocity — slow merges stall delivery.
    timeToMerge: 30,
    // Workflow health — abandoned open PRs.
    staleRate: 25,
    // Resilience — contributor concentration / bus factor.
    busFactor: 20,
    // Quality — broken checks on PRs.
    ciFailureRate: 25,
  },
  // Normalization anchors: "best" → sub-score 100, "worst" → sub-score 0.
  // Values beyond either anchor saturate at the endpoint.
  normalization: {
    // Avg time to merge: ≤ 8h (healthy cadence) … ≥ 168h (7 days) scores 0.
    timeToMergeHours: { best: 8, worst: 168 },
    // Share of open PRs that are stale: 0% … ≥ 50% scores 0.
    staleRate: { best: 0, worst: 0.5 },
    // Top-2 author share of merged PRs: ≤ 40% … 100% (single author) scores 0.
    concentrationPct: { best: 40, worst: 100 },
    // Overall CI failure rate: 0% … ≥ 40% scores 0 (inputs in percentage form).
    ciFailureRate: { best: 0, worst: 40 },
  },
} as const;

export interface HealthScoreComponent {
  label: string;
  /** Configured weight as a percentage point (out of 100). */
  weightPct: number;
  /** False when the repo has no data for this metric (weight renormalized away). */
  included: boolean;
  /** The raw "lower is better" value before normalization, or null when absent. */
  raw: number | null;
  /** Human-readable rendering of `raw` (e.g. "23.5h", "4.2%"). */
  formatted: string | null;
  /** 0–100 sub-score after normalization, or null when the metric is absent. */
  subScore: number | null;
}

export interface HealthScoreResult {
  /** Overall 0–100 health score, null when no component has data. */
  score: number | null;
  /** Sum of the weights that were actually included (for display). */
  includedWeightPct: number;
  components: {
    timeToMerge: HealthScoreComponent;
    staleRate: HealthScoreComponent;
    busFactor: HealthScoreComponent;
    ciFailureRate: HealthScoreComponent;
  };
}

/** Linear "lower is better" normalization between the best/worst anchors, clamped to 0–100. */
function scoreLowerIsBetter(raw: number, best: number, worst: number): number {
  if (!isFinite(raw)) {
    return 0;
  }
  const span = best - worst;
  if (span === 0) {
    return raw <= best ? 100 : 0;
  }
  return Math.min(100, Math.max(0, ((raw - worst) / span) * 100));
}

function formatPercent(rate: number | null): string | null {
  return rate === null ? null : `${rate.toFixed(1)}%`;
}

export function computeHealthScore(inputs: {
  timeToMergeHours: number | null;
  /** Share of open PRs that are stale (0–1). 0 when there are no open PRs. */
  staleRate: number | null;
  /** Top-2 author share of merged PRs as a percentage (0–100). */
  concentrationPct: number | null;
  /** Overall CI failure rate as a percentage (0–100). */
  ciFailureRatePct: number | null;
}): HealthScoreResult {
  const { weights, normalization } = HEALTH_SCORE_CONFIG;

  const timeToMerge: HealthScoreComponent = {
    label: 'Time to Merge',
    weightPct: weights.timeToMerge,
    included: inputs.timeToMergeHours !== null && inputs.timeToMergeHours !== undefined,
    raw: inputs.timeToMergeHours ?? null,
    formatted:
      inputs.timeToMergeHours !== null && inputs.timeToMergeHours !== undefined
        ? formatDuration(inputs.timeToMergeHours)
        : null,
    subScore:
      inputs.timeToMergeHours !== null && inputs.timeToMergeHours !== undefined
        ? scoreLowerIsBetter(
            inputs.timeToMergeHours,
            normalization.timeToMergeHours.best,
            normalization.timeToMergeHours.worst
          )
        : null,
  };

  const staleRate: HealthScoreComponent = {
    label: 'Stale Open PRs',
    weightPct: weights.staleRate,
    included: inputs.staleRate !== null && inputs.staleRate !== undefined,
    raw: inputs.staleRate ?? null,
    formatted: inputs.staleRate !== null && inputs.staleRate !== undefined
      ? formatPercent(inputs.staleRate * 100)
      : null,
    subScore:
      inputs.staleRate !== null && inputs.staleRate !== undefined
        ? scoreLowerIsBetter(
            inputs.staleRate,
            normalization.staleRate.best,
            normalization.staleRate.worst
          )
        : null,
  };

  const busFactor: HealthScoreComponent = {
    label: 'Bus Factor (concentration)',
    weightPct: weights.busFactor,
    included: inputs.concentrationPct !== null && inputs.concentrationPct !== undefined,
    raw: inputs.concentrationPct ?? null,
    formatted:
      inputs.concentrationPct !== null && inputs.concentrationPct !== undefined
        ? formatPercent(inputs.concentrationPct)
        : null,
    subScore:
      inputs.concentrationPct !== null && inputs.concentrationPct !== undefined
        ? scoreLowerIsBetter(
            inputs.concentrationPct,
            normalization.concentrationPct.best,
            normalization.concentrationPct.worst
          )
        : null,
  };

  const ciFailureRate: HealthScoreComponent = {
    label: 'CI Failure Rate',
    weightPct: weights.ciFailureRate,
    included: inputs.ciFailureRatePct !== null && inputs.ciFailureRatePct !== undefined,
    raw: inputs.ciFailureRatePct ?? null,
    formatted: inputs.ciFailureRatePct !== null && inputs.ciFailureRatePct !== undefined
      ? formatPercent(inputs.ciFailureRatePct)
      : null,
    subScore:
      inputs.ciFailureRatePct !== null && inputs.ciFailureRatePct !== undefined
        ? scoreLowerIsBetter(
            inputs.ciFailureRatePct,
            normalization.ciFailureRate.best,
            normalization.ciFailureRate.worst
          )
        : null,
  };

  const all = [timeToMerge, staleRate, busFactor, ciFailureRate];
  const included = all.filter((c) => c.included && c.subScore !== null);
  const includedWeightPct = included.reduce((sum, c) => sum + c.weightPct, 0);

  let score: number | null = null;
  if (included.length > 0 && includedWeightPct > 0) {
    const weighted =
      included.reduce((sum, c) => sum + (c.weightPct / 100) * (c.subScore ?? 0), 0) /
      (includedWeightPct / 100);
    score = Number(weighted.toFixed(1));
  }

  return {
    score,
    includedWeightPct,
    components: { timeToMerge, staleRate, busFactor, ciFailureRate },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Per-repo metrics computation.
//
// Shared by the authed GET /repos/:id/metrics route and the public
// GET /public/leaderboard route so both always present identical numbers.
// The route layer is responsible for the `repo` envelope and the recent-PR
// table rows; this function only computes the aggregate `metrics` object.
// ─────────────────────────────────────────────────────────────────────────────

const STALE_DAYS = 7;

// PR size bucket thresholds (total lines changed = additions + deletions).
const SIZE_BUCKETS = [
  { key: 'small', label: 'Small', sizeRange: '< 100 lines' },
  { key: 'medium', label: 'Medium', sizeRange: '100 – 499 lines' },
  { key: 'large', label: 'Large', sizeRange: '≥ 500 lines' },
] as const;

function sizeBucketKey(lines: number): (typeof SIZE_BUCKETS)[number]['key'] {
  if (lines < 100) return 'small';
  if (lines < 500) return 'medium';
  return 'large';
}

export interface RepoMetrics {
  timeToFirstReview: {
    averageHours: number | null;
    formatted: string;
    sampleSize: number;
  };
  timeToMerge: {
    averageHours: number | null;
    formatted: string;
    sampleSize: number;
  };
  busFactor: {
    risk: 'High' | 'Moderate' | 'Low' | 'Insufficient Data';
    description: string;
    top1SharePercentage: number;
    top2SharePercentage: number;
    topContributors: { author: string; count: number; percentage: number }[];
    methodologyTradeoff: string;
  };
  stalePrs: {
    staleCount: number;
    openCount: number;
    staleThresholdDays: number;
    stalePrs: { githubPrId: number; title: string; author: string; daysOpen: number; openedAt: string }[];
  };
  ciByPrSize: {
    hasCiData: boolean;
    buckets: {
      key: string;
      label: string;
      sizeRange: string;
      prCount: number;
      ciFailureCount: number;
      ciPassCount: number;
      ciUnknownCount: number;
      failureRate: number | null;
    }[];
  };
  /** Overall CI failure rate across all PRs with a decided status (0–100), null when none. */
  overallCiFailureRate: number | null;
  summary: {
    totalPrs: number;
    openPrs: number;
    mergedPrs: number;
    closedPrs: number;
  };
}

export function computeRepoMetrics(prs: PullRequest[]): RepoMetrics {
  const now = Date.now();
  const staleThresholdMs = STALE_DAYS * 24 * 60 * 60 * 1000;

  // 1. Time to First Review
  const reviewedPrs = prs.filter((p) => p.first_review_at !== null);
  const reviewDurationsHours = reviewedPrs.map(
    (p) => Math.max(0, p.first_review_at!.getTime() - p.opened_at.getTime()) / (1000 * 60 * 60)
  );
  const avgTimeToReviewHours =
    reviewDurationsHours.length > 0
      ? reviewDurationsHours.reduce((a, b) => a + b, 0) / reviewDurationsHours.length
      : null;

  // 2. Time to Merge
  const mergedPrs = prs.filter((p) => p.merged_at !== null);
  const mergeDurationsHours = mergedPrs.map(
    (p) => Math.max(0, p.merged_at!.getTime() - p.opened_at.getTime()) / (1000 * 60 * 60)
  );
  const avgTimeToMergeHours =
    mergeDurationsHours.length > 0
      ? mergeDurationsHours.reduce((a, b) => a + b, 0) / mergeDurationsHours.length
      : null;

  // 3. Bus Factor & PR Author Concentration
  const totalMerged = mergedPrs.length;
  const authorCounts: Record<string, number> = {};
  for (const p of mergedPrs) {
    authorCounts[p.author] = (authorCounts[p.author] || 0) + 1;
  }
  const authorRankings = Object.entries(authorCounts)
    .map(([author, count]) => ({
      author,
      count,
      percentage: totalMerged > 0 ? Math.round((count / totalMerged) * 100) : 0,
    }))
    .sort((a, b) => b.count - a.count);

  const top1Share = authorRankings[0]?.percentage ?? 0;
  const top2Count = authorRankings.slice(0, 2).reduce((sum, a) => sum + a.count, 0);
  const top2Share = totalMerged > 0 ? Math.round((top2Count / totalMerged) * 100) : 0;

  let busFactorRisk: 'High' | 'Moderate' | 'Low' | 'Insufficient Data';
  let busFactorScoreDescription: string;

  if (totalMerged === 0) {
    busFactorRisk = 'Insufficient Data';
    busFactorScoreDescription = 'No merged pull requests available yet to compute concentration.';
  } else if (top1Share >= 70 || (totalMerged >= 3 && top2Share >= 85)) {
    busFactorRisk = 'High';
    busFactorScoreDescription = `High knowledge concentration: ${top1Share}% of merged PRs authored by top contributor (${authorRankings[0]?.author}).`;
  } else if (top1Share >= 50 || top2Share >= 70) {
    busFactorRisk = 'Moderate';
    busFactorScoreDescription = `Moderate concentration: top 2 contributors author ${top2Share}% of merged PRs.`;
  } else {
    busFactorRisk = 'Low';
    busFactorScoreDescription = `Healthy contribution distribution across ${authorRankings.length} authors.`;
  }

  // 4. Stale PRs
  const openPrs = prs.filter((p) => p.state === 'open');
  const stalePrs = openPrs.filter((p) => now - p.opened_at.getTime() > staleThresholdMs);
  const stalePrDetails = stalePrs.map((p) => ({
    githubPrId: p.github_pr_id,
    title: p.title,
    author: p.author,
    daysOpen: Math.floor((now - p.opened_at.getTime()) / (24 * 60 * 60 * 1000)),
    openedAt: p.opened_at.toISOString(),
  }));

  // 5. CI failure rate by PR size (+ overall CI failure rate for the leaderboard)
  const bucketAcc = new Map<string, { prCount: number; pass: number; fail: number; unknown: number }>();
  let hasCiData = false;
  for (const p of prs) {
    const lines = p.additions + p.deletions;
    const key = sizeBucketKey(lines);
    const bucket = bucketAcc.get(key) ?? { prCount: 0, pass: 0, fail: 0, unknown: 0 };
    bucket.prCount += 1;
    if (p.ci_status === 'failure') {
      bucket.fail += 1;
      hasCiData = true;
    } else if (p.ci_status === 'success') {
      bucket.pass += 1;
      hasCiData = true;
    } else {
      bucket.unknown += 1;
    }
    bucketAcc.set(key, bucket);
  }

  const ciByPrSize = {
    hasCiData,
    buckets: SIZE_BUCKETS.map((s) => {
      const b = bucketAcc.get(s.key);
      const prCount = b?.prCount ?? 0;
      const ciFailureCount = b?.fail ?? 0;
      const ciPassCount = b?.pass ?? 0;
      const ciUnknownCount = b?.unknown ?? 0;
      const decided = ciFailureCount + ciPassCount;
      return {
        key: s.key,
        label: s.label,
        sizeRange: s.sizeRange,
        prCount,
        ciFailureCount,
        ciPassCount,
        ciUnknownCount,
        failureRate: decided > 0 ? Number(((ciFailureCount / decided) * 100).toFixed(1)) : null,
      };
    }),
  };

  // Overall CI failure rate (failures ÷ decided) across every PR in the repo.
  let ciFail = 0;
  let ciPass = 0;
  for (const p of prs) {
    if (p.ci_status === 'failure') ciFail += 1;
    else if (p.ci_status === 'success') ciPass += 1;
  }
  const ciDecided = ciFail + ciPass;
  const overallCiFailureRate = ciDecided > 0 ? Number(((ciFail / ciDecided) * 100).toFixed(1)) : null;

  return {
    timeToFirstReview: {
      averageHours: avgTimeToReviewHours !== null ? Number(avgTimeToReviewHours.toFixed(1)) : null,
      formatted: formatDuration(avgTimeToReviewHours),
      sampleSize: reviewedPrs.length,
    },
    timeToMerge: {
      averageHours: avgTimeToMergeHours !== null ? Number(avgTimeToMergeHours.toFixed(1)) : null,
      formatted: formatDuration(avgTimeToMergeHours),
      sampleSize: mergedPrs.length,
    },
    busFactor: {
      risk: busFactorRisk,
      description: busFactorScoreDescription,
      top1SharePercentage: top1Share,
      top2SharePercentage: top2Share,
      topContributors: authorRankings.slice(0, 5),
      methodologyTradeoff:
        'Approximated via PR author concentration (% of merged PRs authored by top contributors). Note: This reflects key contributor dependency at the PR level without requiring full git line-level blame analysis.',
    },
    stalePrs: {
      staleCount: stalePrs.length,
      openCount: openPrs.length,
      staleThresholdDays: STALE_DAYS,
      stalePrs: stalePrDetails,
    },
    ciByPrSize,
    overallCiFailureRate,
    summary: {
      totalPrs: prs.length,
      openPrs: openPrs.length,
      mergedPrs: mergedPrs.length,
      closedPrs: prs.filter((p) => p.state === 'closed').length,
    },
  };
}