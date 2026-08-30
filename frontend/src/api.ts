export interface MeResponse {
  id: string;
  githubId: number;
  username: string;
  email: string | null;
  createdAt: string;
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