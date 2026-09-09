import * as dotenv from 'dotenv';

dotenv.config();

function req(name: string): string {
    const v = process.env[name];
    if (!v) {
        console.error(`[config] Missing required env var: ${name}`);
        process.exit(1);
    }
    return v;
}

export const config = {
    /** Discord bot token. */
    discordToken: req('DISCORD_TOKEN'),
    /** Discord application (client) id, used for slash-command registration. */
    clientId: req('CLIENT_ID'),
    /**
     * Optional guild id. When set, slash commands are registered to that guild
     * only (instant). Otherwise they are registered globally (~1h propagation).
     */
    guildId: process.env.GUILD_ID || null,

    /** HiFi core API (Tidal search / metadata / stream). */
    hifiUrl: (process.env.DEV_MODE_URL || 'https://hf-core.bitperfect.dedyn.io').replace(/\/+$/, ''),
    /** Qobuz API. */
    qobuzUrl: (process.env.QOBUZ_URL || 'https://qz-api.bitperfect.dedyn.io').replace(/\/+$/, ''),

    /**
     * Optional Spotify app credentials. With just id+secret, only ALBUM tracks
     * are readable (client-credentials). Reading PLAYLISTS now needs a user
     * token: run `bun scripts/spotify-auth.ts` once and paste the resulting
     * SPOTIFY_REFRESH_TOKEN here. Without any of this the bot uses the
     * ~100-track embed scraper.
     */
    spotifyClientId: process.env.SPOTIFY_CLIENT_ID || null,
    spotifyClientSecret: process.env.SPOTIFY_CLIENT_SECRET || null,
    spotifyRefreshToken: process.env.SPOTIFY_REFRESH_TOKEN || null,
    spotifyRedirectUri: process.env.SPOTIFY_REDIRECT_URI || 'http://127.0.0.1:8888/callback',

    /** ffmpeg binary. Falls back to ffmpeg-static, then the system `ffmpeg`. */
    ffmpegPath: process.env.FFMPEG_PATH || null,

    /** Audio/API proxy HTTP server. */
    proxyPort: Number(process.env.PROXY_PORT) || 8080,
    /** Interface the proxy binds to. Loopback by default — it is meant to sit
     *  behind the VPS nginx, not be exposed directly. */
    proxyBind: process.env.PROXY_BIND || '127.0.0.1',

    /** Leave the voice channel after this many ms with nothing playing. */
    idleDisconnectMs: Number(process.env.IDLE_DISCONNECT_MS) || 5 * 60 * 1000,
    /** Hard cap on how many tracks a single /play (playlist) can enqueue. */
    maxQueueAdd: Number(process.env.MAX_QUEUE_ADD) || 200,
};

const PRIVATE_HOST = /^(localhost|0\.0\.0\.0|127\.|10\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/i;

/**
 * True if `raw` is a plain external http(s) URL that is safe to fetch on behalf
 * of a caller. Rejects other schemes and obvious internal targets (SSRF guard
 * for the /proxy-* endpoints).
 */
export function isProxyableUrl(raw: unknown): raw is string {
    if (typeof raw !== 'string' || !raw) return false;
    let u: URL;
    try {
        u = new URL(raw);
    } catch {
        return false;
    }
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return false;
    const host = u.hostname.toLowerCase();
    if (host === '::1' || host.startsWith('[')) return false;
    if (PRIVATE_HOST.test(host) || host.endsWith('.local') || host.endsWith('.internal')) return false;
    return true;
}
