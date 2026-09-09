# Monochrome Discord Bot

A small Discord music bot that reuses the main app's provider layer
(`js/services/*`) for Tidal / Qobuz streaming with ISRC-based cross-resolution,
plus SoundCloud and Spotify-playlist support.

## Run

```bash
cp .env.example .env      # fill in DISCORD_TOKEN + CLIENT_ID
bun install
bun run dev               # or: bun run start
```

Set `GUILD_ID` in `.env` while developing so slash commands register instantly.

## Commands

| Command        | Description                                                    |
| -------------- | ------------------------------------------------------------- |
| `/play`        | `query` / `url` / `playlist` / `title`+`artist`              |
| `/queue`       | Show the queue                                               |
| `/nowplaying`  | Show the current track                                       |
| `/skip`        | Skip the current track                                       |
| `/pause` `/resume` | Pause / resume                                           |
| `/shuffle`     | Shuffle the upcoming queue                                   |
| `/clear`       | Clear upcoming tracks (keeps playing the current one)        |
| `/stop`        | Stop, clear the queue and leave the channel                  |

The bot also posts a persistent **control dashboard** message with
Play/Pause · Skip · Shuffle · Stop buttons.

## Behaviour

- One player per guild.
- Leaves the voice channel after `IDLE_DISCONNECT_MS` (default 5 min) with
  nothing playing, or immediately when the last human leaves.
- ffmpeg child processes are tracked and killed on skip/stop/track-change.
- A `/play` with a huge playlist is capped at `MAX_QUEUE_ADD` (default 200).
- Tidal / Qobuz playlists and albums are fully paginated.
- Spotify resolution order for a `/play <spotify url>`:
  1. **First-party token** — if `SPOTIFY_FIRSTPARTY_REFRESH_TOKEN` is set, the
     bot refreshes it against Spotify's own desktop client id (the same one
     librespot / OnTheSpot use) and reads the playlist/album **in full, past
     100**, straight from the Web API. This is the official-client identity, so
     it isn't subject to the developer-app restrictions. Get the token once
     with `bun run spotify-auth-fp`. ToS-gray — private instances only.

     Spotify **rotates** this refresh token on every use, so `.env` only seeds
     the first refresh — after that the bot keeps the current token in
     `bot/.spotify-fp-refresh-token` (gitignored) and reads that first. Don't
     run `probe` against a Spotify URL while the bot is live: both processes
     would race to rotate the same token and one loses it. If it ever ends up
     revoked, re-run `bun run spotify-auth-fp`.
  2. **Dev app** — `SPOTIFY_CLIENT_ID` + `SPOTIFY_CLIENT_SECRET` read **albums**
     fully. They do **not** read playlists: since Spotify's Nov-2024 lockdown
     `GET /playlists/{id}/tracks` returns a bare `403` for any app not in
     Extended Quota Mode, and a user `SPOTIFY_REFRESH_TOKEN` does not change
     that.
  3. **Embed scraper** (`spotify-url-info`) — the fallback when neither of the
     above yields the list. Spotify caps it near the first 100 tracks;
     editorial playlists (`37i9dQZF1DX…`) come through here too.

## Test without Discord

`scripts/probe.ts` runs the real resolution + streaming code with a fake
interaction — no gateway connection:

```bash
bun run probe "daft punk one more time"                 # text search
bun run probe "https://open.spotify.com/playlist/…"      # checks Spotify creds + pagination
bun run probe "https://tidal.com/browse/album/…"
bun run probe "<any supported url>" --stream             # also resolve the CDN URL and reach it
```

It prints which backends it's using, whether the Spotify token was acquired,
the resolved track list, and (with `--stream`) the stream URL + an HTTP range
check against the CDN.

## Proxy

`src/index.ts` also runs a tiny HTTP proxy (`/proxy-audio`, `/proxy-api`) on
`PROXY_BIND:PROXY_PORT` (default `127.0.0.1:8080`). It is the backend the VPS
nginx (`audioproxy.conf`) reverse-proxies for the web app's legacy audio path.
It only relays plain external `http(s)` URLs (SSRF-guarded).
