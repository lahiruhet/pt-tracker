import { createRemoteJWKSet, jwtVerify } from "jose";
import type { Env } from "./env";

let jwks: ReturnType<typeof createRemoteJWKSet> | null = null;
let jwksTeam = "";

function cookie(req: Request, name: string): string | null {
  const raw = req.headers.get("cookie") ?? "";
  for (const part of raw.split(/;\s*/)) {
    const eq = part.indexOf("=");
    if (eq > 0 && part.slice(0, eq) === name) return decodeURIComponent(part.slice(eq + 1));
  }
  return null;
}

/**
 * Cloudflare Access sits in front of the whole domain; this re-checks its signed JWT so the API
 * can't be reached around it. Returns the signed-in email, or null when the request isn't allowed.
 */
export async function accessEmail(req: Request, env: Env): Promise<string | null> {
  if (!env.ACCESS_TEAM_DOMAIN || !env.ACCESS_AUD) {
    return env.ALLOW_NO_AUTH === "1" ? "dev@localhost" : null;
  }
  const token = req.headers.get("cf-access-jwt-assertion") ?? cookie(req, "CF_Authorization");
  if (!token) return null;
  const team = env.ACCESS_TEAM_DOMAIN.replace(/^https?:\/\//, "").replace(/\/$/, "");
  if (!jwks || jwksTeam !== team) {
    jwks = createRemoteJWKSet(new URL(`https://${team}/cdn-cgi/access/certs`));
    jwksTeam = team;
  }
  try {
    const { payload } = await jwtVerify(token, jwks, { issuer: `https://${team}`, audience: env.ACCESS_AUD });
    const email = typeof payload.email === "string" ? payload.email.toLowerCase() : null;
    if (!email) return null;
    const allowed = (env.ALLOWED_EMAILS ?? "").split(",").map((e) => e.trim().toLowerCase()).filter(Boolean);
    return allowed.length === 0 || allowed.includes(email) ? email : null;
  } catch {
    return null;
  }
}

export function safeEqual(a: string, b: string): boolean {
  const enc = new TextEncoder();
  const x = enc.encode(a);
  const y = enc.encode(b);
  if (x.length !== y.length) return false;
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i];
  return diff === 0;
}
