const GITHUB_API_URL = 'https://api.github.com';
const USER_AGENT = 'RepoPulse';

export class GitHubApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly endpoint: string
  ) {
    super(message);
    this.name = 'GitHubApiError';
  }
}

export class GitHubRateLimitError extends GitHubApiError {
  constructor(
    message: string,
    status: number,
    endpoint: string,
    public readonly resetAt: Date,
    public readonly remaining: number
  ) {
    super(message, status, endpoint);
    this.name = 'GitHubRateLimitError';
  }
}

interface FetchOptions {
  method?: string;
  body?: unknown;
}

export interface GitHubRepoSummary {
  id: number;
  owner: string;
  name: string;
  fullName: string;
  description: string | null;
  isPrivate: boolean;
  htmlUrl: string;
  updatedAt: string;
}

export interface GitHubPR {
  id: number;
  number: number;
  title: string;
  state: 'open' | 'closed';
  user: {
    login: string;
  } | null;
  created_at: string;
  updated_at: string;
  closed_at: string | null;
  merged_at: string | null;
  draft?: boolean;
  // Lines changed — already returned by the pulls list API.
  additions?: number;
  deletions?: number;
  // Head commit SHA, used to query check status.
  head: {
    sha: string;
  };
}

export interface GitHubReview {
  id: number;
  user: {
    login: string;
  } | null;
  state: 'APPROVED' | 'CHANGES_REQUESTED' | 'COMMENTED' | 'DISMISSED';
  submitted_at: string | null;
}

async function githubFetch<T>(endpoint: string, token: string, options: FetchOptions = {}): Promise<T> {
  const url = endpoint.startsWith('http') ? endpoint : `${GITHUB_API_URL}${endpoint}`;
  const resp = await fetch(url, {
    method: options.method ?? 'GET',
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'User-Agent': USER_AGENT,
      'X-GitHub-Api-Version': '2022-11-28',
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(options.body ? { body: JSON.stringify(options.body) } : {}),
  });

  const remaining = Number(resp.headers.get('x-ratelimit-remaining') ?? -1);
  const resetEpoch = Number(resp.headers.get('x-ratelimit-reset') ?? 0);
  const resetAt = resetEpoch > 0 ? new Date(resetEpoch * 1000) : new Date(Date.now() + 60 * 1000);

  if (resp.status === 403 || resp.status === 429) {
    let errDetail = '';
    try {
      const errJson = (await resp.json()) as { message?: string };
      errDetail = errJson.message ?? '';
    } catch {
      // Ignore JSON parse error on error body
    }

    const isRateLimit =
      remaining === 0 ||
      errDetail.toLowerCase().includes('rate limit') ||
      errDetail.toLowerCase().includes('secondary');

    if (isRateLimit) {
      const waitMinutes = Math.max(1, Math.ceil((resetAt.getTime() - Date.now()) / 60000));
      throw new GitHubRateLimitError(
        `GitHub API rate limit exceeded. Resets in approximately ${waitMinutes} minute(s) at ${resetAt.toLocaleTimeString()}.`,
        resp.status,
        endpoint,
        resetAt,
        remaining
      );
    }

    throw new GitHubApiError(
      errDetail || `GitHub API request forbidden (${resp.status})`,
      resp.status,
      endpoint
    );
  }

  if (!resp.ok) {
    let errDetail = '';
    try {
      const errJson = (await resp.json()) as { message?: string };
      errDetail = errJson.message ?? '';
    } catch {
      // Ignore JSON parse error
    }
    throw new GitHubApiError(
      errDetail || `GitHub API error: ${resp.status} ${resp.statusText}`,
      resp.status,
      endpoint
    );
  }

  return (await resp.json()) as T;
}

/**
 * Validate and fetch a specific repository by owner and name.
 */
