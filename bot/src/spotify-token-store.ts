/**
 * Spotify's first-party (keymaster) OAuth is a PKCE / public-client flow, and
 * Spotify ROTATES the refresh token on every use — each successful refresh
 * returns a new refresh token and revokes the previous one. So the value in
 * `.env` is only good for the very first refresh; after that we must remember
 * whatever Spotify last handed back.
 *
 * This persists the current refresh token to a gitignored file next to `.env`
 * (cwd is always `bot/` — that's where dotenv reads `.env` from).
 */
import { existsSync, readFileSync, writeFileSync, renameSync } from 'node:fs';
import { resolve } from 'node:path';

const STORE_PATH = resolve(process.cwd(), '.spotify-fp-refresh-token');

/** The persisted refresh token, or null if the file is missing/empty. */
export function loadStoredRefreshToken(): string | null {
    try {
        if (!existsSync(STORE_PATH)) return null;
        const v = readFileSync(STORE_PATH, 'utf8').trim();
        return v || null;
    } catch {
        return null;
    }
}

/** Atomically persist the latest refresh token. Best-effort — never throws. */
export function saveRefreshToken(token: string): void {
    try {
        const tmp = `${STORE_PATH}.${process.pid}.tmp`;
        writeFileSync(tmp, `${token}\n`, { mode: 0o600 });
        renameSync(tmp, STORE_PATH);
    } catch (e) {
        console.warn('[spotify] could not persist rotated refresh token:', e);
    }
}

export { STORE_PATH as SPOTIFY_FP_TOKEN_STORE_PATH };
