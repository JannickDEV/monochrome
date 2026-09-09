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
import { resolveQueryToTracks, spotifyAccessToken, spotifyTokenTier } from '../src/audio/urlParser.js';
import { loadStoredRefreshToken } from '../src/spotify-token-store.js';
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
    const haveFp = !!(loadStoredRefreshToken() ?? config.spotifyFpRefreshToken);
    const haveDevApp = !!(config.spotifyClientId && config.spotifyClientSecret);
    if (!haveFp && !haveDevApp) {
        console.log('spotify .......... no creds  (albums + playlists via ~100-track scraper)');
        return;
    }

    // Goes through the same code path the bot uses — including first-party
    // refresh-token rotation + persistence — so it doesn't burn the token.
    const token = await spotifyAccessToken().catch(() => null);
    const tier = spotifyTokenTier();
    if (!token) {
        console.log(
            `spotify .......... FAILED to mint a token` +
                `${haveFp ? '  (first-party token revoked? re-run `bun run spotify-auth-fp`)' : ''}`
        );
        return;
    }
    console.log(
        `spotify .......... OK  [${
            tier === 'first-party'
                ? 'first-party / keymaster — reads playlists via the Web API'
                : 'dev app — albums only, playlists via ~100-track scraper'
        }]`
    );
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