export async function getGitHubRepo(
  owner: string,
  name: string,
  token: string
): Promise<GitHubRepoSummary> {
  interface RawRepo {
    id: number;
    name: string;
    full_name: string;
    description: string | null;
    private: boolean;
    html_url: string;
    updated_at: string;
    owner: { login: string };
  }

  const raw = await githubFetch<RawRepo>(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}`, token);
  return {
    id: raw.id,
    owner: raw.owner.login,
    name: raw.name,
    fullName: raw.full_name,
    description: raw.description,
    isPrivate: raw.private,
    htmlUrl: raw.html_url,
    updatedAt: raw.updated_at,
  };
}

/**
 * List repositories the authenticated user has access to.
 */
export async function listUserGitHubRepos(token: string): Promise<GitHubRepoSummary[]> {
  interface RawRepo {
    id: number;
    name: string;
    full_name: string;
    description: string | null;
    private: boolean;
    html_url: string;
    updated_at: string;
    owner: { login: string };
  }

  const rawRepos = await githubFetch<RawRepo[]>(
    '/user/repos?sort=updated&per_page=100&affiliation=owner,collaborator,organization_member',
    token
  );

  return rawRepos.map((r) => ({
    id: r.id,
    owner: r.owner.login,
    name: r.name,
    fullName: r.full_name,
    description: r.description,
    isPrivate: r.private,
    htmlUrl: r.html_url,
    updatedAt: r.updated_at,
  }));
}

/**
 * Fetch Pull Requests for a repository across pages (default 2 pages = up to 200 PRs for fast sync).
 */
export async function fetchAllPullRequests(
  owner: string,
  name: string,
  token: string,
  maxPages = 2
): Promise<GitHubPR[]> {
  const allPrs: GitHubPR[] = [];
  let page = 1;

  while (page <= maxPages) {
    const prs = await githubFetch<GitHubPR[]>(
      `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/pulls?state=all&per_page=100&page=${page}&sort=created&direction=desc`,
      token
    );

    if (!Array.isArray(prs) || prs.length === 0) {
      break;
    }

    allPrs.push(...prs);

    if (prs.length < 100) {
      break;
    }
    page += 1;
  }

  return allPrs;
}

/**
 * Fetch submitted reviews for a specific pull request.
 */
export async function fetchPullRequestReviews(
  owner: string,
  name: string,
  pullNumber: number,
  token: string
): Promise<GitHubReview[]> {
  try {
    const reviews = await githubFetch<GitHubReview[]>(
      `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/pulls/${pullNumber}/reviews?per_page=100`,
      token
    );
    return Array.isArray(reviews) ? reviews : [];
  } catch (err) {
    // If a PR was deleted or reviews endpoint returns 404, return empty list gracefully
    if (err instanceof GitHubApiError && err.status === 404) {
      return [];
    }
    throw err;
  }
}

interface GitHubCheckRun {
  status: string; // 'queued' | 'in_progress' | 'completed'
  conclusion: string | null; // 'success' | 'failure' | 'timed_out' | 'neutral' | ... | null
}

interface GitHubCheckRunsResponse {
  total_count: number;
  check_runs: GitHubCheckRun[];
}

/**
 * Fetch the latest check-run status for a commit via the GitHub Checks API
 * (GET /repos/{owner}/{repo}/commits/{sha}/check-runs?filter=latest).
 *
 * Returns:
 *   'failure'  — a completed run failed, timed out, or requires action
 *   'pending'  — at least one run is still queued / in progress
 *   'success'  — at least one completed run and none failed or pending
 *   null       — no check runs configured on this repo (no CI signal)
 *
 * 404 (or an empty result set) is treated as "no CI", mirroring the graceful
 * handling in fetchPullRequestReviews.
 */
export async function fetchCommitCheckStatus(
  owner: string,
  name: string,
  sha: string,
  token: string
): Promise<string | null> {
  try {
    const data = await githubFetch<GitHubCheckRunsResponse>(
      `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/commits/${encodeURIComponent(sha)}/check-runs?filter=latest&per_page=100`,
      token
    );

    const runs = Array.isArray(data?.check_runs) ? data.check_runs : [];
    if (data?.total_count === 0 || runs.length === 0) {
      return null;
    }

    const FAILURES = new Set(['failure', 'timed_out', 'action_required']);

    if (runs.some((r) => r.status === 'completed' && r.conclusion && FAILURES.has(r.conclusion))) {
      return 'failure';
    }
    if (runs.some((r) => r.status === 'queued' || r.status === 'in_progress')) {
      return 'pending';
    }
    return 'success';
  } catch (err) {
    // A commit with unknown/no checks surfaces as 404 — treat as no CI signal.
    if (err instanceof GitHubApiError && err.status === 404) {
      return null;
    }
    throw err;
  }
}

interface GitHubPullDetail {
  additions?: number;
  deletions?: number;
}

/**
 * Fetch the individual pull request so we get accurate line counts.
 *
 * NOTE: the List Pull Requests endpoint intentionally omits `additions` /
 * `deletions` / `changed_files` (GitHub returns real numbers only on the
 * per-PR endpoint), so synchronizing PR size requires one detail call per PR.
 * Returns 0/0 on a 404 (deleted PR), mirroring the review-fetch fallback.
 */
export async function fetchPullRequestDetail(
  owner: string,
  name: string,
  pullNumber: number,
  token: string
): Promise<{ additions: number; deletions: number }> {
  try {
    const pr = await githubFetch<GitHubPullDetail>(
      `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/pulls/${pullNumber}`,
      token
    );
    return { additions: pr.additions ?? 0, deletions: pr.deletions ?? 0 };
  } catch (err) {
    if (err instanceof GitHubApiError && err.status === 404) {
      return { additions: 0, deletions: 0 };
    }
    throw err;
  }
}

/**
 * Utility: Process items in concurrent batches to avoid rate limit spikes.
 */
export async function mapConcurrent<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let currentIndex = 0;

  async function worker(): Promise<void> {
    while (currentIndex < items.length) {
      const idx = currentIndex;
      currentIndex += 1;
      results[idx] = await fn(items[idx]!);
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, items.length) }, () => worker());
  await Promise.all(workers);
  return results;
}
