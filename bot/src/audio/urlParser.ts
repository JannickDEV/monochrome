import spotifyUrlInfo from 'spotify-url-info';
import { ChatInputCommandInteraction } from 'discord.js';
import { Track } from './musicPlayer.js';
import { defaultSearchProvider, tidalProvider, qobuzProvider } from '../api/devMode.js';
import { SoundCloudProvider } from '../api/soundcloud.js';
import { config } from '../config.js';
import { loadStoredRefreshToken, saveRefreshToken } from '../spotify-token-store.js';

// spotify-url-info's default export is a factory (inject fetch); its shipped
// types don't model that, so call through `any`.
const { getTracks: getSpotifyTracks } = (spotifyUrlInfo as any)(fetch) as {
    getTracks: (url: string) => Promise<any[]>;
};
const scProvider = new SoundCloudProvider();

type Raw = any;

const PAGE = 100; // per-request page size for playlist/album pagination

// Spotify's first-party desktop ("keymaster") client id — the same one
// librespot and OnTheSpot use. A refresh token issued for THIS client mints
// official-client access tokens, which read playlists in full and are not
// subject to the Nov-2024 developer-app restrictions. Public client (PKCE),
// so there is no secret to go with it.
const SPOTIFY_KEYMASTER_CLIENT_ID = '65b708073fc0480ea92a077233ca87bd';

/** Tidal image ids come back as `xxxx-xxxx-...`; Qobuz already gives full URLs. */
function resolveCover(raw: unknown): string | null {
    if (typeof raw !== 'string' || !raw) return null;
    return raw.startsWith('http') ? raw : tidalProvider.getCoverUrl(raw);
}

function toTrack(item: Raw, provider: string): Track | null {
    if (!item || item.id == null) return null;
    const cover =
        item.album?.cover ??
        item.album?.image?.large ??
        item.album?.image?.small ??
        item.image?.large ??
        item.cover ??
        item.image ??
        null;
    return {
        id: provider === 'qobuz' ? `q:${item.id}` : String(item.id),
        title: item.title ?? 'Unknown Title',
        artist: {
            name: item.artist?.name ?? item.performer?.name ?? 'Unknown',
            id: (item.artist?.id ?? item.performer?.id)?.toString(),
        },
        provider,
        cover: resolveCover(cover),
    };
}

function extractItems(data: Raw): Raw[] {
    const raw: Raw[] = data?.items || data?.tracks?.items || data?.data?.items || data?.playlist?.items || [];
    return raw.map((entry: Raw) => entry?.item ?? entry).filter(Boolean);
}

const firstId = (items: Raw[]): string | null => (items[0]?.id != null ? String(items[0].id) : null);

/**
 * Fetch a playlist/album track listing, following `offset`/`limit` pagination
 * until the source is exhausted, a page repeats (server ignored `offset`), or
 * the queue cap is reached.
 */
async function fetchTrackList(
    buildUrl: (offset: number, limit: number) => string,
    label: string,
    interaction: ChatInputCommandInteraction
): Promise<Raw[] | null> {
    await interaction.editReply(`Fetching ${label}…`);

    const all: Raw[] = [];
    let offset = 0;
    let pageSize = 0;

    for (let iter = 0; iter < 100 && all.length < config.maxQueueAdd; iter++) {
        let data: Raw;
        try {
            const res = await fetch(buildUrl(offset, PAGE));
            if (!res.ok) {
                if (all.length) break; // keep what we already have
                await interaction.editReply(`Failed to fetch ${label} (HTTP ${res.status}).`);
                return null;
            }
            data = await res.json();
        } catch (e: any) {
            if (all.length) break;
            await interaction.editReply(`Failed to reach the ${label} API: ${e?.message ?? e}`);
            return null;
        }

        const page = extractItems(data);
        if (page.length === 0) break;
        if (all.length && firstId(page) && firstId(page) === firstId(all)) break; // offset ignored -> loop

        all.push(...page);
        if (pageSize && page.length < pageSize) break; // short page -> last page
        pageSize = page.length;
        offset += page.length;
        if (page.length > 30) await interaction.editReply(`Fetching ${label}… (${all.length})`);
    }

    if (all.length === 0) {
        await interaction.editReply(`${label} is empty or could not be found.`);
        return null;
    }
    return all.slice(0, config.maxQueueAdd);
}

// --- Spotify -----------------------------------------------------------------

interface SpotifyName {
    name: string;
    artist: string;
}

