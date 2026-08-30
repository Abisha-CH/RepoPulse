import { Router, type Request, type Response } from 'express';
import { requireAuth } from '../auth/middleware';
import { prisma } from '../db';
import { decryptToken } from '../crypto/token';
import { computeRepoMetrics, formatDuration } from '../metrics/health';
import {
  fetchAllPullRequests,
  fetchPullRequestReviews,
  fetchPullRequestDetail,
  fetchCommitCheckStatus,
  getGitHubRepo,
  listUserGitHubRepos,
  mapConcurrent,
  GitHubApiError,
  GitHubRateLimitError,
} from '../github/client';

export const reposRouter = Router();

/**
 * GET /user/github-repos — list user's accessible GitHub repos for quick selection.
 */
reposRouter.get('/user/github-repos', requireAuth, async (req: Request, res: Response) => {
  const user = await prisma.user.findUnique({ where: { id: req.userId } });
  if (!user) {
    res.status(401).json({ error: 'User not found.' });
    return;
  }

  try {
    const token = decryptToken(user.access_token);
    const repos = await listUserGitHubRepos(token);
    res.json({ repos });
  } catch (err) {
    handleApiError(res, err);
  }
});

/**
 * GET /repos — list all connected repos for the current user.
 */
reposRouter.get('/repos', requireAuth, async (req: Request, res: Response) => {
  const repos = await prisma.repo.findMany({
    where: { connected_by_user_id: req.userId },
    include: {
      _count: {
        select: { pullRequests: true },
      },
    },
    orderBy: { name: 'asc' },
  });

  res.json({
    repos: repos.map((r) => ({
      id: r.id,
      githubRepoId: r.github_repo_id,
      owner: r.owner,
      name: r.name,
      fullName: `${r.owner}/${r.name}`,
      pullRequestCount: r._count.pullRequests,
    })),
  });
});

/**
 * POST /repos — connect a GitHub repository.
 */
