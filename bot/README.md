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

## Proxy

`src/index.ts` also runs a tiny HTTP proxy (`/proxy-audio`, `/proxy-api`) on
`PROXY_BIND:PROXY_PORT` (default `127.0.0.1:8080`). It is the backend the VPS
nginx (`audioproxy.conf`) reverse-proxies for the web app's legacy audio path.
It only relays plain external `http(s)` URLs (SSRF-guarded).
