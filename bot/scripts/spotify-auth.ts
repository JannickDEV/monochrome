/**
 * One-time Spotify user authorization. Produces a SPOTIFY_REFRESH_TOKEN.
 *
 * NOTE: as of Spotify's Nov-2024 API lockdown this does NOT unlock playlist
 * reads — GET /playlists/{id}/tracks returns 403 for any app not in Extended
 * Quota Mode, user token or not. Playlists still fall back to the ~100-track
 * scraper. This flow is kept only so the bot is ready if Spotify ever grants
 * quota. No local server — you paste the redirected URL back in.
 *
 *   bun scripts/spotify-auth.ts
 */
import { createInterface } from 'node:readline';
import { config } from '../src/config.js';

const id = config.spotifyClientId;
const secret = config.spotifyClientSecret;
const redirect = config.spotifyRedirectUri;

if (!id || !secret) {
    console.error('Set SPOTIFY_CLIENT_ID and SPOTIFY_CLIENT_SECRET in bot/.env first.');
    process.exit(1);
}

const scope = 'playlist-read-private playlist-read-collaborative';
const authUrl =
    'https://accounts.spotify.com/authorize?' +
    new URLSearchParams({
        client_id: id,
        response_type: 'code',
        redirect_uri: redirect,
        scope,
        show_dialog: 'true', // always show the consent screen so scopes are (re)granted
    }).toString();

console.log(`
1. In your Spotify app (developer.spotify.com/dashboard -> your app -> Settings),
   add this exact Redirect URI and save:

       ${redirect}

2. Open this URL in a browser and click "Agree":

   ${authUrl}

3. Spotify redirects to ${redirect}?code=...  — the page won't load, that's fine.
   Copy the full address bar (or just the code=... value) and paste it below.
`);

const rl = createInterface({ input: process.stdin, output: process.stdout });
rl.question('Paste redirected URL or code: ', async (answer) => {
    rl.close();
    const trimmed = answer.trim();
    const qs = trimmed.includes('?') ? trimmed.slice(trimmed.indexOf('?') + 1) : trimmed;
    const code = qs.includes('code=') ? new URLSearchParams(qs).get('code') : trimmed;
    if (!code) {
        console.error('Could not find an authorization code in that input.');
        process.exit(1);
    }

    const auth = btoa(`${id}:${secret}`);
    const res = await fetch('https://accounts.spotify.com/api/token', {
        method: 'POST',
        headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: redirect }).toString(),
    });
    const j: any = await res.json();
    if (!res.ok || !j.refresh_token) {
        console.error('Token exchange failed:', JSON.stringify(j, null, 2));
        process.exit(1);
    }

    console.log(`
Granted scopes: ${j.scope || '(none!)'}

Add this line to bot/.env and restart the bot:

SPOTIFY_REFRESH_TOKEN=${j.refresh_token}
`);
    process.exit(0);
});