let cachedSpotifyToken: { value: string; expires: number; firstParty: boolean } | null = null;
let warnedScopes = false;
let warnedFpRevoked = false;

/** Which tier minted the currently-cached token (for diagnostics). */
export function spotifyTokenTier(): 'first-party' | 'dev-app' | null {
    if (!cachedSpotifyToken || cachedSpotifyToken.expires <= Date.now()) return null;
    return cachedSpotifyToken.firstParty ? 'first-party' : 'dev-app';
}

// Spotify rotates the first-party refresh token on every use, so the live value
// is whatever it last handed back — the persisted file, else the .env seed.
let fpRefreshToken: string | null | undefined;
function currentFpRefreshToken(): string | null {
    if (fpRefreshToken === undefined) fpRefreshToken = loadStoredRefreshToken() ?? config.spotifyFpRefreshToken;
    return fpRefreshToken;
}

type FpResult = { access: string; expiresIn: number } | 'revoked' | 'error';

/** One refresh attempt against the keymaster client. Persists a rotated token. */
async function fpRefreshOnce(refreshToken: string): Promise<FpResult> {
    let res: Response;
    try {
        res = await fetch('https://accounts.spotify.com/api/token', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
                grant_type: 'refresh_token',
                refresh_token: refreshToken,
                client_id: SPOTIFY_KEYMASTER_CLIENT_ID,
            }).toString(),
        });
    } catch (e) {
        console.warn('[spotify] first-party token refresh error:', e);
        return 'error';
    }

    if (res.ok) {
        const j: Raw = await res.json().catch(() => ({}));
        if (!j.access_token) return 'error';
        if (j.refresh_token && j.refresh_token !== refreshToken) {
            fpRefreshToken = j.refresh_token;
            saveRefreshToken(j.refresh_token);
        }
        return { access: j.access_token, expiresIn: j.expires_in ?? 3600 };
    }

    const detail = (await res.text().catch(() => '')).slice(0, 200);
    if (detail.includes('invalid_grant')) return 'revoked';
    console.warn(`[spotify] first-party token refresh failed (${res.status}): ${detail || '(no body)'}`);
    return 'error';
}

/**
 * A Spotify access token.
 *
 * 1. If a first-party (keymaster) refresh token is available, refresh it
 *    against Spotify's own desktop client id (no secret). These tokens read
 *    playlists in full. The refresh token rotates on each use and is persisted.
 * 2. Otherwise fall back to the self-registered dev app: refresh-token grant if
 *    a user token is configured, else client-credentials (albums only — dev-app
 *    playlist reads 403 since Nov 2024).
 *
 * Cached until ~1 min before expiry.
 */
