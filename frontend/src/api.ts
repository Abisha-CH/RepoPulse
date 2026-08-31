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
  linesChanged: number;
  ciStatus: 'success' | 'failure' | 'pending' | null;
}

export interface CiSizeBucket {
  key: 'small' | 'medium' | 'large';
  label: string;
  sizeRange: string;
  prCount: number;
  ciFailureCount: number;
  ciPassCount: number;
  ciUnknownCount: number;
  failureRate: number | null;
}

export interface CiByPrSize {
  hasCiData: boolean;
  buckets: CiSizeBucket[];
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
    ciByPrSize: CiByPrSize;
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
    let errorDetail = '';

    try {
      const data = (await res.json()) as { error?: string; rateLimitReset?: string };
      if (res.status === 429 && data.rateLimitReset) {
        const resetTime = new Date(data.rateLimitReset).toLocaleTimeString();
        throw new Error(`GitHub API rate limit hit. Reset expected at ${resetTime}. ${data.error ?? ''}`);
      }
      errorDetail = data.error ?? '';
    } catch (err) {
      if (err instanceof Error && err.message.includes('rate limit')) {
        throw err;
      }
      // If response is HTML (e.g., ngrok tunnel or reverse proxy timeout 503/504)
      if (res.status === 503) {
        errorDetail =
          'Sync request timed out (503 Service Unavailable). If testing through ngrok, the request exceeded the 60-second tunnel timeout. Try testing directly on http://localhost:5173 or re-syncing.';
      } else if (res.status === 504) {
        errorDetail = 'Gateway Timeout (504). The server took too long to complete the sync operation.';
      } else {
        errorDetail = `Server returned HTTP ${res.status}: ${res.statusText || 'Unknown Error'}`;
      }
    }

    throw new Error(errorDetail || `Failed to sync repository (${res.status})`);
  }

  return (await res.json()) as { success: boolean; count: number; message: string };
}

/**
 * Send the repo's current metrics as a digest to the configured Slack channel.
 */
export async function sendDigest(repoId: string): Promise<{ success: boolean; message: string }> {
  const res = await fetch(`/repos/${encodeURIComponent(repoId)}/send-digest`, {
    method: 'POST',
  });

  if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(data.error ?? `Failed to send digest to Slack (${res.status})`);
  }

  return (await res.json()) as { success: boolean; message: string };
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

// ── Public Leaderboard ─────────────────────────────────────────────────────

export interface LeaderboardComponent {
  label: string;
  weightPct: number;
  included: boolean;
  raw: number | null;
  formatted: string | null;
  subScore: number | null;
}

export interface LeaderboardComponents {
  timeToMerge: LeaderboardComponent;
  staleRate: LeaderboardComponent;
  busFactor: LeaderboardComponent;
  ciFailureRate: LeaderboardComponent;
}

export interface LeaderboardEntry {
  rank: number;
  repo: { id: string; owner: string; name: string; fullName: string };
  healthScore: number | null;
  includedWeightPct: number;
  components: LeaderboardComponents;
  metrics: {
    timeToMerge: {
      averageHours: number | null;
      formatted: string;
      sampleSize: number;
    };
    stalePrs: {
      staleCount: number;
      openCount: number;
      staleRatePct: number | null;
    };
    busFactor: {
      risk: 'High' | 'Moderate' | 'Low' | 'Insufficient Data';
      top2SharePercentage: number;
    };
    ciOverall: {
      failureRatePct: number | null;
      decidedCount: number;
    };
    summary: {
      totalPrs: number;
      openPrs: number;
      mergedPrs: number;
      closedPrs: number;
    };
  };
}

export interface PublicLeaderboardResponse {
  totalRepos: number;
  generatedAt: string;
  leaderboard: LeaderboardEntry[];
}

/**
 * Fetch the public leaderboard — no auth required.
 */
export async function fetchPublicLeaderboard(): Promise<PublicLeaderboardResponse> {
  const res = await fetch('/public/leaderboard');
  if (!res.ok) {
    throw new Error(`Failed to fetch leaderboard (${res.status})`);
  }
  return (await res.json()) as PublicLeaderboardResponse;
}
