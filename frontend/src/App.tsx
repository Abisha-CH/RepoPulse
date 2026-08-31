import React, { useCallback, useEffect, useState } from 'react';
import {
  fetchMe,
  fetchConnectedRepos,
  fetchUserGitHubRepos,
  connectRepo,
  syncRepo,
  fetchRepoMetrics,
  fetchInsights,
  regenerateInsights,
  fetchHealthReport,
  sendDigest,
  logoutUser,
  type MeResponse,
  type ConnectedRepo,
  type GitHubRepoOption,
  type RepoMetricsResponse,
  type InsightsResponse,
  type HealthReportResponse,
} from './api';

type AuthState =
  | { status: 'loading' }
  | { status: 'loggedOut' }
  | { status: 'loggedIn'; user: MeResponse };

export default function App() {
  const [authState, setAuthState] = useState<AuthState>({ status: 'loading' });
  const [connectedRepos, setConnectedRepos] = useState<ConnectedRepo[]>([]);
  const [selectedRepoId, setSelectedRepoId] = useState<string | null>(null);
  const [githubRepos, setGithubRepos] = useState<GitHubRepoOption[]>([]);
  const [metricsData, setMetricsData] = useState<RepoMetricsResponse | null>(null);

  // UI state
  const [isConnecting, setIsConnecting] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [isSendingDigest, setIsSendingDigest] = useState(false);
  const [isLoadingMetrics, setIsLoadingMetrics] = useState(false);
  const [showConnectForm, setShowConnectForm] = useState(false);
  const [repoInput, setRepoInput] = useState('');
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [showStaleList, setShowStaleList] = useState(false);
  const [insightsData, setInsightsData] = useState<InsightsResponse | null>(null);
  const [isLoadingInsights, setIsLoadingInsights] = useState(false);
  const [isRegeneratingInsights, setIsRegeneratingInsights] = useState(false);
  const [insightsError, setInsightsError] = useState<string | null>(null);
  const [healthReportData, setHealthReportData] = useState<HealthReportResponse | null>(null);
  const [isLoadingReport, setIsLoadingReport] = useState(false);
  const [reportError, setReportError] = useState<string | null>(null);
  const [showReport, setShowReport] = useState(false);

  const handleLogout = async () => {
    try {
      await logoutUser();
      setAuthState({ status: 'loggedOut' });
      setConnectedRepos([]);
      setSelectedRepoId(null);
      setMetricsData(null);
    } catch (err) {
      console.error('Logout error:', err);
    }
  };

  const refreshAuth = useCallback(async () => {
    setAuthState({ status: 'loading' });
    try {
      const me = await fetchMe();
      if (me) {
        setAuthState({ status: 'loggedIn', user: me });
      } else {
        setAuthState({ status: 'loggedOut' });
      }
    } catch (err) {
      setAuthState({ status: 'loggedOut' });
      console.error('Auth error:', err);
    }
  }, []);

  useEffect(() => {
    void refreshAuth();
  }, [refreshAuth]);

  // Load connected repos and user GitHub repos after login
  const loadRepos = useCallback(async () => {
    if (authState.status !== 'loggedIn') return;
    try {
      const [connected, userGhRepos] = await Promise.all([
        fetchConnectedRepos(),
        fetchUserGitHubRepos(),
      ]);
      setConnectedRepos(connected);
      setGithubRepos(userGhRepos);

      if (connected.length > 0 && !selectedRepoId) {
        setSelectedRepoId(connected[0].id);
      }
    } catch (err) {
      console.error('Failed to load repositories:', err);
    }
  }, [authState.status, selectedRepoId]);

  useEffect(() => {
    if (authState.status === 'loggedIn') {
      void loadRepos();
    }
  }, [authState.status, loadRepos]);

  // Load metrics when selected repo changes
  const loadMetrics = useCallback(async (repoId: string) => {
    setIsLoadingMetrics(true);
    setErrorMessage(null);
    try {
      const data = await fetchRepoMetrics(repoId);
      setMetricsData(data);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setErrorMessage(msg);
      setMetricsData(null);
    } finally {
      setIsLoadingMetrics(false);
    }
  }, []);

  // Load AI insights (runs after metrics load; silently handles missing GEMINI_API_KEY).
  const loadInsights = useCallback(async (repoId: string) => {
    setIsLoadingInsights(true);
    setInsightsError(null);
    try {
      const data = await fetchInsights(repoId);
      setInsightsData(data);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      // 501 = GEMINI_API_KEY not configured — show a friendly note, not a red error.
      if (msg.includes('501') || msg.includes('not available') || msg.includes('not configured')) {
        setInsightsError('__NOT_CONFIGURED__');
      } else {
        setInsightsError(msg);
      }
      setInsightsData(null);
    } finally {
      setIsLoadingInsights(false);
    }
  }, []);

  useEffect(() => {
    if (selectedRepoId) {
      setInsightsData(null); // clear old repo's insights immediately
      setShowReport(false); // close report view
      setHealthReportData(null);
      void loadMetrics(selectedRepoId);
      void loadInsights(selectedRepoId);
    } else {
      setMetricsData(null);
      setInsightsData(null);
      setShowReport(false);
      setHealthReportData(null);
    }
  }, [selectedRepoId, loadMetrics, loadInsights]);

  const handleRegenerateInsights = async () => {
    if (!selectedRepoId) return;
    setIsRegeneratingInsights(true);
    setInsightsError(null);
    try {
      const data = await regenerateInsights(selectedRepoId);
      setInsightsData(data);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setInsightsError(msg);
    } finally {
      setIsRegeneratingInsights(false);
    }
  };

  const handleGenerateReport = async () => {
    if (!selectedRepoId) return;
    setIsLoadingReport(true);
    setReportError(null);
    setShowReport(true);
    try {
      const data = await fetchHealthReport(selectedRepoId);
      setHealthReportData(data);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setReportError(msg);
      setHealthReportData(null);
    } finally {
      setIsLoadingReport(false);
    }
  };

  const handleConnect = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!repoInput.trim()) return;

    setIsConnecting(true);
    setErrorMessage(null);
    setStatusMessage(null);

    try {
      const newRepo = await connectRepo({ repo: repoInput.trim() });
      setStatusMessage(`Connected ${newRepo.fullName} successfully!`);
      setRepoInput('');
      setShowConnectForm(false);

      // Refresh list & select new repo
      const updatedList = await fetchConnectedRepos();
      setConnectedRepos(updatedList);
      setSelectedRepoId(newRepo.id);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setErrorMessage(`Failed to connect repository: ${msg}`);
    } finally {
      setIsConnecting(false);
    }
  };

  const handleSync = async () => {
    if (!selectedRepoId) return;

    setIsSyncing(true);
    setErrorMessage(null);
    setStatusMessage('Syncing Pull Requests and reviews from GitHub...');

    try {
      const res = await syncRepo(selectedRepoId);
      setStatusMessage(res.message);
      // Reload metrics and repo counts
      await Promise.all([loadMetrics(selectedRepoId), loadRepos()]);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setErrorMessage(`Sync failed: ${msg}`);
      setStatusMessage(null);
    } finally {
      setIsSyncing(false);
    }
  };

  const handleSendDigest = async () => {
    if (!selectedRepoId) return;

    setIsSendingDigest(true);
    setErrorMessage(null);
    setStatusMessage('Sending digest to Slack…');

    try {
      const res = await sendDigest(selectedRepoId);
      setStatusMessage(res.message);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setErrorMessage(`Failed to send digest: ${msg}`);
      setStatusMessage(null);
    } finally {
      setIsSendingDigest(false);
    }
  };

  if (authState.status === 'loading') {
    return (
      <div className="card loading-card">
        <div className="spinner" />
        <p className="status">Checking session…</p>
      </div>
    );
  }

  if (authState.status === 'loggedOut') {
    return (
      <div className="card login-card">
        <div className="brand-header">
          <div className="logo-icon">📊</div>
          <h1>RepoPulse</h1>
        </div>
        <p className="subtitle">GitHub Engineering Health & Velocity Dashboard</p>
        <button
          type="button"
          className="btn-primary login-btn"
          onClick={() => {
            window.location.href = '/auth/github/login';
          }}
        >
          <svg className="github-icon" height="20" width="20" viewBox="0 0 16 16" fill="currentColor">
            <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
          </svg>
          Login with GitHub
        </button>
        <p className="login-footer">
          or <a href="/leaderboard" className="login-link">view the public leaderboard</a> without logging in
        </p>
      </div>
    );
  }

  const { user } = authState;
  const initials = user.username.slice(0, 2).toUpperCase();
  const selectedRepo = connectedRepos.find((r) => r.id === selectedRepoId);

  return (
    <div className="dashboard-container">
      {/* Top Navigation */}
      <header className="dashboard-header">
        <div className="brand">
          <span className="logo-icon">📊</span>
          <span className="brand-name">RepoPulse</span>
          <span className="badge-tag">Day 2</span>
        </div>
        <nav className="main-nav">
          <a href="/leaderboard" className="nav-link" title="Public repo health leaderboard">
            🏆 Leaderboard
          </a>
        </nav>
        <div className="user-profile">
          <div className="avatar">{initials}</div>
          <div className="user-details">
            <span className="username">{user.username}</span>
            <span className="user-email">{user.email ?? 'No public email'}</span>
          </div>
          <button
            type="button"
            className="btn-ghost logout-btn"
            title="Log out"
            onClick={handleLogout}
          >
            Log out
          </button>
        </div>
      </header>

      {/* Main Content Area */}
      <main className="dashboard-main">
        {/* Repo Connection & Selection Bar */}
        <section className="repo-bar-card">
          <div className="repo-selector-row">
            <div className="selector-group">
              <label htmlFor="repo-select">Repository:</label>
              {connectedRepos.length > 0 ? (
                <select
                  id="repo-select"
                  className="select-input"
                  value={selectedRepoId ?? ''}
                  onChange={(e) => setSelectedRepoId(e.target.value)}
                >
                  {connectedRepos.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.fullName} ({r.pullRequestCount} PRs)
                    </option>
                  ))}
                </select>
              ) : (
                <span className="no-repos-text">No repositories connected yet</span>
              )}
            </div>

            <div className="action-buttons">
              <button
                type="button"
                className="btn-secondary"
                onClick={() => setShowConnectForm(!showConnectForm)}
              >
                {showConnectForm ? 'Cancel' : '+ Connect Repo'}
              </button>

              {selectedRepo && (
                <button
                  type="button"
                  className="btn-primary sync-btn"
                  onClick={handleSync}
                  disabled={isSyncing}
                >
                  {isSyncing ? (
                    <>
                      <span className="btn-spinner" />
                      Syncing…
                    </>
                  ) : (
                    <>
                      <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" style={{ marginRight: 6 }}>
                        <path d="M1.705 8.005a.75.75 0 0 1 .834.656 5.5 5.5 0 0 0 9.592 2.97l-1.204-1.204a.25.25 0 0 1 .177-.427h3.646a.25.25 0 0 1 .25.25v3.646a.25.25 0 0 1-.427.177l-1.38-1.38A7.002 7.002 0 0 1 1.05 8.84a.75.75 0 0 1 .655-.835zm12.59-1.01a.75.75 0 0 1-.834-.656 5.5 5.5 0 0 0-9.592-2.97l1.204 1.204a.25.25 0 0 1-.177.427H1.25a.25.25 0 0 1-.25-.25V1.104a.25.25 0 0 1 .427-.177l1.38 1.38A7.002 7.002 0 0 1 14.95 7.16a.75.75 0 0 1-.655.835z" />
                      </svg>
                      Sync Now
                    </>
                  )}
                </button>
              )}

              {selectedRepo && (
                <button
                  type="button"
                  className="btn-secondary digest-btn"
                  onClick={handleSendDigest}
                  disabled={isSendingDigest}
                  title="Post this repo's current metrics to the configured Slack channel"
                >
                  {isSendingDigest ? (
                    <>
                      <span className="btn-spinner" />
                      Sending…
                    </>
                  ) : (
                    <>
                      <span style={{ marginRight: 6 }}>📤</span>
                      Send Digest to Slack
                    </>
                  )}
                </button>
              )}

              {selectedRepo && (
                <button
                  type="button"
                  className="btn-secondary report-btn"
                  onClick={handleGenerateReport}
                  disabled={isLoadingReport}
                  title="Generate a shareable engineering health report"
                >
                  {isLoadingReport ? (
                    <>
                      <span className="btn-spinner" />
                      Generating…
                    </>
                  ) : (
                    <>
                      <span style={{ marginRight: 6 }}>📋</span>
                      Health Report
                    </>
                  )}
                </button>
              )}
            </div>
          </div>

          {/* Connect New Repo Form */}
          {showConnectForm && (
            <form className="connect-form" onSubmit={handleConnect}>
              <div className="form-row">
                <input
                  type="text"
                  className="text-input"
                  placeholder="e.g. facebook/react or Abisha-CH/RepoPulse"
                  value={repoInput}
                  onChange={(e) => setRepoInput(e.target.value)}
                  list="user-github-repos"
                  autoFocus
                />
                <datalist id="user-github-repos">
                  {githubRepos.map((gh) => (
                    <option key={gh.id} value={gh.fullName} />
                  ))}
                </datalist>
                <button type="submit" className="btn-primary" disabled={isConnecting || !repoInput.trim()}>
                  {isConnecting ? 'Connecting…' : 'Connect'}
                </button>
              </div>
              <p className="input-hint">
                Type <code>owner/repository</code> or select one of your repositories from the suggestions.
              </p>
            </form>
          )}

          {/* Alerts / Feedback */}
          {statusMessage && <div className="alert alert-info">{statusMessage}</div>}
          {errorMessage && <div className="alert alert-danger">{errorMessage}</div>}
        </section>

        {/* Metrics Section */}
        {isLoadingMetrics && (
          <div className="card loading-metrics">
            <div className="spinner" />
            <p>Calculating engineering metrics…</p>
          </div>
        )}

        {!isLoadingMetrics && metricsData && (
          <>
            {/* 4 Stat Cards */}
            <div className="metrics-grid">
              {/* Stat 1: Time to First Review */}
              <div className="stat-card">
                <div className="stat-header">
                  <span className="stat-icon">⏱️</span>
                  <span className="stat-title">Avg Time to First Review</span>
                </div>
                <div className="stat-value">{metricsData.metrics.timeToFirstReview.formatted}</div>
                <div className="stat-subtext">
                  {metricsData.metrics.timeToFirstReview.sampleSize > 0
                    ? `Based on ${metricsData.metrics.timeToFirstReview.sampleSize} reviewed PRs`
                    : 'No review timestamps recorded'}
                </div>
              </div>

              {/* Stat 2: Time to Merge */}
              <div className="stat-card">
                <div className="stat-header">
                  <span className="stat-icon">🚀</span>
                  <span className="stat-title">Avg Time to Merge</span>
                </div>
                <div className="stat-value">{metricsData.metrics.timeToMerge.formatted}</div>
                <div className="stat-subtext">
                  {metricsData.metrics.timeToMerge.sampleSize > 0
                    ? `Based on ${metricsData.metrics.timeToMerge.sampleSize} merged PRs`
                    : 'No merged PRs yet'}
                </div>
              </div>

              {/* Stat 3: Stale PRs */}
              <div className="stat-card">
                <div className="stat-header">
                  <span className="stat-icon">⚠️</span>
                  <span className="stat-title">Stale Open PRs</span>
                  {metricsData.metrics.stalePrs.staleCount > 0 && (
                    <button
                      type="button"
                      className="btn-link"
                      onClick={() => setShowStaleList(!showStaleList)}
                    >
                      {showStaleList ? 'Hide details' : 'View list'}
                    </button>
                  )}
                </div>
                <div className="stat-value">
                  {metricsData.metrics.stalePrs.staleCount}
                  <span className="stat-denom"> / {metricsData.metrics.stalePrs.openCount} open</span>
                </div>
                <div className="stat-subtext">
                  {metricsData.metrics.stalePrs.staleCount > 0
                    ? `Open for > ${metricsData.metrics.stalePrs.staleThresholdDays} days without merge`
                    : 'No open PRs currently exceeding 7 days'}
                </div>
              </div>

              {/* Stat 4: Bus Factor Score */}
              <div className="stat-card">
                <div className="stat-header">
                  <span className="stat-icon">👥</span>
                  <span className="stat-title">Bus Factor / Concentration</span>
                  <span className={`risk-badge risk-${metricsData.metrics.busFactor.risk.toLowerCase().replace(/\s+/g, '-')}`}>
                    {metricsData.metrics.busFactor.risk}
                  </span>
                </div>
                <div className="stat-value">
                  {metricsData.metrics.busFactor.top1SharePercentage}%
                  <span className="stat-denom"> top author share</span>
                </div>
                <div className="stat-subtext">
                  {metricsData.metrics.busFactor.description}
                </div>
              </div>
            </div>

            {/* ─── AI Insights ─────────────────────────────────────────────────── */}
            <div className="card insights-card">
              <div className="insights-header">
                <div className="insights-title-row">
                  <span className="insights-icon">🤖</span>
                  <h3>AI Insights</h3>
                  {insightsData?.cached && (
                    <span className="tag tag-cached" title="Served from cache — re-sync or click regenerate to refresh">cached</span>
                  )}
                </div>
                <button
                  type="button"
                  className="btn-secondary regenerate-btn"
                  onClick={handleRegenerateInsights}
                  disabled={isRegeneratingInsights || isLoadingInsights}
                  title="Generate fresh insights from Gemini"
                >
                  {isRegeneratingInsights ? (
                    <>
                      <span className="btn-spinner" />
                      Generating…
                    </>
                  ) : (
                    <>
                      <span style={{ marginRight: 5 }}>🔄</span>
                      Regenerate
                    </>
                  )}
                </button>
              </div>

              {isLoadingInsights && (
                <div className="insights-loading">
                  <div className="spinner" />
                  <p>Analyzing repository health with Gemini…</p>
                </div>
              )}

              {!isLoadingInsights && insightsError === '__NOT_CONFIGURED__' && (
                <div className="insights-not-configured">
                  <p>
                    AI insights are not enabled. Add <code>GEMINI_API_KEY</code> to <code>backend/.env</code> to activate this feature.
                  </p>
                </div>
              )}

              {!isLoadingInsights && insightsError && insightsError !== '__NOT_CONFIGURED__' && (
                <div className="insights-error">
                  <p>⚠️ {insightsError}</p>
                  <button type="button" className="btn-link" onClick={handleRegenerateInsights}>
                    Try again
                  </button>
                </div>
              )}

              {!isLoadingInsights && insightsData && (
                <div className="insights-list">
                  {insightsData.insight.observations.map((obs, idx) => (
                    <div key={idx} className={`insight-row severity-${obs.severity}`}>
                      <div className="insight-head">
                        <span className={`severity-badge severity-${obs.severity}`}>
                          {obs.severity}
                        </span>
                        <span className="insight-finding">{obs.finding}</span>
                      </div>
                      <div className="insight-body">
                        <div className="insight-field">
                          <span className="field-label">Evidence:</span> {obs.evidence}
                        </div>
                        <div className="insight-field">
                          <span className="field-label">Recommendation:</span> {obs.recommendation}
                        </div>
                      </div>
                    </div>
                  ))}
                  <div className="insights-footer">
                    Generated {new Date(insightsData.generatedAt).toLocaleString()}
                    {insightsData.cached ? ' (cached)' : ''}
                  </div>
                </div>
              )}
            </div>

            {/* ─── Health Report Overlay ─────────────────────────────────────────── */}
            {showReport && (
              <div className="health-report-overlay" onClick={() => setShowReport(false)}>
                <div className="health-report" onClick={(e) => e.stopPropagation()}>
                  <div className="report-actions-top">
                    <button type="button" className="btn-ghost" onClick={() => window.print()} title="Print or save as PDF">
                      🖨️ Print / Export PDF
                    </button>
                    <button type="button" className="btn-ghost" onClick={() => setShowReport(false)} title="Close report">
                      ✕ Close
                    </button>
                  </div>

                  {isLoadingReport && (
                    <div className="report-loading">
                      <div className="spinner" />
                      <p>Generating health report…</p>
                    </div>
                  )}

                  {!isLoadingReport && reportError && (
                    <div className="report-error">
                      <p>⚠️ {reportError}</p>
                      <button type="button" className="btn-primary" onClick={handleGenerateReport}>
                        Retry
                      </button>
                    </div>
                  )}

                  {!isLoadingReport && healthReportData && (
                    <>
                      {/* Report Header */}
                      <div className="report-header">
                        <h2>Engineering Health Report</h2>
                        <div className="report-repo-name">{healthReportData.repo.fullName}</div>
                        <div className="report-timestamp">
                          Generated {new Date(healthReportData.generatedAt).toLocaleString()}
                        </div>
                      </div>

                      {/* Overall Score Circle */}
                      <div className="overall-score-section">
                        <div
                          className="overall-score-circle"
                          style={{
                            background: healthReportData.overallScore.score !== null
                              ? `conic-gradient(var(--green) ${healthReportData.overallScore.score * 3.6}deg, var(--border) 0deg)`
                              : 'var(--border)',
                          }}
                        >
                          <div className="overall-score-inner">
                            <span className="overall-score-number">
                              {healthReportData.overallScore.score !== null
                                ? healthReportData.overallScore.score
                                : '—'}
                            </span>
                            <span className="overall-score-label">Overall Health</span>
                          </div>
                        </div>
                      </div>

                      {/* Category Breakdown */}
                      <div className="category-grid">
                        {Object.entries(healthReportData.categories).map(([key, cat]) => (
                          <div key={key} className="category-card">
                            <div className="category-header">
                              <span className="category-label">{cat.label}</span>
                              <span className="category-score">{cat.score !== null ? cat.score : '—'}</span>
                            </div>
                            <div className="score-bar-track">
                              <div
                                className={`score-bar-fill ${
                                  cat.score !== null
                                    ? cat.score >= 70
                                      ? 'score-green'
                                      : cat.score >= 40
                                        ? 'score-amber'
                                        : 'score-red'
                                    : ''
                                }`}
                                style={{ width: cat.score !== null ? `${cat.score}%` : '0%' }}
                              />
                            </div>
                            {cat.raw && <div className="category-raw">{cat.raw}</div>}
                            <div className="category-desc">{cat.description}</div>
                          </div>
                        ))}
                      </div>

                      {/* AI Insights / Top Risks */}
                      {healthReportData.insights && healthReportData.insights.observations.length > 0 && (
                        <div className="report-insights">
                          <h3>Top Risks & Recommendations</h3>
                          <div className="insights-list">
                            {healthReportData.insights.observations.map((obs, idx) => (
                              <div key={idx} className={`insight-row severity-${obs.severity}`}>
                                <div className="insight-head">
                                  <span className={`severity-badge severity-${obs.severity}`}>
                                    {obs.severity}
                                  </span>
                                  <span className="insight-finding">{obs.finding}</span>
                                </div>
                                <div className="insight-body">
                                  <div className="insight-field">
                                    <span className="field-label">Evidence:</span> {obs.evidence}
                                  </div>
                                  <div className="insight-field">
                                    <span className="field-label">Recommendation:</span> {obs.recommendation}
                                  </div>
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Summary */}
                      <div className="report-summary">
                        <span>{healthReportData.summary.totalPrs} total PRs</span>
                        <span className="summary-sep">·</span>
                        <span>{healthReportData.summary.openPrs} open</span>
                        <span className="summary-sep">·</span>
                        <span>{healthReportData.summary.mergedPrs} merged</span>
                        <span className="summary-sep">·</span>
                        <span>{healthReportData.summary.closedPrs} closed</span>
                      </div>
                    </>
                  )}
                </div>
              </div>
            )}

            {/* Stale PRs Detail Drawer */}
            {showStaleList && metricsData.metrics.stalePrs.staleCount > 0 && (
              <div className="card stale-card">
                <div className="stale-card-header">
                  <h3>⚠️ Stale Pull Requests (&gt; 7 Days Open)</h3>
                  <button type="button" className="btn-link" onClick={() => setShowStaleList(false)}>
                    Close
                  </button>
                </div>
                <div className="stale-list">
                  {metricsData.metrics.stalePrs.stalePrs.map((stale) => (
                    <div key={stale.githubPrId} className="stale-item">
                      <div className="stale-info">
                        <span className="pr-number">#{stale.githubPrId}</span>
                        <span className="stale-title">{stale.title}</span>
                        <span className="stale-author">@{stale.author}</span>
                      </div>
                      <div className="stale-age">
                        <span className="stale-badge">{stale.daysOpen} days open</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Bus Factor Breakdown & Methodology Banner */}
            <div className="card breakdown-card">
              <h3>PR Author Concentration Breakdown</h3>
              <p className="methodology-note">
                💡 <strong>Methodology Note:</strong> {metricsData.metrics.busFactor.methodologyTradeoff}
              </p>
              {metricsData.metrics.busFactor.topContributors.length > 0 ? (
                <div className="contributors-list">
                  {metricsData.metrics.busFactor.topContributors.map((c, idx) => (
                    <div key={c.author} className="contributor-item">
                      <div className="contributor-info">
                        <span className="rank">#{idx + 1}</span>
                        <span className="author-name">{c.author}</span>
                        <span className="pr-count">({c.count} PRs)</span>
                      </div>
                      <div className="progress-bar-container">
                        <div className="progress-bar-fill" style={{ width: `${c.percentage}%` }} />
                        <span className="percent-label">{c.percentage}%</span>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="empty-subtext">No merged PRs available to calculate contributor concentration.</p>
              )}
            </div>

            {/* CI Failure Rate by PR Size */}
            <div className="card breakdown-card">
              <div className="table-header-row">
                <h3>CI Failure Rate by PR Size</h3>
                {metricsData.metrics.ciByPrSize.hasCiData && (
                  <div className="pr-counts-summary">
                    <span className="tag tag-open">{metricsData.metrics.summary.totalPrs} PRs tracked</span>
                  </div>
                )}
              </div>
              <p className="methodology-note">
                💡 <strong>Methodology Note:</strong> CI status comes from GitHub Checks on each PR's head
                commit (failing = a completed run concluded failure / timed_out / action_required). Failure
                rate = failing ÷ (failing + passing). PRs with no checks or still-pending runs are counted as
                unknown.
              </p>
              {metricsData.metrics.ciByPrSize.hasCiData ? (
                <div className="ci-bucket-table">
                  <div className="ci-bucket-row ci-bucket-head">
                    <span>PR Size</span>
                    <span>PRs</span>
                    <span>Passing</span>
                    <span>Failing</span>
                    <span>No CI</span>
                    <span>Failure Rate</span>
                  </div>
                  {metricsData.metrics.ciByPrSize.buckets.map((b) => (
                    <div key={b.key} className="ci-bucket-row">
                      <span className="ci-bucket-name">
                        {b.label}
                        <span className="ci-bucket-range">{b.sizeRange}</span>
                      </span>
                      <span>{b.prCount}</span>
                      <span className="ci-pass">{b.ciPassCount}</span>
                      <span className="ci-fail">{b.ciFailureCount}</span>
                      <span className="ci-unknown-text">{b.ciUnknownCount}</span>
                      <span>
                        {b.failureRate !== null ? (
                          <span
                            className={`risk-badge ${
                              b.failureRate >= 30
                                ? 'risk-high'
                                : b.failureRate > 0
                                  ? 'risk-moderate'
                                  : 'risk-low'
                            }`}
                          >
                            {b.failureRate}%
                          </span>
                        ) : (
                          <span className="ci-unknown-text">n/a</span>
                        )}
                      </span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="empty-subtext">
                  No CI data yet — run <strong>Sync Now</strong> to fetch check status per pull request.
                </p>
              )}
            </div>

            {/* PR Activity Table */}
            <div className="card table-card">
              <div className="table-header-row">
                <h3>Recent Pull Requests ({metricsData.metrics.summary.totalPrs} total)</h3>
                <div className="pr-counts-summary">
                  <span className="tag tag-open">{metricsData.metrics.summary.openPrs} Open</span>
                  <span className="tag tag-merged">{metricsData.metrics.summary.mergedPrs} Merged</span>
                  <span className="tag tag-closed">{metricsData.metrics.summary.closedPrs} Closed</span>
                </div>
              </div>

              {metricsData.recentPullRequests.length > 0 ? (
                <div className="table-responsive">
                  <table className="pr-table">
                    <thead>
                      <tr>
                        <th>#</th>
                        <th>Title</th>
                        <th>Author</th>
                        <th>State</th>
                        <th>CI</th>
                        <th>Lines</th>
                        <th>Time to Review</th>
                        <th>Time to Merge</th>
                        <th>Opened Date</th>
                      </tr>
                    </thead>
                    <tbody>
                      {metricsData.recentPullRequests.map((pr) => (
                        <tr key={pr.id}>
                          <td className="pr-number">#{pr.number}</td>
                          <td className="pr-title">{pr.title}</td>
                          <td className="pr-author">@{pr.author}</td>
                          <td>
                            <span className={`state-pill state-${pr.state}`}>
                              {pr.state}
                            </span>
                          </td>
                          <td>
                            <span
                              className={`ci-pill ci-${pr.ciStatus ?? 'unknown'}`}
                              title={
                                pr.ciStatus === null
                                  ? 'No checks recorded'
                                  : `CI ${pr.ciStatus}`
                              }
                            >
                              {pr.ciStatus === 'failure'
                                ? '✗ failing'
                                : pr.ciStatus === 'success'
                                  ? '✓ passing'
                                  : pr.ciStatus === 'pending'
                                    ? '… pending'
                                    : '—'}
                            </span>
                          </td>
                          <td className="metric-cell lines-cell">
                            {pr.linesChanged.toLocaleString()}
                          </td>
                          <td className="metric-cell">{pr.timeToReviewFormatted}</td>
                          <td className="metric-cell">{pr.timeToMergeFormatted}</td>
                          <td className="date-cell">
                            {new Date(pr.openedAt).toLocaleDateString()}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="empty-table-state">
                  <p>No pull requests found in database.</p>
                  <button type="button" className="btn-primary" onClick={handleSync} disabled={isSyncing}>
                    {isSyncing ? 'Syncing…' : 'Sync PRs from GitHub Now'}
                  </button>
                </div>
              )}
            </div>
          </>
        )}

        {/* Empty state when no repo selected */}
        {!selectedRepo && connectedRepos.length === 0 && (
          <div className="card empty-dashboard">
            <div className="empty-icon">🔌</div>
            <h2>No Repositories Connected</h2>
            <p>Connect your first GitHub repository above to pull Pull Requests and start viewing metrics.</p>
            <button
              type="button"
              className="btn-primary"
              onClick={() => setShowConnectForm(true)}
            >
              + Connect a Repo
            </button>
          </div>
        )}
      </main>
    </div>
  );
}