reposRouter.post('/repos', requireAuth, async (req: Request, res: Response) => {
  const user = await prisma.user.findUnique({ where: { id: req.userId } });
  if (!user) {
    res.status(401).json({ error: 'User not found.' });
    return;
  }

  let owner = typeof req.body.owner === 'string' ? req.body.owner.trim() : '';
  let name = typeof req.body.name === 'string' ? req.body.name.trim() : '';

  // Support full string input "owner/name" or "https://github.com/owner/name"
  if (!owner && typeof req.body.repo === 'string') {
    const cleaned = req.body.repo
      .replace(/^https?:\/\/github\.com\//i, '')
      .replace(/\.git$/i, '')
      .replace(/^\/+|\/+$/g, '')
      .trim();
    const parts = cleaned.split('/');
    if (parts.length === 2) {
      owner = parts[0] ?? '';
      name = parts[1] ?? '';
    }
  }

  if (!owner || !name) {
    res.status(400).json({ error: 'Please provide both owner and name (e.g., "facebook/react").' });
    return;
  }

  try {
    const token = decryptToken(user.access_token);
    const ghRepo = await getGitHubRepo(owner, name, token);

    const repo = await prisma.repo.upsert({
      where: {
        owner_name: {
          owner: ghRepo.owner,
          name: ghRepo.name,
        },
      },
      update: {
        connected_by_user_id: user.id,
        github_repo_id: ghRepo.id,
      },
      create: {
        owner: ghRepo.owner,
        name: ghRepo.name,
        github_repo_id: ghRepo.id,
        connected_by_user_id: user.id,
      },
    });

    res.status(201).json({
      repo: {
        id: repo.id,
        githubRepoId: repo.github_repo_id,
        owner: repo.owner,
        name: repo.name,
        fullName: `${repo.owner}/${repo.name}`,
      },
    });
  } catch (err) {
    handleApiError(res, err);
  }
});

/**
 * POST /repos/:id/sync — sync all Pull Requests & Reviews from GitHub.
 */
reposRouter.post('/repos/:id/sync', requireAuth, async (req: Request, res: Response) => {
  const id = String(req.params.id);
  const repo = await prisma.repo.findFirst({
    where: { id, connected_by_user_id: req.userId },
  });

  if (!repo) {
    res.status(404).json({ error: 'Repository not found or not connected.' });
    return;
  }

  const user = await prisma.user.findUnique({ where: { id: req.userId } });
  if (!user) {
    res.status(401).json({ error: 'User not found.' });
    return;
  }

  const startTime = Date.now();
  console.log(`[Sync] Starting sync for ${repo.owner}/${repo.name}...`);

  try {
    const token = decryptToken(user.access_token);

    // 1. Fetch recent PRs across pages (up to 200 PRs)
    const prs = await fetchAllPullRequests(repo.owner, repo.name, token);
    console.log(`[Sync] Fetched ${prs.length} PRs from GitHub in ${Date.now() - startTime}ms.`);

    // 2. Fetch existing cached PRs from DB to skip redundant review API calls
    const existingPrs = await prisma.pullRequest.findMany({
      where: { repo_id: repo.id },
      select: {
        github_pr_id: true,
        first_review_at: true,
        state: true,
        ci_status: true,
        additions: true,
        deletions: true,
      },
    });
    const existingMap = new Map(existingPrs.map((p) => [p.github_pr_id, p]));

    // 3. Fetch reviews, CI check status, and PR size concurrently with controlled
    //    batching (10 concurrent requests). PR sizes live on the per-PR detail
    //    endpoint (GitHub omits them from the list response), so a detail call is
    //    issued when the row's additions/deletions are still at their zero default.
    const prsWithMeta = await mapConcurrent(prs, 10, async (pr) => {
      const cached = existingMap.get(pr.number);
      const isSettled = !!cached && (cached.state === 'closed' || cached.state === 'merged');
      // Closed/merged PRs whose review timestamp, CI status, and size are all
      // cached won't change on GitHub — skip all three API roundtrips.
      const needsReviews = !(isSettled && cached && cached.first_review_at !== null);
      const needsCi = !(isSettled && cached && cached.ci_status !== null);
      const hasSize = !!(cached && (cached.additions > 0 || cached.deletions > 0));
      const needsSize = !hasSize;

      if (!needsReviews && !needsCi && !needsSize) {
        return {
          pr,
          reviews: [],
          firstReviewAt: cached?.first_review_at ?? null,
          ciStatus: cached?.ci_status ?? null,
          additions: cached!.additions,
          deletions: cached!.deletions,
          isCached: true,
        };
      }

      const [reviews, ciStatus, size] = await Promise.all([
        needsReviews
          ? fetchPullRequestReviews(repo.owner, repo.name, pr.number, token)
          : Promise.resolve([]),
        needsCi && pr.head?.sha
          ? fetchCommitCheckStatus(repo.owner, repo.name, pr.head.sha, token)
          : Promise.resolve(cached?.ci_status ?? null),
        needsSize
          ? fetchPullRequestDetail(repo.owner, repo.name, pr.number, token)
          : Promise.resolve({ additions: cached?.additions ?? 0, deletions: cached?.deletions ?? 0 }),
      ]);
      const prAuthor = pr.user?.login ?? '';

      // Non-author submitted reviews
      const validReviews = reviews
        .filter((r) => r.submitted_at && r.user?.login && r.user.login !== prAuthor)
        .sort((a, b) => new Date(a.submitted_at!).getTime() - new Date(b.submitted_at!).getTime());

      const firstReviewAt =
        validReviews.length > 0 && validReviews[0]?.submitted_at
          ? new Date(validReviews[0].submitted_at)
          : null;

      return {
        pr,
        reviews,
        firstReviewAt,
        ciStatus,
        additions: size.additions,
        deletions: size.deletions,
        isCached: false,
      };
    });

    const reviewPhaseMs = Date.now() - startTime;
    console.log(`[Sync] Review+CI phase done in ${(reviewPhaseMs / 1000).toFixed(1)}s (${prsWithMeta.length} PRs, concurrency 10).`);

    // 4. Upsert PRs + reviewers. Each PR's reviewer replace is a small pooler-safe
    //    array-form transaction. No global interactive transaction: interactive
    //    $transaction(callback) is both pooler-unsafe (P2028) and would exceed Prisma's
    //    5s interactive timeout across ~200 PRs on the remote DB.
    const writeStart = Date.now();
    let upsertedCount = 0;

    for (const { pr, reviews, firstReviewAt, ciStatus, additions: linesAdded, deletions: linesDeleted, isCached } of prsWithMeta) {
      const prAuthor = pr.user?.login ?? 'ghost';
      const state = pr.merged_at ? 'merged' : pr.state;
      const openedAt = new Date(pr.created_at);
      const mergedAt = pr.merged_at ? new Date(pr.merged_at) : null;
      const closedAt = pr.closed_at ? new Date(pr.closed_at) : null;

      const savedPr = await prisma.pullRequest.upsert({
        where: {
          repo_id_github_pr_id: {
            repo_id: repo.id,
            github_pr_id: pr.number,
          },
        },
        update: {
          author: prAuthor,
          title: pr.title,
          state,
          opened_at: openedAt,
          first_review_at: firstReviewAt,
          merged_at: mergedAt,
          closed_at: closedAt,
          additions: linesAdded,
          deletions: linesDeleted,
          ci_status: ciStatus,
        },
        create: {
          repo_id: repo.id,
          github_pr_id: pr.number,
          author: prAuthor,
          title: pr.title,
          state,
          opened_at: openedAt,
          first_review_at: firstReviewAt,
          merged_at: mergedAt,
          closed_at: closedAt,
          additions: linesAdded,
          deletions: linesDeleted,
          ci_status: ciStatus,
        },
      });

      // Cached closed/merged PRs skip reviewer re-sync entirely.
      if (!isCached) {
        const uniqueReviewers = new Map<string, Date>();
        for (const rev of reviews) {
          if (rev.user?.login && rev.submitted_at) {
            const dt = new Date(rev.submitted_at);
            const existing = uniqueReviewers.get(rev.user.login);
            if (!existing || dt < existing) {
              uniqueReviewers.set(rev.user.login, dt);
            }
          }
        }

        if (uniqueReviewers.size > 0) {
          // Reviewer replace is atomic per PR via the pooler-safe array-form
          // $transaction (not interactive), so it can't hit the 5s global cap.
          await prisma.$transaction([
            prisma.reviewer.deleteMany({ where: { pull_request_id: savedPr.id } }),
            prisma.reviewer.createMany({
              data: Array.from(uniqueReviewers.entries()).map(([username, reviewed_at]) => ({
                pull_request_id: savedPr.id,
                username,
                reviewed_at,
              })),
            }),
          ]);
        }
      }
      upsertedCount += 1;
    }

    const writeMs = Date.now() - writeStart;
    console.log(`[Sync] DB write phase done in ${(writeMs / 1000).toFixed(1)}s (${upsertedCount} PRs).`);

    const durationSeconds = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`[Sync] Finished sync of ${upsertedCount} PRs in ${durationSeconds}s.`);

    res.json({
      success: true,
      count: upsertedCount,
      message: `Successfully synced ${upsertedCount} pull request(s) for ${repo.owner}/${repo.name} in ${durationSeconds}s.`,
    });
  } catch (err) {
    handleApiError(res, err);
  }
});

