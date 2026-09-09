import { Client, GatewayIntentBits, Interaction, REST, Routes, MessageFlags } from 'discord.js';
import express from 'express';
import cors from 'cors';
import { Readable } from 'stream';
import { config, isProxyableUrl } from './config.js';
import { commands, commandMap } from './commands/index.js';
import { getPlayer } from './audio/musicPlayer.js';
import { spotifyAccessToken, spotifyTokenTier } from './audio/urlParser.js';
import { loadStoredRefreshToken } from './spotify-token-store.js';

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildVoiceStates,
        GatewayIntentBits.GuildMessages,
    ],
});

client.once('clientReady', () => {
    console.log(`[bot] Logged in as ${client.user?.tag}`);
});

// --- Audio / API proxy (sits behind the VPS nginx) ---------------------------

const app = express();
app.use(cors());

app.get('/proxy-audio', async (req, res) => {
    const targetUrl = req.query.url;
    if (!isProxyableUrl(targetUrl)) {
        res.status(400).send('Missing or disallowed url parameter');
        return;
    }

    try {
        const headers: Record<string, string> = {};
        if (req.headers.range) headers['Range'] = req.headers.range;

        const upstream = await fetch(targetUrl, { headers });
        if (!upstream.ok && upstream.status !== 206) {
            res.status(upstream.status).send(upstream.statusText);
            return;
        }

        res.status(upstream.status);
        for (const h of ['content-type', 'content-length', 'accept-ranges', 'content-range']) {
            const v = upstream.headers.get(h);
            if (v) res.setHeader(h, v);
        }

        if (upstream.body) {
            Readable.fromWeb(upstream.body as any).pipe(res);
        } else {
            res.end();
        }
    } catch (err) {
        console.error('[proxy-audio] error:', err);
        res.status(502).send('Proxy error');
    }
});

app.get('/proxy-api', async (req, res) => {
    const targetUrl = req.query.url;
    if (!isProxyableUrl(targetUrl)) {
        res.status(400).send('Missing or disallowed url parameter');
        return;
    }

    try {
        const upstream = await fetch(targetUrl);
        if (!upstream.ok) {
            res.status(upstream.status).send(upstream.statusText);
            return;
        }
        res.setHeader('Content-Type', upstream.headers.get('content-type') || 'application/octet-stream');
        res.status(upstream.status).send(Buffer.from(await upstream.arrayBuffer()));
    } catch (err) {
        console.error('[proxy-api] error:', err);
        res.status(502).send('Proxy error');
    }
});

app.listen(config.proxyPort, config.proxyBind, () => {
    console.log(`[proxy] listening on ${config.proxyBind}:${config.proxyPort}`);
});

// --- Voice channel housekeeping --------------------------------------------

client.on('voiceStateUpdate', (oldState, newState) => {
    const botId = client.user?.id;
    if (!botId) return;

    // Bot itself was moved/kicked out of a voice channel.
    if (oldState.id === botId && oldState.channelId && !newState.channelId) {
        const player = getPlayer(oldState.guild.id);
        if (player.connection) {
            console.log(`[voice] bot left ${oldState.channelId}, tearing down`);
            player.stop();
        }
        return;
    }

    // A human left a channel the bot is sitting in, leaving it alone.
    const left = oldState.channel && (!newState.channel || newState.channelId !== oldState.channelId);
    if (left && oldState.channel!.members.has(botId)) {
        const humans = oldState.channel!.members.filter((m) => !m.user.bot).size;
        if (humans === 0) {
            const player = getPlayer(oldState.guild.id);
            if (player.connection) {
                console.log('[voice] channel empty, leaving');
                player.dashboardChannel?.send('Everyone left — leaving the voice channel.').catch(() => {});
                player.stop();
            }
        }
    }
});

// --- Interactions ---------------------------------------------------------

client.on('interactionCreate', async (interaction: Interaction) => {
    if (interaction.isChatInputCommand()) {
        const command = commandMap.get(interaction.commandName);
        if (!command) return;
        try {
            await command.execute(interaction);
        } catch (err) {
            console.error(`[command:${interaction.commandName}] error:`, err);
            const content = 'Something went wrong running that command.';
            if (interaction.deferred || interaction.replied) {
                await interaction.editReply({ content }).catch(() => {});
            } else {
                await interaction.reply({ content, flags: MessageFlags.Ephemeral }).catch(() => {});
            }
        }
        return;
    }

    if (interaction.isButton()) {
        const guildId = interaction.guildId;
        if (!guildId) return;
        const player = getPlayer(guildId);

        if (!player.connection) {
            await interaction
                .reply({ content: 'The bot is not in a voice channel.', flags: MessageFlags.Ephemeral })
                .catch(() => {});
            return;
        }

        switch (interaction.customId) {
            case 'btn_playpause':
                if (player.isPaused) player.resume();
                else player.pause();
                break;
            case 'btn_skip':
                player.skip();
                break;
            case 'btn_shuffle':
                player.shuffle();
                break;
            case 'btn_stop':
                player.stop();
                break;
        }
        // Silent ack — the dashboard message reflects the new state.
        await interaction.deferUpdate().catch(() => {});
    }
});

// --- Startup ----------------------------------------------------------------

async function registerCommands() {
    const rest = new REST({ version: '10' }).setToken(config.discordToken);
    const body = commands.map((c) => c.data.toJSON());
    const route = config.guildId
        ? Routes.applicationGuildCommands(config.clientId, config.guildId)
        : Routes.applicationCommands(config.clientId);

    await rest.put(route, { body });
    console.log(`[bot] Registered ${body.length} command(s) ${config.guildId ? `to guild ${config.guildId}` : 'globally'}`);
}

async function reportSpotify() {
    const configured =
        !!config.spotifyFpRefreshToken ||
        !!loadStoredRefreshToken() ||
        !!config.spotifyClientId ||
        !!config.spotifyRefreshToken;
    if (!configured) return;
    try {
        const ok = await spotifyAccessToken();
        const tier = spotifyTokenTier();
        if (!ok) console.warn('[spotify] no usable token — playlists will use the ~100-track scraper');
        else if (tier === 'first-party') console.log('[spotify] first-party token OK — playlists read in full');
        else console.log('[spotify] dev-app token OK — albums only, playlists via the ~100-track scraper');
    } catch {
        /* non-fatal */
    }
}

async function bootstrap() {
    try {
        await registerCommands();
    } catch (err) {
        console.error('[bot] Failed to register commands:', err);
    }
    await reportSpotify();
    await client.login(config.discordToken);
}

bootstrap().catch((err) => {
    console.error('[bot] Fatal startup error:', err);
    process.exit(1);
});
