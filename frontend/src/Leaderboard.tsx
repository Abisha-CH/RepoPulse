import { useEffect, useState } from 'react';
import {
  fetchPublicLeaderboard,
  type PublicLeaderboardResponse,
  type LeaderboardEntry,
} from './api';

/**
 * Static description of how the health score is weighted — kept in sync with
 * HEALTH_SCORE_CONFIG in backend/src/metrics/health.ts.
 */
const SCORE_METHODOLOGY = [
  {
    label: 'Time to Merge',
    weight: 30,
    best: '≤ 8 h',
    worst: '≥ 168 h (7 days)',
  },
  {
    label: 'Stale Open PRs',
    weight: 25,
    best: '0 %',
    worst: '≥ 50 % stale',
  },
  {
    label: 'Bus Factor (concentration)',
    weight: 20,
    best: '≤ 40 % top-2 share',
    worst: '100 % (single author)',
  },
  {
    label: 'CI Failure Rate',
    weight: 25,
    best: '0 %',
    worst: '≥ 40 %',
  },
] as const;

function rankBadge(rank: number): string {
  if (rank === 1) return '🥇';
  if (rank === 2) return '🥈';
  if (rank === 3) return '🥉';
  return `#${rank}`;
}

function scoreBand(score: number | null): { cls: string; label: string } {
  if (score === null) return { cls: 'score-null', label: '—' };
  if (score >= 70) return { cls: 'score-good', label: 'Healthy' };
  if (score >= 40) return { cls: 'score-fair', label: 'Fair' };
  return { cls: 'score-poor', label: 'Concerning' };
}

function HealthCell({ score }: { score: number | null }) {
  const { cls, label } = scoreBand(score);
  return (
    <div className="health-cell">
      <span className={`score-pill ${cls}`}>
        {score !== null ? Math.round(score) : '—'}
      </span>
      <span className={`score-band-label ${cls}`}>{label}</span>
      {score !== null && (
        <div className="score-bar">
          <div className={`score-bar-fill ${cls}`} style={{ width: `${score}%` }} />
        </div>
      )}
    </div>
  );
}

function formatPct(value: number | null, decimals = 1): string {
  return value !== null ? `${value.toFixed(decimals)}%` : '—';
}