/**
 * GET /repos/:id/metrics — compute and return engineering health metrics.
 */
reposRouter.get('/repos/:id/metrics', requireAuth, async (req: Request, res: Response) => {
  const id = String(req.params.id);
  const repo = await prisma.repo.findFirst({
    where: { id, connected_by_user_id: req.userId },
  });

  if (!repo) {
    res.status(404).json({ error: 'Repository not found or not connected.' });
    return;
  }

  const prs = await prisma.pullRequest.findMany({
    where: { repo_id: repo.id },
    include: { reviewers: true },
    orderBy: { opened_at: 'desc' },
  });

  // Usage note: metric computation lives in src/metrics/health.ts so the same
  // numbers power both this authed per-repo route and the public leaderboard.
  const metrics = computeRepoMetrics(prs);

  // 6. Recent PRs for tabular view
  const recentPrs = prs.slice(0, 30).map((p) => {
    const timeToReviewHours = p.first_review_at
      ? Math.max(0, p.first_review_at.getTime() - p.opened_at.getTime()) / (1000 * 60 * 60)
      : null;
    const timeToMergeHours = p.merged_at
      ? Math.max(0, p.merged_at.getTime() - p.opened_at.getTime()) / (1000 * 60 * 60)
      : null;

    return {
      id: p.id,
      number: p.github_pr_id,
      title: p.title,
      author: p.author,
      state: p.state,
      openedAt: p.opened_at.toISOString(),
      firstReviewAt: p.first_review_at ? p.first_review_at.toISOString() : null,
      mergedAt: p.merged_at ? p.merged_at.toISOString() : null,
      timeToReviewFormatted: formatDuration(timeToReviewHours),
      timeToMergeFormatted: formatDuration(timeToMergeHours),
      reviewerCount: p.reviewers.length,
      linesChanged: p.additions + p.deletions,
      ciStatus: p.ci_status,
    };
  });

  res.json({
    repo: {
      id: repo.id,
      owner: repo.owner,
      name: repo.name,
      fullName: `${repo.owner}/${repo.name}`,
    },
    metrics,
    recentPullRequests: recentPrs,
  });
});

function handleApiError(res: Response, err: unknown): void {
  console.error('API Route Error:', err);
  if (err instanceof GitHubRateLimitError) {
    res.status(429).json({
      error: err.message,
      rateLimitReset: err.resetAt.toISOString(),
      remaining: err.remaining,
    });
    return;
  }
  if (err instanceof GitHubApiError) {
    res.status(err.status >= 400 && err.status < 600 ? err.status : 502).json({
      error: err.message,
    });
    return;
  }
  const message = err instanceof Error ? err.message : String(err);
  res.status(500).json({ error: message });
}
