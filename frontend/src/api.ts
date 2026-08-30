export interface MeResponse {
  id: string;
  githubId: number;
  username: string;
  email: string | null;
  createdAt: string;
}

export interface ConnectedRepo {
  id: string;
  githubRepoId: number;
  owner: string;
  name: string;
  fullName: string;
  pullRequestCount: number;
}

export interface GitHubRepoOption {
  id: number;
  owner: string;
  name: string;
  fullName: string;
  description: string | null;
  isPrivate: boolean;
}

export interface TopContributor {
  author: string;
  count: number;
  percentage: number;
}

export interface StalePrDetail {
  githubPrId: number;
  title: string;
  author: string;
  daysOpen: number;
  openedAt: string;
}

export interface RecentPullRequest {
  id: string;
  number: number;
  title: string;
  author: string;
  state: 'open' | 'closed' | 'merged';
  openedAt: string;
  firstReviewAt: string | null;
  mergedAt: string | null;
  timeToReviewFormatted: string;
  timeToMergeFormatted: string;
  reviewerCount: number;
}

export interface RepoMetricsResponse {
  repo: {
    id: string;
    owner: string;
    name: string;
    fullName: string;
  };
  metrics: {
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
      topContributors: TopContributor[];
      methodologyTradeoff: string;
    };
    stalePrs: {
      staleCount: number;
      openCount: number;
      staleThresholdDays: number;
      stalePrs: StalePrDetail[];
    };
    summary: {
      totalPrs: number;
      openPrs: number;
      mergedPrs: number;
      closedPrs: number;
    };
  };
  recentPullRequests: RecentPullRequest[];
}

/**
 * Fetch the current user from /me. Returns null when unauthenticated (401).
 */
export async function fetchMe(): Promise<MeResponse | null> {
  const res = await fetch('/me');
  if (res.status === 401) {
    return null;
  }
  if (!res.ok) {
    throw new Error(`Failed to fetch /me (${res.status})`);
  }
  return (await res.json()) as MeResponse;
}

/**
 * Log out the current user by clearing the session cookie.
 */
export async function logoutUser(): Promise<void> {
  await fetch('/auth/github/logout', { method: 'POST' });
}

/**
 * List repos connected by the current user.
 */
export async function fetchConnectedRepos(): Promise<ConnectedRepo[]> {
  const res = await fetch('/repos');
  if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(data.error ?? `Failed to fetch connected repos (${res.status})`);
  }
  const data = (await res.json()) as { repos: ConnectedRepo[] };
  return data.repos;
}

/**
 * List the user's available repos on GitHub for quick selection.
 */
export async function fetchUserGitHubRepos(): Promise<GitHubRepoOption[]> {
  const res = await fetch('/user/github-repos');
  if (!res.ok) {
    return [];
  }
  const data = (await res.json()) as { repos: GitHubRepoOption[] };
  return data.repos;
}

/**
 * Connect a repository (owner/name or repo URL).
 */
export async function connectRepo(input: { owner?: string; name?: string; repo?: string }): Promise<ConnectedRepo> {
  const res = await fetch('/repos', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(data.error ?? `Failed to connect repository (${res.status})`);
  }
  const data = (await res.json()) as { repo: ConnectedRepo };
  return data.repo;
}

/**
 * Trigger an on-demand sync of Pull Requests and Reviews.
 */
export async function syncRepo(repoId: string): Promise<{ success: boolean; count: number; message: string }> {
  const res = await fetch(`/repos/${encodeURIComponent(repoId)}/sync`, {
    method: 'POST',
  });
  if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as { error?: string; rateLimitReset?: string };
    if (res.status === 429 && data.rateLimitReset) {
      const resetTime = new Date(data.rateLimitReset).toLocaleTimeString();
      throw new Error(`GitHub API rate limit hit. Reset expected at ${resetTime}. ${data.error ?? ''}`);
    }
    throw new Error(data.error ?? `Failed to sync repository (${res.status})`);
  }
  return (await res.json()) as { success: boolean; count: number; message: string };
}

/**
 * Fetch computed health metrics for a repository.
 */
export async function fetchRepoMetrics(repoId: string): Promise<RepoMetricsResponse> {
  const res = await fetch(`/repos/${encodeURIComponent(repoId)}/metrics`);
  if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(data.error ?? `Failed to fetch repo metrics (${res.status})`);
  }
  return (await res.json()) as RepoMetricsResponse;
}
