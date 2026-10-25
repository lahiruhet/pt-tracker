export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  SHEET_URL?: string;
  ALLOWED_EMAILS?: string;
  /** "email=Name,email=Name" for the greeting (secret). */
  DISPLAY_NAMES?: string;
  ACCESS_TEAM_DOMAIN?: string;
  ACCESS_AUD?: string;
  /** Apps Script web app /exec URL (secret). */
  SHEET_SCRIPT_URL?: string;
  /** Shared secret between the Worker and the Apps Script (secret). */
  SHEET_SECRET?: string;
  /** Local development only: skip the Cloudflare Access check. */
  ALLOW_NO_AUTH?: string;
}
