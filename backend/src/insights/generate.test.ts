import { describe, it, expect } from 'vitest';
import { parseInsightsResponse, InsightsError } from './generate';

describe('parseInsightsResponse', () => {
  const validPayload = {
    observations: [
      {
        finding: 'High bus factor risk',
        evidence: 'Top contributor accounts for 85% of merged PRs',
        recommendation: 'Encourage more contributors to review and merge PRs',
        severity: 'high',
      },
      {
        finding: 'Fast review turnaround',
        evidence: 'Average time to first review is 2.1 hours across 30 PRs',
        recommendation: 'Keep up the current review culture',
        severity: 'positive',
      },
    ],
  };

  it('parses valid JSON with correct structure', () => {
    const result = parseInsightsResponse(JSON.stringify(validPayload));
    expect(result.observations).toHaveLength(2);
    expect(result.observations[0].finding).toBe('High bus factor risk');
    expect(result.observations[0].severity).toBe('high');
    expect(result.observations[1].severity).toBe('positive');
  });

  it('strips Markdown code fences before parsing', () => {
    const fenced = '```json\n' + JSON.stringify(validPayload) + '\n```';
    const result = parseInsightsResponse(fenced);
    expect(result.observations).toHaveLength(2);
  });

  it('strips code fences without language tag', () => {
    const fenced = '```\n' + JSON.stringify(validPayload) + '\n```';
    const result = parseInsightsResponse(fenced);
    expect(result.observations).toHaveLength(2);
  });

  it('throws InsightsError on invalid JSON', () => {
    expect(() => parseInsightsResponse('not json at all')).toThrow(InsightsError);
    try {
      parseInsightsResponse('not json at all');
    } catch (err) {
      expect((err as InsightsError).code).toBe('INVALID_JSON');
    }
  });

  it('throws when observations field is missing', () => {
    const bad = JSON.stringify({ result: [] });
    expect(() => parseInsightsResponse(bad)).toThrow(InsightsError);
    try {
      parseInsightsResponse(bad);
    } catch (err) {
      expect((err as InsightsError).code).toBe('INVALID_STRUCTURE');
    }
  });

  it('throws when observations is not an array', () => {
    const bad = JSON.stringify({ observations: 'not an array' });
    expect(() => parseInsightsResponse(bad)).toThrow(InsightsError);
    try {
      parseInsightsResponse(bad);
    } catch (err) {
      expect((err as InsightsError).code).toBe('INVALID_STRUCTURE');
    }
  });

  it('throws when all observations have invalid severity', () => {
    const bad = {
      observations: [
        { finding: 'x', evidence: 'y', recommendation: 'z', severity: 'critical' },
      ],
    };
    expect(() => parseInsightsResponse(JSON.stringify(bad))).toThrow(InsightsError);
    try {
      parseInsightsResponse(JSON.stringify(bad));
    } catch (err) {
      expect((err as InsightsError).code).toBe('INVALID_STRUCTURE');
    }
  });

  it('throws when observations array is empty', () => {
    const bad = { observations: [] };
    expect(() => parseInsightsResponse(JSON.stringify(bad))).toThrow(InsightsError);
  });

  it('filters out observations with missing required fields', () => {
    const mixed = {
      observations: [
        { finding: 'OK', evidence: 'OK', recommendation: 'OK', severity: 'low' },
        { finding: 'Bad', severity: 'medium' }, // missing evidence and recommendation
      ],
    };
    const result = parseInsightsResponse(JSON.stringify(mixed));
    expect(result.observations).toHaveLength(1);
    expect(result.observations[0].finding).toBe('OK');
  });

  it('normalizes severity to lowercase', () => {
    const payload = {
      observations: [
        { finding: 'x', evidence: 'y', recommendation: 'z', severity: 'High' },
      ],
    };
    const result = parseInsightsResponse(JSON.stringify(payload));
    expect(result.observations[0].severity).toBe('high');
  });

  it('accepts all four valid severity levels', () => {
    for (const sev of ['high', 'medium', 'low', 'positive']) {
      const payload = {
        observations: [{ finding: 'x', evidence: 'y', recommendation: 'z', severity: sev }],
      };
      const result = parseInsightsResponse(JSON.stringify(payload));
      expect(result.observations[0].severity).toBe(sev);
    }
  });

  it('handles extra unexpected fields gracefully (does not throw)', () => {
    const extra = {
      observations: [
        { finding: 'x', evidence: 'y', recommendation: 'z', severity: 'low', extraField: true },
      ],
    };
    const result = parseInsightsResponse(JSON.stringify(extra));
    expect(result.observations).toHaveLength(1);
  });
});
