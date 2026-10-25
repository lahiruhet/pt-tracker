export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

/** Cloudflare Access session expired (or never started): the page must reload to sign in. */
export class AuthError extends ApiError {
  constructor() {
    super(401, "Signed out");
  }
}

export async function api<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      method: init.method ?? "GET",
      headers: init.body !== undefined ? { "content-type": "application/json" } : undefined,
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
      credentials: "include",
      redirect: "manual",
    });
  } catch {
    throw new ApiError(0, "No connection");
  }
  // Access answers an expired session with a redirect to its login page.
  if (res.type === "opaqueredirect" || res.status === 401 || res.status === 403) throw new AuthError();
  const text = await res.text();
  let data: any = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    throw new ApiError(res.status, "Unexpected response from server");
  }
  if (!res.ok) throw new ApiError(res.status, data?.error ?? `Request failed (${res.status})`);
  return data as T;
}

export function newId(): string {
  return crypto.randomUUID().replace(/-/g, "").slice(0, 16);
}
