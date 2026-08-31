import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';

// ── Mocks (must use vi.hoisted so they exist when vi.mock factories run) ────

const { mockPrisma, mockGenerateInsights, MockInsightsError } = vi.hoisted(() => {
  class MockInsightsError extends Error {
    code: string;
    constructor(message: string, code: string) {
      super(message);
      this.code = code;
      this.name = 'InsightsError';
    }
  }
  return {
    mockPrisma: {
      repo: { findFirst: vi.fn() },
      pullRequest: { findMany: vi.fn() },
      insight: { findFirst: vi.fn(), create: vi.fn() },
    },
    mockGenerateInsights: vi.fn(),
    MockInsightsError,
  };
});

vi.mock('../db', () => ({ prisma: mockPrisma }));

vi.mock('../insights/generate', () => ({
  generateInsights: (...args: unknown[]) => mockGenerateInsights(...args),
  InsightsError: MockInsightsError,
}));

vi.mock('../auth/middleware', () => ({
  requireAuth: (req: express.Request, _res: express.Response, next: express.NextFunction) => {
    (req as unknown as { userId: string }).userId = 'test-user';
    next();
  },
}));

// ── Import after mocks ──────────────────────────────────────────────────────
import { insightsRouter } from './insights';

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use(insightsRouter);
  return app;
}

const REPO_ID = 'repo-123';
const REPO_RECORD = { id: REPO_ID, connected_by_user_id: 'test-user', owner: 'honojs', name: 'hono' };

const MOCK_PRS = [
  { id: '1', reviewers: [], opened_at: new Date(), first_review_at: new Date(), merged_at: new Date(), additions: 50, deletions: 20, ci_status: 'success' },
  { id: '2', reviewers: [], opened_at: new Date(), first_review_at: null, merged_at: new Date(), additions: 10, deletions: 5, ci_status: 'failure' },
];

const MOCK_INSIGHT = {
  observations: [
    { finding: 'Test finding', evidence: 'Test evidence', recommendation: 'Test recommendation', severity: 'medium' },
  ],
};

beforeEach(() => {
  vi.clearAllMocks();
  // Set a GEMINI_API_KEY by default so success-path tests pass; the 501 tests
  // delete it explicitly to trigger the "not configured" branch.
  process.env.GEMINI_API_KEY = 'test-key';
  mockPrisma.repo.findFirst.mockResolvedValue(REPO_RECORD);
  mockPrisma.pullRequest.findMany.mockResolvedValue(MOCK_PRS);
});

// ── GET /repos/:id/insights ────────────────────────────────────────────────

describe('GET /repos/:id/insights', () => {
  it('returns cached insight when pr_snapshot matches', async () => {
    const cachedInsight = {
      result: MOCK_INSIGHT,
      generated_at: new Date('2026-08-30T00:00:00Z'),
      pr_snapshot: 2,
    };
    mockPrisma.insight.findFirst.mockResolvedValue(cachedInsight);

    const res = await request(makeApp()).get(`/repos/${REPO_ID}/insights`);

    expect(res.status).toBe(200);
    expect(res.body.cached).toBe(true);
    expect(res.body.insight).toEqual(MOCK_INSIGHT);
    expect(mockGenerateInsights).not.toHaveBeenCalled();
  });

  it('generates fresh insight when cache is stale', async () => {
    const staleInsight = { result: MOCK_INSIGHT, generated_at: new Date(), pr_snapshot: 1 };
    mockPrisma.insight.findFirst.mockResolvedValue(staleInsight);
    mockGenerateInsights.mockResolvedValue(MOCK_INSIGHT);
    mockPrisma.insight.create.mockResolvedValue({ id: 'new', result: MOCK_INSIGHT, generated_at: new Date(), pr_snapshot: 2 });

    const res = await request(makeApp()).get(`/repos/${REPO_ID}/insights`);

    expect(res.status).toBe(200);
    expect(res.body.cached).toBe(false);
    expect(mockGenerateInsights).toHaveBeenCalledOnce();
  });

  it('generates fresh insight when no cache exists', async () => {
    mockPrisma.insight.findFirst.mockResolvedValue(null);
    mockGenerateInsights.mockResolvedValue(MOCK_INSIGHT);
    mockPrisma.insight.create.mockResolvedValue({ id: 'new', result: MOCK_INSIGHT, generated_at: new Date(), pr_snapshot: 2 });

    const res = await request(makeApp()).get(`/repos/${REPO_ID}/insights`);

    expect(res.status).toBe(200);
    expect(res.body.cached).toBe(false);
    expect(mockGenerateInsights).toHaveBeenCalledOnce();
  });

  it('returns 404 for unknown repo', async () => {
    mockPrisma.repo.findFirst.mockResolvedValue(null);

    const res = await request(makeApp()).get('/repos/unknown/insights');
    expect(res.status).toBe(404);
  });

  it('returns 501 when GEMINI_API_KEY is missing', async () => {
    delete process.env.GEMINI_API_KEY;

    const res = await request(makeApp()).get(`/repos/${REPO_ID}/insights`);
    expect(res.status).toBe(501);
    expect(res.body.error).toContain('GEMINI_API_KEY');
  });

  it('returns 502 when Gemini call fails', async () => {
    mockPrisma.insight.findFirst.mockResolvedValue(null);
    mockGenerateInsights.mockRejectedValue(new MockInsightsError('Rate limited', 'RATE_LIMITED'));

    const res = await request(makeApp()).get(`/repos/${REPO_ID}/insights`);
    expect(res.status).toBe(502);
    expect(res.body.code).toBe('RATE_LIMITED');
  });
});

// ── POST /repos/:id/insights/regenerate ─────────────────────────────────────

describe('POST /repos/:id/insights/regenerate', () => {
  it('always generates fresh insights ignoring cache', async () => {
    const staleInsight = { result: MOCK_INSIGHT, generated_at: new Date(), pr_snapshot: 99 };
    mockPrisma.insight.findFirst.mockResolvedValue(staleInsight);
    mockGenerateInsights.mockResolvedValue(MOCK_INSIGHT);
    mockPrisma.insight.create.mockResolvedValue({ id: 'new', result: MOCK_INSIGHT, generated_at: new Date(), pr_snapshot: 2 });

    const res = await request(makeApp()).post(`/repos/${REPO_ID}/insights/regenerate`);

    expect(res.status).toBe(200);
    expect(res.body.cached).toBe(false);
    expect(mockGenerateInsights).toHaveBeenCalledOnce();
  });

  it('returns 404 for unknown repo', async () => {
    mockPrisma.repo.findFirst.mockResolvedValue(null);

    const res = await request(makeApp()).post('/repos/unknown/insights/regenerate');
    expect(res.status).toBe(404);
  });

  it('returns 501 when GEMINI_API_KEY is missing', async () => {
    delete process.env.GEMINI_API_KEY;

    const res = await request(makeApp()).post(`/repos/${REPO_ID}/insights/regenerate`);
    expect(res.status).toBe(501);
  });
});
