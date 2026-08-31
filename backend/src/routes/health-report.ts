import { Router, type Request, type Response } from 'express';
import { requireAuth } from '../auth/middleware';
import { prisma } from '../db';
import { computeRepoMetrics, computeHealthScore, formatDuration, scoreLowerIsBetter } from '../metrics/health';

export const healthReportRouter = Router();

// ─────────────────────────────────────────────────────────────────────────────
// GET /repos/:id/health-report — assembled engineering health report.
//
// Reuses existing computed data: metrics from computeRepoMetrics(), overall
// health score from computeHealthScore(), and cached AI insights from the
// database. No new external API calls, no new DB writes.
// ─────────────────────────────────────────────────────────────────────────────

healthReportRouter.get('/repos/:id/health-report', requireAuth, async (req: Request, res: Response) => {
  const id = String(req.params.id);
  const repo = await prisma.repo.findFirst({
    where: { id, connected_by_user_id: req.userId },
  });

  if (!repo) {
    res.status(404).json({ error: 'Repository not found or not connected.' });
    return;
  }

  try {
    // 1. Fetch PRs and compute metrics (same as metrics endpoint).
    const prs = await prisma.pullRequest.findMany({
      where: { repo_id: repo.id },
      include: { reviewers: true },
      orderBy: { opened_at: 'desc' },
    });
    const metrics = computeRepoMetrics(prs);

    // 2. Compute overall health score (same as leaderboard).
    const staleRate =
      metrics.summary.totalPrs > 0 && metrics.stalePrs.openCount > 0
        ? metrics.stalePrs.staleCount / metrics.stalePrs.openCount
        : metrics.summary.totalPrs > 0
          ? 0
          : null;

    const concentrationPct =
      metrics.busFactor.topContributors.length > 0 ? metrics.busFactor.top2SharePercentage : null;

    const health = computeHealthScore({
      timeToMergeHours: metrics.timeToMerge.averageHours,
      staleRate,
      concentrationPct,
      ciFailureRatePct: metrics.overallCiFailureRate,
    });

    // 3. Compute sub-category scores.
    const round = (n: number | null) => n !== null ? Number(n.toFixed(1)) : null;

    // Delivery Velocity: direct reuse of timeToMerge sub-score.
    const deliveryVelocity = health.components.timeToMerge;

    // Review Process: average of timeToFirstReview + staleRate sub-scores.
    const reviewLatencyScore =
      metrics.timeToFirstReview.averageHours !== null
        ? scoreLowerIsBetter(metrics.timeToFirstReview.averageHours, 8, 72)
        : null;
    const staleRateScore = health.components.staleRate.subScore;
    const reviewProcessScore =
      reviewLatencyScore !== null && staleRateScore !== null
        ? Number(((reviewLatencyScore + staleRateScore) / 2).toFixed(1))
        : reviewLatencyScore ?? staleRateScore ?? null;

    const reviewRawParts: string[] = [];
    if (metrics.timeToFirstReview.averageHours !== null) {
      reviewRawParts.push(`${formatDuration(metrics.timeToFirstReview.averageHours)} avg review`);
    }
    if (staleRate !== null) {
      reviewRawParts.push(`${(staleRate * 100).toFixed(1)}% stale`);
    }

    // Knowledge Distribution: direct reuse of busFactor sub-score.
    const knowledgeDistribution = health.components.busFactor;

    // CI Reliability: direct reuse of ciFailureRate sub-score.
    const ciReliability = health.components.ciFailureRate;

    // 4. Fetch cached AI insights (do NOT call Gemini).
    const cachedInsight = await prisma.insight.findFirst({
      where: { repo_id: repo.id },
      orderBy: { generated_at: 'desc' },
    });

    const insights = cachedInsight
      ? { observations: (cachedInsight.result as { observations?: unknown[] }).observations ?? [], generatedAt: cachedInsight.generated_at.toISOString() }
      : null;

    res.json({
      repo: {
        id: repo.id,
        owner: repo.owner,
        name: repo.name,
        fullName: `${repo.owner}/${repo.name}`,
      },
      generatedAt: new Date().toISOString(),
      overallScore: {
        score: health.score,
        includedWeightPct: health.includedWeightPct,
      },
      categories: {
        deliveryVelocity: {
          label: 'Delivery Velocity',
          score: round(deliveryVelocity.subScore),
          raw: deliveryVelocity.formatted,
          description: 'Avg time to merge pull requests',
        },
        reviewProcess: {
          label: 'Review Process',
          score: reviewProcessScore,
          raw: reviewRawParts.join(', ') || null,
          description: 'Review latency + stale PR rate',
        },
        knowledgeDistribution: {
          label: 'Knowledge Distribution',
          score: round(knowledgeDistribution.subScore),
          raw: knowledgeDistribution.formatted,
          description: 'Bus factor / contributor concentration',
        },
        ciReliability: {
          label: 'CI Reliability',
          score: round(ciReliability.subScore),
          raw: ciReliability.formatted,
          description: 'CI check failure rate',
        },
      },
      insights,
      summary: metrics.summary,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
});
