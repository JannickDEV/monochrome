/**
 * One-time Spotify user authorization. No local server — you paste the
 * redirected URL back in.
 *
 *   bun run spotify-auth                 # your own dev app -> SPOTIFY_REFRESH_TOKEN
 *   bun run spotify-auth -- --firstparty # Spotify's desktop client -> SPOTIFY_FIRSTPARTY_REFRESH_TOKEN
 *
 * Plain mode (dev app): the resulting token does NOT unlock playlist reads —
 * since Spotify's Nov-2024 lockdown, GET /playlists/{id}/tracks 403s for any
 * app not in Extended Quota Mode. Kept only in case Spotify ever grants quota.
 *
 * --firstparty: authorizes against Spotify's own desktop ("keymaster") client
 * id — the same one librespot / OnTheSpot use — via PKCE (no secret). Tokens
 * minted from the resulting refresh token are the official-client identity and
 * read playlists in full, past 100. ToS-gray; private instances only.
 */
import { createInterface } from 'node:readline';
import { config } from '../src/config.js';

const KEYMASTER_CLIENT_ID = '65b708073fc0480ea92a077233ca87bd';
const firstParty = process.argv.includes('--firstparty');

const b64url = (buf: ArrayBuffer | Uint8Array): string =>
    btoa(String.fromCharCode(...new Uint8Array(buf as ArrayBuffer)))
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/, '');

async function main() {
    const scope = 'playlist-read-private playlist-read-collaborative user-library-read';

    let clientId: string;
    let secret: string | null = null;
    let redirect: string;
    let codeVerifier: string | null = null;
    const params: Record<string, string> = { response_type: 'code', scope, show_dialog: 'true' };

    if (firstParty) {
        clientId = KEYMASTER_CLIENT_ID;
        redirect = process.env.SPOTIFY_FIRSTPARTY_REDIRECT_URI || 'http://127.0.0.1:5588/login';
        codeVerifier = b64url(crypto.getRandomValues(new Uint8Array(64)));
        const challenge = b64url(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(codeVerifier)));
        params.code_challenge = challenge;
        params.code_challenge_method = 'S256';
    } else {
        if (!config.spotifyClientId || !config.spotifyClientSecret) {
            console.error('Set SPOTIFY_CLIENT_ID and SPOTIFY_CLIENT_SECRET in bot/.env first.');
            process.exit(1);
        }
        clientId = config.spotifyClientId;
        secret = config.spotifyClientSecret;
        redirect = config.spotifyRedirectUri;
    }

    params.client_id = clientId;
    params.redirect_uri = redirect;
    const authUrl = 'https://accounts.spotify.com/authorize?' + new URLSearchParams(params).toString();

    console.log(`
${
    firstParty
        ? `Mode: FIRST-PARTY (keymaster client ${clientId}). No app registration needed —
   the loopback redirect ${redirect} is accepted for this client.`
        : `Mode: dev app (${clientId}). In developer.spotify.com/dashboard -> your app
   -> Settings, add this exact Redirect URI and save:  ${redirect}`
}

1. Open this URL in a browser and log in / click "Agree":

   ${authUrl}

2. Spotify redirects to ${redirect}?code=...  — the page won't load, that's fine.
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

        const tokenBody: Record<string, string> = {
            grant_type: 'authorization_code',
            code,
            redirect_uri: redirect,
            client_id: clientId,
        };
        const headers: Record<string, string> = { 'Content-Type': 'application/x-www-form-urlencoded' };
        if (firstParty) {
            tokenBody.code_verifier = codeVerifier!;
        } else {
            headers.Authorization = `Basic ${btoa(`${clientId}:${secret}`)}`;
        }

        const res = await fetch('https://accounts.spotify.com/api/token', {
            method: 'POST',
            headers,
            body: new URLSearchParams(tokenBody).toString(),
        });
        const j: any = await res.json();
        if (!res.ok || !j.refresh_token) {
            console.error('Token exchange failed:', JSON.stringify(j, null, 2));
            process.exit(1);
        }

        const envVar = firstParty ? 'SPOTIFY_FIRSTPARTY_REFRESH_TOKEN' : 'SPOTIFY_REFRESH_TOKEN';
        console.log(`
Granted scopes: ${j.scope || '(none!)'}

Add this line to bot/.env and restart the bot:

${envVar}=${j.refresh_token}
`);
        process.exit(0);
    });
}

main();