export default function Leaderboard() {
  const [data, setData] = useState<PublicLeaderboardResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetchPublicLeaderboard();
        if (!cancelled) setData(res);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  if (loading) {
    return (
      <div className="leaderboard-page">
        <header className="leaderboard-header">
          <div className="leaderboard-brand">
            <span className="logo-icon">📊</span>
            <h1>Public Leaderboard</h1>
          </div>
          <a href="/" className="back-link">← Back to dashboard</a>
        </header>
        <div className="card loading-card">
          <div className="spinner" />
          <p className="status">Ranking repositories…</p>
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="leaderboard-page">
        <header className="leaderboard-header">
          <div className="leaderboard-brand">
            <span className="logo-icon">📊</span>
            <h1>Public Leaderboard</h1>
          </div>
          <a href="/" className="back-link">← Back to dashboard</a>
        </header>
        <div className="card loading-card">
          <div className="empty-icon">⚠️</div>
          <h2>Failed to load leaderboard</h2>
          <p>{error ?? 'Unknown error'}</p>
          <button type="button" className="btn-primary" onClick={() => window.location.reload()}>
            Retry
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="leaderboard-page">
      {/* Header */}
      <header className="leaderboard-header">
        <div className="leaderboard-brand">
          <span className="logo-icon">📊</span>
          <h1>Public Leaderboard</h1>
        </div>
        <a href="/" className="back-link">← Back to dashboard</a>
      </header>

      <p className="leaderboard-subtitle">
        Every repository synced to RepoPulse, ranked by an overall 0–100
        engineering health score. <strong>Higher is better.</strong>
      </p>

      {/* Leaderboard Table */}
      <div className="card table-card leaderboard-card">
        {data.leaderboard.length === 0 ? (
          <p className="empty-subtext">
            No repositories have been synced yet. Connect and sync a repo from
            the <a href="/">dashboard</a> to get started.
          </p>
        ) : (
          <div className="table-responsive">
            <table className="pr-table leaderboard-table">
              <thead>
                <tr>
                  <th className="col-rank">Rank</th>
                  <th className="col-repo">Repository</th>
                  <th className="col-health">Health</th>
                  <th>Merge Time</th>
                  <th>Stale Open</th>
                  <th>Bus Factor</th>
                  <th>CI Failure</th>
                  <th className="col-prs">PRs</th>
                </tr>
              </thead>
              <tbody>
                {data.leaderboard.map((entry: LeaderboardEntry) => (
                  <tr
                    key={entry.repo.id}
                    className={entry.healthScore === null ? 'row-no-data' : ''}
                  >
                    <td className="rank-cell">
                      <span className={`rank ${entry.rank <= 3 ? `rank-top-${entry.rank}` : ''}`}>
                        {rankBadge(entry.rank)}
                      </span>
                    </td>
                    <td className="repo-cell">
                      <span className="repo-fullname">{entry.repo.fullName}</span>
                    </td>
                    <td>
                      <HealthCell score={entry.healthScore} />
                    </td>
                    <td className="metric-cell">
                      {entry.metrics.timeToMerge.formatted}
                      {entry.metrics.timeToMerge.sampleSize > 0 && (
                        <span className="muted-sm">
                          {entry.metrics.timeToMerge.sampleSize} PRs
                        </span>
                      )}
                    </td>
                    <td className="metric-cell">
                      {formatPct(entry.metrics.stalePrs.staleRatePct)}
                      <span className="muted-sm">
                        {entry.metrics.stalePrs.staleCount}/{entry.metrics.stalePrs.openCount}
                      </span>
                    </td>
                    <td className="metric-cell">
                      {formatPct(entry.metrics.busFactor.top2SharePercentage)}
                      <span className={`risk-inline risk-${entry.metrics.busFactor.risk.toLowerCase().replace(/\s+/g, '-')}`}>
                        {entry.metrics.busFactor.risk}
                      </span>
                    </td>
                    <td className="metric-cell">
                      {formatPct(entry.metrics.ciOverall.failureRatePct)}
                      {entry.metrics.ciOverall.decidedCount > 0 && (
                        <span className="muted-sm">
                          {entry.metrics.ciOverall.decidedCount} decided
                        </span>
                      )}
                    </td>
                    <td className="metric-cell prs-cell">
                      {entry.metrics.summary.totalPrs}
                      <span className="muted-sm">
                        {entry.metrics.summary.openPrs} open · {entry.metrics.summary.mergedPrs} merged
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Methodology Card */}
      <div className="card methodology-card">
        <h3>How Scores Work</h3>
        <p className="methodology-note">
          💡 <strong>Health Score Formula:</strong> Each of four metrics is
          normalized to a 0–100 sub-score (higher = better) and combined as a
          weighted average. When a metric has no data for a repository, its weight
          is excluded and the remaining weights are renormalized.
        </p>
        <div className="methodology-table-wrapper">
          <table className="methodology-table">
            <thead>
              <tr>
                <th>Metric</th>
                <th>Weight</th>
                <th>Full Marks (100)</th>
                <th>Zero Marks (0)</th>
              </tr>
            </thead>
            <tbody>
              {SCORE_METHODOLOGY.map((row) => (
                <tr key={row.label}>
                  <td className="method-label">{row.label}</td>
                  <td className="method-weight">{row.weight}%</td>
                  <td className="method-best">{row.best}</td>
                  <td className="method-worst">{row.worst}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="methodology-note">
          Scores are computed from the latest synced PR data. Sync a repository
          from the <a href="/">dashboard</a> to refresh its metrics.
        </p>
      </div>

      {/* Footer note */}
      <p className="leaderboard-footer">
        Ranked {data.totalRepos} repository{data.totalRepos !== 1 ? 'ies' : 'y'} ·
        Generated {new Date(data.generatedAt).toLocaleString()}
      </p>
    </div>
  );
}