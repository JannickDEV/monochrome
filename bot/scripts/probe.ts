/**
 * Exercise the bot's resolution + streaming paths without Discord.
 *
 *   bun scripts/probe.ts "<search text or url>"
 *   bun scripts/probe.ts "<url>" --stream        # also resolve + reach the CDN
 *
 * Reads bot/.env (DISCORD_TOKEN / CLIENT_ID must be present — config.ts requires
 * them — but they are never contacted here).
 */
import { config } from '../src/config.js';
import { resolveQueryToTracks } from '../src/audio/urlParser.js';
import { fallbackProvider } from '../src/api/devMode.js';
import { SoundCloudProvider } from '../src/api/soundcloud.js';

const rawArgs = process.argv.slice(2);
const doStream = rawArgs.includes('--stream');
const query = rawArgs.filter((a) => a !== '--stream').join(' ').trim();

if (!query) {
    console.error('usage: bun scripts/probe.ts "<search text or url>" [--stream]');
    process.exit(1);
}

// Minimal stand-in for a ChatInputCommandInteraction — handlers only call editReply().
const interaction = {
    deferred: true,
    replied: false,
    editReply: (msg: unknown) => {
        const text = typeof msg === 'string' ? msg : (msg as any)?.content ?? JSON.stringify(msg);
        console.log('   ·', text);
        return Promise.resolve({});
    },
} as any;

async function checkSpotify(): Promise<void> {
    if (!config.spotifyClientId || !config.spotifyClientSecret) {
        console.log('spotify .......... no id/secret  (albums + playlists via ~100-track scraper)');
        return;
    }
    // Either grant reads albums fine; neither reads playlists since Spotify's
    // Nov-2024 lockdown, so playlists always use the ~100-track scraper.
    const grant = config.spotifyRefreshToken ? 'refresh_token (user)' : 'client_credentials';
    try {
        const auth = btoa(`${config.spotifyClientId}:${config.spotifyClientSecret}`);
        const bodyStr = config.spotifyRefreshToken
            ? `grant_type=refresh_token&refresh_token=${encodeURIComponent(config.spotifyRefreshToken)}`
            : 'grant_type=client_credentials';
        const res = await fetch('https://accounts.spotify.com/api/token', {
            method: 'POST',
            headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/x-www-form-urlencoded' },
            body: bodyStr,
        });
        const body: any = await res.json().catch(() => ({}));
        console.log(
            `spotify .......... ${res.ok && body.access_token ? `OK  [${grant}]` : `FAILED (${res.status}) ${JSON.stringify(body)}`}`
        );
    } catch (e) {
        console.log('spotify .......... ERROR', e);
    }
}

async function reach(url: string): Promise<string> {
    try {
        const res = await fetch(url, { headers: { Range: 'bytes=0-1' } });
        const len = res.headers.get('content-range') || res.headers.get('content-length') || '';
        return `HTTP ${res.status}  ${res.headers.get('content-type') || ''}  ${len}`;
    } catch (e) {
        return `unreachable: ${e instanceof Error ? e.message : e}`;
    }
}

async function main() {
    console.log(`hifi ............. ${config.hifiUrl}`);
    console.log(`qobuz ........... ${config.qobuzUrl}`);
    await checkSpotify();
    console.log('');
    console.log(`resolving: ${query}`);

    const tracks = await resolveQueryToTracks(query, interaction);
    console.log(`\nresolved ${tracks.length} track(s):`);
    tracks.slice(0, 30).forEach((t, i) =>
        console.log(`  ${String(i + 1).padStart(2)}. ${t.title} — ${t.artist.name}   [${t.provider}:${t.id}]`)
    );
    if (tracks.length > 30) console.log(`  … +${tracks.length - 30} more`);

    if (doStream && tracks[0]) {
        const t = tracks[0];
        console.log(`\nresolving stream for #1  (${t.provider}:${t.id})`);
        try {
            const info =
                t.provider === 'soundcloud'
                    ? await new SoundCloudProvider().getStreamUrl(t.id)
                    : await fallbackProvider.getStreamUrl(t.id);
            console.log(`  provider: ${info.provider}   quality: ${info.quality ?? '?'}`);
            console.log(`  url: ${String(info.url).slice(0, 100)}…`);
            console.log(`  cdn: ${await reach(info.url)}`);
        } catch (e) {
            console.log(`  stream FAILED: ${e instanceof Error ? e.message : e}`);
        }
    }

    process.exit(0);
}

main();
