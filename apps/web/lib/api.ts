/**
 * Minimal API client. Access token lives in memory only; the 7d refresh
 * cookie (httpOnly, path=/api/v1/auth) is the durable session — on a 401 we
 * refresh once and retry. credentials are sent ONLY to /auth/* endpoints.
 */
export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001/api/v1";

export type Role = "OWNER" | "STAFF";

let accessToken: string | null = null;
export const setAccessToken = (t: string | null) => {
  accessToken = t;
};
export const getAccessToken = () => accessToken;

/**
 * Role for UX gating only (OWNER-only buttons). Decoded from the in-memory
 * access-token JWT payload `{ sub, pharmacyId, role }` — survives silent
 * refresh since the rotated token carries the same claim. The server still
 * enforces 403 on STAFF, so a tampered token buys nothing.
 */
export const getRole = (): Role | null => {
  if (!accessToken) return null;
  try {
    const payload = accessToken.split(".")[1];
    if (!payload) return null;
    const json = JSON.parse(atob(payload.replace(/-/g, "+").replace(/_/g, "/")));
    return json.role === "OWNER" || json.role === "STAFF" ? json.role : null;
  } catch {
    return null;
  }
};

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

async function parse<T>(res: Response): Promise<T> {
  const body = res.status === 204 ? null : await res.json().catch(() => null);
  if (!res.ok) {
    throw new ApiError(
      res.status,
      body?.error?.code ?? "UNKNOWN",
      body?.error?.message ?? res.statusText,
    );
  }
  return body as T;
}

export async function api<T = unknown>(path: string, init: RequestInit = {}): Promise<T> {
  const doFetch = () =>
    fetch(`${API_URL}${path}`, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
        ...init.headers,
      },
    });
  let res = await doFetch();
  if (res.status === 401 && (await tryRefresh())) res = await doFetch();
  return parse<T>(res);
}

/** Authenticated CSV download → browser save dialog (blob + temp anchor). */
export async function downloadCsv(path: string, fallbackName: string): Promise<void> {
  const doFetch = () =>
    fetch(`${API_URL}${path}`, {
      headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : {},
    });
  let res = await doFetch();
  if (res.status === 401 && (await tryRefresh())) res = await doFetch();
  if (!res.ok) throw new ApiError(res.status, "DOWNLOAD_FAILED", res.statusText);
  const blob = await res.blob();
  const name =
    res.headers.get("Content-Disposition")?.match(/filename="([^"]+)"/)?.[1] ?? fallbackName;
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

// Concurrent callers (a 401 retry racing the mount-time auth gate, or React's
// dev double-invoked effects) must NOT each POST /auth/refresh: the refresh
// token rotates on first use, so the second call would present the now-stale
// cookie and trip reuse-detection — revoking the whole family. Share one
// in-flight refresh instead.
let refreshInFlight: Promise<boolean> | null = null;

export function tryRefresh(): Promise<boolean> {
  if (refreshInFlight) return refreshInFlight;
  refreshInFlight = (async () => {
    try {
      const res = await fetch(`${API_URL}/auth/refresh`, {
        method: "POST",
        credentials: "include",
      });
      if (!res.ok) return false;
      const body = (await res.json()) as { accessToken: string };
      setAccessToken(body.accessToken);
      return true;
    } catch {
      return false;
    } finally {
      refreshInFlight = null;
    }
  })();
  return refreshInFlight;
}

export interface LoginResult {
  accessToken: string;
  userId: string;
  role: "OWNER" | "STAFF";
  name: string;
}

export async function login(phone: string, password: string): Promise<LoginResult> {
  const res = await fetch(`${API_URL}/auth/login`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ phone, password }),
  });
  const body = await parse<LoginResult>(res);
  setAccessToken(body.accessToken);
  return body;
}

export interface SignupInput {
  pharmacyName: string;
  ownerName: string;
  phone: string;
  password: string;
  city?: string;
}

export interface SignupResult {
  accessToken: string;
  pharmacyId: string;
  userId: string;
}

export async function signup(input: SignupInput): Promise<SignupResult> {
  const res = await fetch(`${API_URL}/auth/signup`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  const body = await parse<SignupResult>(res);
  setAccessToken(body.accessToken);
  return body;
}

export async function logout(): Promise<void> {
  try {
    await fetch(`${API_URL}/auth/logout`, { method: "POST", credentials: "include" });
  } finally {
    setAccessToken(null);
  }
}
