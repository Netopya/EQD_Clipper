const TOKEN_KEY = 'eqd-clipper-token';

export function getApiBase(): string {
  return import.meta.env.VITE_API_URL || 'http://127.0.0.1:8787';
}

export function getStoredToken(): string {
  return localStorage.getItem(TOKEN_KEY) || '';
}

export function setStoredToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token);
}

export async function apiFetch(
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  const token = getStoredToken();
  const headers = new Headers(init.headers);
  if (token) {
    headers.set('Authorization', `Bearer ${token}`);
  }
  if (init.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }
  return fetch(`${getApiBase().replace(/\/$/, '')}${path}`, {
    ...init,
    headers,
  });
}

export async function fetchBootstrap(): Promise<{
  apiToken: string;
  twitterDelayMs: number;
}> {
  const r = await fetch(`${getApiBase().replace(/\/$/, '')}/api/bootstrap`);
  if (!r.ok) throw new Error(`Bootstrap failed: ${r.status}`);
  return r.json();
}
