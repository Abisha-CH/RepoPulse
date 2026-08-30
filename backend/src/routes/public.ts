import { Router, type Request, type Response } from 'express';
import { prisma } from '../db';
import {
  computeHealthScore,
  computeRepoMetrics,
  formatDuration,
} from '../metrics/health';

export const publicRouter = Router();

/**
 * GET /public/leaderboard — public, NO auth required.
 *
 * Ranks every repository that has ever been synced by any user by an overall
 * 0–100 health score (best first), computed from the shared metrics in
 * src/metrics/health.ts. This deliberately exposes only repo-level aggregates:
 * owner/name, health score, and the underlying metric values — no emails,
 * usernames, tokens, or anything tied to an individual user account.
 */
publicRouter.get('/public/leaderboard', async (_req: Request, res: Response) => {
  try {
    // Single query: every repo with its PR rows (base fields only — the shared
    // metric computation does not need reviewer rows, so we don't load them).
    const repos = await prisma.repo.findMany({
      include: { pullRequests: true },
      orderBy: { name: 'asc' },
    });

    const entries = repos.map((repo) => {
      const metrics = computeRepoMetrics(repo.pullRequests);

      // Share of open PRs that are stale. A repo with zero open PRs but some PR
      // history has nothing stale (rate 0 = healthy); a repo with no PRs at all
      // has no data, so the component is excluded from its score.
      const staleRate =
        metrics.summary.totalPrs > 0 && metrics.stalePrs.openCount > 0
          ? metrics.stalePrs.staleCount / metrics.stalePrs.openCount
          : metrics.summary.totalPrs > 0
            ? 0
            : null;

      // Concentration only exists once the repo has merged PRs (topContributors
      // is empty when none are merged).
      const concentrationPct =
        metrics.busFactor.topContributors.length > 0 ? metrics.busFactor.top2SharePercentage : null;

      const health = computeHealthScore({
        timeToMergeHours: metrics.timeToMerge.averageHours,
        staleRate,
        concentrationPct,
        ciFailureRatePct: metrics.overallCiFailureRate,
      });

      const ciDecidedCount = metrics.ciByPrSize.buckets.reduce(
        (sum, b) => sum + b.ciFailureCount + b.ciPassCount,
        0
      );

      return {
        repo: {
          id: repo.id,
          owner: repo.owner,
          name: repo.name,
          fullName: `${repo.owner}/${repo.name}`,
        },
        healthScore: health.score,
        includedWeightPct: health.includedWeightPct,
        components: health.components,
        metrics: {
          timeToMerge: {
            averageHours: metrics.timeToMerge.averageHours,
            formatted: formatDuration(metrics.timeToMerge.averageHours),
            sampleSize: metrics.timeToMerge.sampleSize,
          },
          stalePrs: {
            staleCount: metrics.stalePrs.staleCount,
            openCount: metrics.stalePrs.openCount,
            staleRatePct:
              staleRate === null
                ? null
                : Number((staleRate * 100).toFixed(1)),
          },
          busFactor: {
            risk: metrics.busFactor.risk,
            top2SharePercentage: metrics.busFactor.top2SharePercentage,
          },
          ciOverall: {
            failureRatePct: metrics.overallCiFailureRate,
            decidedCount: ciDecidedCount,
          },
          summary: metrics.summary,
        },
      };
    });

    // Rank best-first. Entries with no computable score (no data at all) sink
    // to the bottom, ordered by PR count so the most-synced surface first.
    const eligible = entries.filter((e) => e.healthScore !== null);
    const noScore = entries.filter((e) => e.healthScore === null);

    eligible.sort(
      (a, b) =>
        (b.healthScore as number) - (a.healthScore as number) ||
        b.metrics.summary.totalPrs - a.metrics.summary.totalPrs ||
        a.repo.fullName.localeCompare(b.repo.fullName)
    );
    noScore.sort(
      (a, b) =>
        b.metrics.summary.totalPrs - a.metrics.summary.totalPrs ||
        a.repo.fullName.localeCompare(b.repo.fullName)
    );

    const leaderboard = [...eligible, ...noScore].map((entry, idx) => ({
      rank: idx + 1,
      ...entry,
    }));

    res.json({
      totalRepos: entries.length,
      generatedAt: new Date().toISOString(),
      leaderboard,
    });
  } catch (err) {
    console.error('Public Leaderboard Error:', err);
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
});