export async function spotifyAccessToken(): Promise<string | null> {
    if (cachedSpotifyToken && cachedSpotifyToken.expires > Date.now()) return cachedSpotifyToken.value;

    // --- 1. first-party (keymaster) refresh token -----------------------------
    let fpToken = currentFpRefreshToken();
    if (fpToken) {
        let result = await fpRefreshOnce(fpToken);
        // A "revoked" can mean another process (a probe run, a restart) already
        // rotated the on-disk token past ours — reload and retry once.
        if (result === 'revoked') {
            const fromDisk = loadStoredRefreshToken();
            if (fromDisk && fromDisk !== fpToken) {
                fpRefreshToken = fromDisk;
                fpToken = fromDisk;
                result = await fpRefreshOnce(fromDisk);
            }
        }
        if (typeof result === 'object') {
            warnedFpRevoked = false;
            cachedSpotifyToken = {
                value: result.access,
                expires: Date.now() + result.expiresIn * 1000 - 60_000,
                firstParty: true,
            };
            return result.access;
        }
        if (result === 'revoked' && !warnedFpRevoked) {
            warnedFpRevoked = true;
            console.warn(
                '[spotify] first-party refresh token is revoked/expired — re-run ' +
                    '`bun run spotify-auth-fp` and update SPOTIFY_FIRSTPARTY_REFRESH_TOKEN. Falling back for now.'
            );
        }
        // fall through to the dev-app path
    }

    // --- 2. self-registered dev app -----------------------------------------
    if (!config.spotifyClientId || !config.spotifyClientSecret) return null;

    const auth = btoa(`${config.spotifyClientId}:${config.spotifyClientSecret}`);
    const body = config.spotifyRefreshToken
        ? `grant_type=refresh_token&refresh_token=${encodeURIComponent(config.spotifyRefreshToken)}`
        : 'grant_type=client_credentials';

    try {
        const res = await fetch('https://accounts.spotify.com/api/token', {
            method: 'POST',
            headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/x-www-form-urlencoded' },
            body,
        });
        if (!res.ok) return null;
        const j: Raw = await res.json();
        if (!j.access_token) return null;
        if (config.spotifyRefreshToken && !warnedScopes) {
            warnedScopes = true;
            console.log(`[spotify] user token scopes: ${j.scope || '(none)'}`);
        }
        cachedSpotifyToken = {
            value: j.access_token,
            expires: Date.now() + (j.expires_in ?? 3600) * 1000 - 60_000,
            firstParty: false,
        };
        return j.access_token;
    } catch {
        return null;
    }
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Why the last Web API attempt gave up — lets the caller message accurately. */
let lastWebApiFailure: 'ratelimited' | 'forbidden' | 'other' | null = null;
/** Retry-After (seconds) from the last 429, when known. */
let lastRetryAfter = 0;
export function spotifyWebApiFailure() {
    return { reason: lastWebApiFailure, retryAfter: lastRetryAfter };
}

// Successful full Web API reads, keyed by `${kind}:${id}`. Spotify rate-limits
// this client id hard (esp. from datacenter IPs), so never re-fetch a list we
// already have this session.
const webApiCache = new Map<string, { at: number; names: SpotifyName[] }>();
const WEB_API_CACHE_TTL = 15 * 60 * 1000;

// Wait at most this long *inside* a command for a 429 to clear; anything longer
// is a penalty box — fall back and tell the user the real number.
const MAX_INLINE_RETRY_WAIT = 40;

async function spotifyViaWebApi(url: string): Promise<SpotifyName[] | null> {
    lastWebApiFailure = null;
    lastRetryAfter = 0;
    const m = url.match(/open\.spotify\.com\/(playlist|album)\/([a-zA-Z0-9]+)/);
    if (!m) return null;
    const [, kind, id] = m;

    const cacheKey = `${kind}:${id}`;
    const hit = webApiCache.get(cacheKey);
    if (hit && Date.now() - hit.at < WEB_API_CACHE_TTL) return hit.names;

    const token = await spotifyAccessToken();
    if (!token) return null;

    const out: SpotifyName[] = [];
    let next: string | null =
        kind === 'playlist'
            ? `${config.spotifyApiBase}/v1/playlists/${id}/tracks?limit=100&fields=next,items(track(name,artists(name)))`
            : `${config.spotifyApiBase}/v1/albums/${id}/tracks?limit=50`;
    let gotAPage = false;

    while (next && out.length < config.maxQueueAdd) {
        let res = await fetch(next, { headers: { Authorization: `Bearer ${token}` } });

        // One bounded retry on 429. Hammering a rate limiter only deepens it.
        if (res.status === 429) {
            const secs = Number(res.headers.get('retry-after')) || 0;
            lastRetryAfter = secs;
            if (secs > 0 && secs <= MAX_INLINE_RETRY_WAIT) {
                console.warn(`[spotify] 429 on ${kind} ${id} — waiting ${secs}s then one retry`);
                await sleep(secs * 1000 + 300);
                res = await fetch(next, { headers: { Authorization: `Bearer ${token}` } });
            } else {
                console.warn(`[spotify] 429 on ${kind} ${id} — Retry-After ${secs || '?'}s, not waiting`);
            }
        }

        if (!res.ok) {
            const detail = (await res.text().catch(() => '')).slice(0, 300);
            console.warn(`[spotify] Web API ${res.status} for ${kind} ${id}: ${detail || '(no body)'}`);
            lastWebApiFailure = res.status === 429 ? 'ratelimited' : res.status === 403 ? 'forbidden' : 'other';
            if (res.status === 429) lastRetryAfter = Number(res.headers.get('retry-after')) || lastRetryAfter;
            if (!gotAPage) {
                console.warn('[spotify] falling back to the scraper');
                return null;
            }
            break; // partial result — keep what we already paged
        }
        gotAPage = true;
        const j: Raw = await res.json();
        for (const it of j.items || []) {
            const t = it.track ?? it; // playlist wraps in .track; album/tracks are bare
            if (t?.name) out.push({ name: t.name, artist: t.artists?.[0]?.name ?? '' });
        }
        // `j.next` is an absolute api.spotify.com URL — keep it on the relay.
        next = j.next ? j.next.replace('https://api.spotify.com', config.spotifyApiBase) : null;
    }

    // Cache a read that finished cleanly (pagination exhausted or queue cap hit),
    // not one cut short by an error mid-way.
    if (out.length && (!next || out.length >= config.maxQueueAdd)) {
        webApiCache.set(cacheKey, { at: Date.now(), names: out });
    }
    return out;
}

async function spotifyViaScraper(url: string): Promise<SpotifyName[] | null> {
    try {
        const tracks: Raw[] = await getSpotifyTracks(url);
        return (tracks || [])
            .map((sp) => ({ name: sp.name ?? '', artist: sp.artist ?? sp.artists?.[0]?.name ?? '' }))
            .filter((s) => s.name);
    } catch {
        return null;
    }
}

/** Resolves a list of `{name, artist}` to Tracks by searching each on Tidal, batched. */
async function matchOnTidal(
    names: SpotifyName[],
    interaction: ChatInputCommandInteraction,
    note = ''
): Promise<Track[]> {
    const wanted = names.slice(0, config.maxQueueAdd);
    await interaction.editReply(`Matching ${wanted.length} track(s) on Tidal/Qobuz…${note ? `\n${note}` : ''}`);

    const out: Track[] = [];
    for (let start = 0; start < wanted.length; start += 8) {
        const batch = wanted.slice(start, start + 8).map(async ({ name, artist }) => {
            const query = `${name} ${artist}`.trim();
            if (!query) return null;
            const results = await defaultSearchProvider.searchTracks(query, { limit: 1 }).catch(() => null);
            const hit = results?.items?.[0];
            return hit ? toTrack(hit, hit.provider || 'tidal') : null;
        });
        for (const t of await Promise.all(batch)) if (t) out.push(t);
    }
    return out;
}

// --- URL handlers ----------------------------------------------------------

interface UrlHandler {
    test: (q: string) => boolean;
    run: (q: string, interaction: ChatInputCommandInteraction) => Promise<Track[]>;
}

const first = (q: string, re: RegExp) => q.match(re)?.[1] ?? null;

const handlers: UrlHandler[] = [
    // --- SoundCloud -------------------------------------------------------------
    {
        test: (q) => q.includes('soundcloud.com'),
        run: async (q, i) => {
            try {
                const t = await scProvider.resolveUrl(q);
                return t ? [t] : [];
            } catch (e: any) {
                await i.editReply(`Couldn't resolve that SoundCloud link: ${e?.message ?? e}`);
                return [];
            }
        },
    },

    // --- Tidal ---------------------------------------------------------------
    {
        test: (q) => /tidal\.com\/(browse\/)?playlist\//.test(q),
        run: async (q, i) => {
            const id = first(q, /playlist\/([a-zA-Z0-9-]+)/);
            if (!id) return (await i.editReply('Invalid Tidal playlist URL.'), []);
            const items = await fetchTrackList(
                (o, l) => `${config.hifiUrl}/playlist/?id=${id}&offset=${o}&limit=${l}`,
                'Tidal playlist',
                i
            );
            return (items ?? []).map((it) => toTrack(it, 'tidal')).filter((t): t is Track => !!t);
        },
    },
    {
        test: (q) => /tidal\.com\/(browse\/)?album\//.test(q),
        run: async (q, i) => {
            const id = first(q, /album\/([0-9]+)/);
            if (!id) return (await i.editReply('Invalid Tidal album URL.'), []);
            const items = await fetchTrackList(
                (o, l) => `${config.hifiUrl}/album/?id=${id}&offset=${o}&limit=${l}`,
                'Tidal album',
                i
            );
            return (items ?? []).map((it) => toTrack(it, 'tidal')).filter((t): t is Track => !!t);
        },
    },
    {
        test: (q) => q.includes('tidal.com/'),
        run: async (q, i) => {
            const id = first(q, /track\/(\d+)/);
            if (!id) return (await i.editReply('Could not find a Tidal track id in that URL.'), []);
            const meta = await tidalProvider.getTrackMetadata(id).catch(() => null);
            const t = meta && toTrack({ ...meta, id: meta.id ?? id }, 'tidal');
            return t ? [t] : [];
        },
    },

    // --- Qobuz (and the fork's m-app mirror) ----------------------------------
    {
        test: (q) =>
            q.includes('qobuz.com/playlist/') ||
            q.includes('play.qobuz.com/playlist/') ||
            q.includes('m-app.bitperfect.dedyn.io/playlist/'),
        run: async (q, i) => {
            const id = first(q, /playlist\/[^/]+\/([a-zA-Z0-9-]+)/) ?? first(q, /playlist\/([a-zA-Z0-9-]+)/);
            if (!id) return (await i.editReply('Invalid Qobuz playlist URL.'), []);
            const items = await fetchTrackList(
                (o, l) => `${config.qobuzUrl}/playlist/get?playlist_id=${id}&extra=tracks&limit=${l}&offset=${o}`,
                'Qobuz playlist',
                i
            );
            return (items ?? []).map((it) => toTrack(it, 'qobuz')).filter((t): t is Track => !!t);
        },
    },
    {
        test: (q) =>
            (q.includes('qobuz.com/') || q.includes('m-app.bitperfect.dedyn.io/')) && q.includes('/album/'),
        run: async (q, i) => {
            const id = first(q, /album\/[^/]+\/([a-zA-Z0-9]+)/) ?? first(q, /album\/([a-zA-Z0-9]+)/);
            if (!id) return (await i.editReply('Invalid Qobuz album URL.'), []);
            const items = await fetchTrackList(
                (o, l) => `${config.qobuzUrl}/album/get?album_id=${id}&limit=${l}&offset=${o}`,
                'Qobuz album',
                i
            );
            return (items ?? []).map((it) => toTrack(it, 'qobuz')).filter((t): t is Track => !!t);
        },
    },
    {
        test: (q) => q.includes('qobuz.com/') || q.includes('m-app.bitperfect.dedyn.io/'),
        run: async (q, i) => {
            const id = first(q, /track\/([a-zA-Z0-9_-]+)/);
            if (!id) return (await i.editReply('Could not find a Qobuz track id in that URL.'), []);
            const meta = await qobuzProvider.getTrackMetadata(id).catch(() => null);
            const t = meta && toTrack({ ...meta, id: meta.id ?? id }, 'qobuz');
            return t ? [t] : [];
        },
    },

    // --- Spotify (playlists / albums) --------------------------------------
    {
        test: (q) => /open\.spotify\.com\/(playlist|album)\//.test(q),
        run: async (q, i) => {
            await i.editReply('Reading the Spotify list…');

            let names = await spotifyViaWebApi(q);
            let scraped = false;
            if (names === null) {
                names = await spotifyViaScraper(q);
                scraped = true;
            }

            if (!names) {
                await i.editReply('Failed to read that Spotify URL.');
                return [];
            }
            if (names.length === 0) {
                await i.editReply('No tracks found in that Spotify URL.');
                return [];
            }

            // Explain a short list only when it's actually capped by the scraper.
            let capNote = '';
            if (scraped && names.length >= 100) {
                const { reason, retryAfter } = spotifyWebApiFailure();
                const when = retryAfter > 90 ? `~${Math.ceil(retryAfter / 60)} min` : retryAfter > 0 ? `~${retryAfter}s` : 'a bit';
                capNote =
                    reason === 'ratelimited'
                        ? `Note: Spotify rate-limited the full read — got the first ~${names.length} via ` +
                          `fallback. Try again in ${when} for the whole list.`
                        : reason === 'forbidden'
                          ? `Note: this token can't read the full playlist (Spotify 403) — showing the ` +
                            `first ~${names.length}.`
                          : `Note: only the first ~${names.length} tracks of this playlist are exposed ` +
                            `without a first-party Spotify token.`;
            }

            const out = await matchOnTidal(names, i, capNote);
            if (out.length === 0) await i.editReply('Could not match any of those tracks.');
            return out;
        },
    },
];

/**
 * Turns a free-text query or a supported URL into an ordered list of Tracks.
 * Handlers own their own error `editReply`s; on failure they return `[]`.
 */
export async function resolveQueryToTracks(
    query: string,
    interaction: ChatInputCommandInteraction
): Promise<Track[]> {
    const q = query.trim();

    if (/^https?:\/\//i.test(q)) {
        const handler = handlers.find((h) => h.test(q));
        if (!handler) {
            await interaction.editReply(
                'That link is not supported. Try a SoundCloud, Tidal, Qobuz, or Spotify (playlist/album) URL.'
            );
            return [];
        }
        const tracks = await handler.run(q, interaction);
        return tracks.slice(0, config.maxQueueAdd);
    }

    // Plain text -> top search result (Tidal).
    const results = await defaultSearchProvider.searchTracks(q, { limit: 5 }).catch(() => null);
    const hit = results?.items?.[0];
    if (!hit) {
        await interaction.editReply(`No results for "${q}".`);
        return [];
    }
    const track = toTrack(hit, hit.provider || 'tidal');
    return track ? [track] : [];
}
