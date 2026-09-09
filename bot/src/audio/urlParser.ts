import spotifyUrlInfo from 'spotify-url-info';
import { ChatInputCommandInteraction } from 'discord.js';
import { Track } from './musicPlayer.js';
import { defaultSearchProvider, tidalProvider, qobuzProvider } from '../api/devMode.js';
import { SoundCloudProvider } from '../api/soundcloud.js';
import { config } from '../config.js';

// spotify-url-info's default export is a factory (inject fetch); its shipped
// types don't model that, so call through `any`.
const { getTracks: getSpotifyTracks } = (spotifyUrlInfo as any)(fetch) as {
    getTracks: (url: string) => Promise<any[]>;
};
const scProvider = new SoundCloudProvider();

type Raw = any;

const PAGE = 100; // per-request page size for playlist/album pagination

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

let cachedSpotifyToken: { value: string; expires: number } | null = null;
let warnedScopes = false;

/**
 * A Spotify access token. Prefers the refresh-token (user) grant — the only one
 * that can read playlist tracks now — and falls back to client-credentials
 * (albums only). Cached until ~1 min before expiry.
 */
async function spotifyAccessToken(): Promise<string | null> {
    if (!config.spotifyClientId || !config.spotifyClientSecret) return null;
    if (cachedSpotifyToken && cachedSpotifyToken.expires > Date.now()) return cachedSpotifyToken.value;

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
        cachedSpotifyToken = { value: j.access_token, expires: Date.now() + (j.expires_in ?? 3600) * 1000 - 60_000 };
        return j.access_token;
    } catch {
        return null;
    }
}

async function spotifyViaWebApi(url: string): Promise<SpotifyName[] | null> {
    const m = url.match(/open\.spotify\.com\/(playlist|album)\/([a-zA-Z0-9]+)/);
    if (!m) return null;
    const [, kind, id] = m;

    const token = await spotifyAccessToken();
    if (!token) return null;

    const out: SpotifyName[] = [];
    let next: string | null =
        kind === 'playlist'
            ? `https://api.spotify.com/v1/playlists/${id}/tracks?limit=100&fields=next,items(track(name,artists(name)))`
            : `https://api.spotify.com/v1/albums/${id}/tracks?limit=50`;
    let gotAPage = false;

    while (next && out.length < config.maxQueueAdd) {
        const res = await fetch(next, { headers: { Authorization: `Bearer ${token}` } });
        if (!res.ok) {
            if (!gotAPage) {
                const detail = (await res.text().catch(() => '')).slice(0, 300);
                console.warn(`[spotify] Web API ${res.status} for ${kind} ${id}: ${detail || '(no body)'}`);
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
        next = j.next ?? null;
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

            // The Web API path is dead for playlist reads (Spotify's Nov-2024
            // lockdown 403s every non-Extended-Quota app), so long playlists
            // come from the embed scraper, which Spotify caps near 100.
            const capNote =
                scraped && names.length >= 100
                    ? `Note: Spotify only exposes the first ~${names.length} tracks of this ` +
                      `playlist to third-party apps — that's a Spotify-side limit.`
                    : '';

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
