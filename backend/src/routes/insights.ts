import { Router, type Request, type Response } from 'express';
import { requireAuth } from '../auth/middleware';
import { prisma } from '../db';
import { computeRepoMetrics } from '../metrics/health';
import { generateInsights, InsightsError } from '../insights/generate';

export const insightsRouter = Router();

// ─────────────────────────────────────────────────────────────────────────────
// GET /repos/:id/insights — return cached AI insights (or generate fresh ones).
//
// Caching strategy: each Insight row stores a pr_snapshot (the repo's total PR
// count at generation time). When a sync adds/removes PRs the count changes and
// the cached insight is considered stale. On the first request after a sync, a
// new Gemini call is made and the result is persisted; subsequent loads return
// the cache until the next sync.
//
// FUTURE SCHEDULING: A scheduled weekly job would call the same generateInsights()
// function and persist the result via the same save logic below. The route itself
// would then just read from the cache. No scheduler is implemented yet.
// ─────────────────────────────────────────────────────────────────────────────

insightsRouter.get('/repos/:id/insights', requireAuth, async (req: Request, res: Response) => {
  const id = String(req.params.id);
  const repo = await prisma.repo.findFirst({
    where: { id, connected_by_user_id: req.userId },
  });

  if (!repo) {
    res.status(404).json({ error: 'Repository not found or not connected.' });
    return;
  }

  if (!process.env.GEMINI_API_KEY?.trim()) {
    res.status(501).json({
      error: 'AI insights are not available. GEMINI_API_KEY is not configured.',
    });
    return;
  }

  try {
    // Current metrics (reuses the same function powering the dashboard).
    const prs = await prisma.pullRequest.findMany({
      where: { repo_id: repo.id },
      include: { reviewers: true },
      orderBy: { opened_at: 'desc' },
    });
    const metrics = computeRepoMetrics(prs);
    const currentPrCount = prs.length;

    // Check for a valid cached insight (same PR count = no sync since generation).
    const cached = await prisma.insight.findFirst({
      where: { repo_id: repo.id },
      orderBy: { generated_at: 'desc' },
    });

    if (cached && cached.pr_snapshot === currentPrCount) {
      res.json({ insight: cached.result, generatedAt: cached.generated_at, cached: true });
      return;
    }

    // No valid cache — generate fresh insights.
    const insights = await generateInsights(metrics);

    const saved = await prisma.insight.create({
      data: {
        repo_id: repo.id,
        pr_snapshot: currentPrCount,
        result: insights as unknown as never,
      },
    });

    res.json({ insight: saved.result, generatedAt: saved.generated_at, cached: false });
  } catch (err) {
    if (err instanceof InsightsError) {
      res.status(502).json({ error: err.message, code: err.code });
      return;
    }
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /repos/:id/insights/regenerate — force a fresh Gemini analysis,
// ignoring any cached insight.
// ─────────────────────────────────────────────────────────────────────────────

insightsRouter.post('/repos/:id/insights/regenerate', requireAuth, async (req: Request, res: Response) => {
  const id = String(req.params.id);
  const repo = await prisma.repo.findFirst({
    where: { id, connected_by_user_id: req.userId },
  });

  if (!repo) {
    res.status(404).json({ error: 'Repository not found or not connected.' });
    return;
  }

  if (!process.env.GEMINI_API_KEY?.trim()) {
    res.status(501).json({
      error: 'AI insights are not available. GEMINI_API_KEY is not configured.',
    });
    return;
  }

  try {
    const prs = await prisma.pullRequest.findMany({
      where: { repo_id: repo.id },
      include: { reviewers: true },
      orderBy: { opened_at: 'desc' },
    });
    const metrics = computeRepoMetrics(prs);
    const currentPrCount = prs.length;

    const insights = await generateInsights(metrics);

    const saved = await prisma.insight.create({
      data: {
        repo_id: repo.id,
        pr_snapshot: currentPrCount,
        result: insights as unknown as never,
      },
    });

    res.json({ insight: saved.result, generatedAt: saved.generated_at, cached: false });
  } catch (err) {
    if (err instanceof InsightsError) {
      res.status(502).json({ error: err.message, code: err.code });
      return;
    }
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
});
