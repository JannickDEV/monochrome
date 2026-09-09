import spotifyUrlInfo from 'spotify-url-info';
import { ChatInputCommandInteraction } from 'discord.js';
import { Track } from './musicPlayer.js';
import { defaultSearchProvider, tidalProvider, qobuzProvider } from '../api/devMode.js';
import { SoundCloudProvider } from '../api/soundcloud.js';
import { config } from '../config.js';

const { getTracks: getSpotifyTracks } = spotifyUrlInfo(fetch);
const scProvider = new SoundCloudProvider();

type Raw = any;

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

/** Fetch a playlist/album track listing and normalise it to a flat item array. */
async function fetchTrackList(
    url: string,
    label: string,
    interaction: ChatInputCommandInteraction
): Promise<Raw[] | null> {
    await interaction.editReply(`Fetching ${label}…`);
    let data: Raw;
    try {
        const res = await fetch(url);
        if (!res.ok) {
            await interaction.editReply(`Failed to fetch ${label} (HTTP ${res.status}).`);
            return null;
        }
        data = await res.json();
    } catch (e: any) {
        await interaction.editReply(`Failed to reach the ${label} API: ${e?.message ?? e}`);
        return null;
    }
    const raw: Raw[] =
        data?.items || data?.tracks?.items || data?.data?.items || data?.playlist?.items || [];
    const items = raw.map((entry: Raw) => entry?.item ?? entry).filter(Boolean);
    if (items.length === 0) {
        await interaction.editReply(`${label} is empty or could not be found.`);
        return null;
    }
    return items;
}

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
            const items = await fetchTrackList(`${config.hifiUrl}/playlist/?id=${id}`, 'Tidal playlist', i);
            return (items ?? []).map((it) => toTrack(it, 'tidal')).filter((t): t is Track => !!t);
        },
    },
    {
        test: (q) => /tidal\.com\/(browse\/)?album\//.test(q),
        run: async (q, i) => {
            const id = first(q, /album\/([0-9]+)/);
            if (!id) return (await i.editReply('Invalid Tidal album URL.'), []);
            const items = await fetchTrackList(`${config.hifiUrl}/album/?id=${id}`, 'Tidal album', i);
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
                `${config.qobuzUrl}/playlist/get?playlist_id=${id}&extra=tracks`,
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
            const items = await fetchTrackList(`${config.qobuzUrl}/album/get?album_id=${id}`, 'Qobuz album', i);
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
            let spotifyTracks: Raw[] = [];
            try {
                spotifyTracks = await getSpotifyTracks(q);
            } catch (e: any) {
                await i.editReply(`Failed to read that Spotify URL: ${e?.message ?? e}`);
                return [];
            }
            if (!spotifyTracks?.length) {
                await i.editReply('No tracks found in that Spotify URL.');
                return [];
            }

            const wanted = spotifyTracks.slice(0, config.maxQueueAdd);
            await i.editReply(`Matching ${wanted.length} Spotify track(s) on Tidal/Qobuz…`);

            const out: Track[] = [];
            for (let start = 0; start < wanted.length; start += 6) {
                const batch = wanted.slice(start, start + 6).map(async (sp) => {
                    const name = `${sp.name ?? ''} ${sp.artist ?? sp.artists?.[0]?.name ?? ''}`.trim();
                    if (!name) return null;
                    const results = await defaultSearchProvider.searchTracks(name, { limit: 1 }).catch(() => null);
                    const hit = results?.items?.[0];
                    return hit ? toTrack(hit, hit.provider || 'tidal') : null;
                });
                for (const t of await Promise.all(batch)) if (t) out.push(t);
            }
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
