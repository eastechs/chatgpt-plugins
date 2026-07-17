// REPLACE: must match AUTH_HEADER in src/main/auth.ts.
const AUTH_HEADER = "X-MyApp-Auth";

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly response: unknown,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export function isApiError(err: unknown): err is ApiError {
  return err instanceof ApiError;
}

let cachedAuth: string | null = null;

async function ensureAuth(): Promise<string> {
  if (cachedAuth) return cachedAuth;
  const auth = await window.electronAPI?.getServerAuth();
  if (!auth) {
    throw new Error("Server auth unavailable; running outside Electron?");
  }
  cachedAuth = auth;
  return auth;
}

// Fetch wrapper that always attaches the per-launch auth header.
// Exported so non-api callers (e.g. the AI SDK chat transport) can use it
// directly with fetch-like APIs.
export async function authedFetch(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> {
  const auth = await ensureAuth();
  const headers = new Headers(init?.headers);
  headers.set(AUTH_HEADER, auth);
  return fetch(input, { ...init, headers });
}

export async function api<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await authedFetch(path, {
    headers: {
      "Content-Type": "application/json",
      ...options?.headers,
    },
    ...options,
  });

  if (!res.ok) {
    const text = await res.text();
    let parsed: unknown = text;
    try {
      parsed = JSON.parse(text);
    } catch {
      /* leave as text */
    }
    throw new ApiError(res.status, parsed, `API error ${res.status}`);
  }

  return res.json();
}

export const api_get = <T>(path: string) => api<T>(path);

export const api_post = <T>(path: string, body?: unknown) =>
  api<T>(path, {
    method: "POST",
    body: body ? JSON.stringify(body) : undefined,
  });

export const api_put = <T>(path: string, body?: unknown) =>
  api<T>(path, {
    method: "PUT",
    body: body ? JSON.stringify(body) : undefined,
  });

export const api_patch = <T>(path: string, body?: unknown) =>
  api<T>(path, {
    method: "PATCH",
    body: body ? JSON.stringify(body) : undefined,
  });

export const api_delete = <T>(path: string, body?: unknown) =>
  api<T>(path, {
    method: "DELETE",
    body: body ? JSON.stringify(body) : undefined,
  });
