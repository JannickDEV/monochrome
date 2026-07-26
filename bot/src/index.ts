import { Client, GatewayIntentBits, Interaction, REST, Routes, MessageFlags } from 'discord.js';
import * as dotenv from 'dotenv';
import PocketBase from 'pocketbase';
import { data as playCommandData, execute as executePlayCommand } from './commands/play.js';
import { data as queueCommandData, execute as executeQueueCommand } from './commands/queue.js';
import { data as clearCommandData, execute as executeClearCommand } from './commands/clear.js';
import { data as shuffleCommandData, execute as executeShuffleCommand } from './commands/shuffle.js';
import { getPlayer } from './audio/musicPlayer.js';
import express from 'express';
import cors from 'cors';
import { Readable } from 'stream';

dotenv.config();

const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;

if (!DISCORD_TOKEN || !CLIENT_ID) {
    console.error('Missing DISCORD_TOKEN or CLIENT_ID in environment variables.');
    process.exit(1);
}

// Initialize PocketBase
const pb = new PocketBase('https://pb-data.bitperfect.dedyn.io');
console.log('PocketBase initialized pointing to https://pb-data.bitperfect.dedyn.io');

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildVoiceStates,
        GatewayIntentBits.GuildMessages
    ]
});

client.once('clientReady', () => {
    console.log(`[Discord Bot] Logged in as ${client.user?.tag}!`);
});

// Setup Audio Proxy Server
const app = express();
app.use(cors());

app.get('/proxy-audio', async (req, res) => {
    const targetUrl = req.query.url as string;
    if (!targetUrl) return res.status(400).send('Missing url parameter');
    
    try {
        const fetchOptions: RequestInit = {};
        if (req.headers.range) {
            fetchOptions.headers = { 'Range': req.headers.range };
        }

        const fetchRes = await fetch(targetUrl, fetchOptions);
        if (!fetchRes.ok) return res.status(fetchRes.status).send(fetchRes.statusText);
        
        if (fetchRes.headers.has('content-type')) res.setHeader('Content-Type', fetchRes.headers.get('content-type')!);
        if (fetchRes.headers.has('content-length')) res.setHeader('Content-Length', fetchRes.headers.get('content-length')!);
        if (fetchRes.headers.has('accept-ranges')) res.setHeader('Accept-Ranges', fetchRes.headers.get('accept-ranges')!);
        if (fetchRes.headers.has('content-range')) res.setHeader('Content-Range', fetchRes.headers.get('content-range')!);
        
        if (fetchRes.body) {
            Readable.fromWeb(fetchRes.body as any).pipe(res);
        } else {
            res.end();
        }
    } catch (err) {
        console.error('[Audio Proxy] Error:', err);
        res.status(500).send('Proxy error');
    }
});

const PROXY_PORT = process.env.PROXY_PORT || 8080;
app.listen(PROXY_PORT, () => {
    console.log(`[Audio Proxy] Listening on port ${PROXY_PORT}`);
});

client.on('voiceStateUpdate', (oldState, newState) => {
    // If the bot itself left or was kicked from a voice channel
    if (oldState.channelId && !newState.channelId && oldState.id === client.user?.id) {
        const player = getPlayer(oldState.guild.id);
        if (player.connection) {
            console.log(`[Voice] Bot left channel ${oldState.channelId}, clearing queue...`);
            player.stop();
        }
    }
});

client.on('interactionCreate', async (interaction: Interaction) => {
    // Handle Slash Commands
    if (interaction.isChatInputCommand()) {
        if (interaction.commandName === 'play') {
            await executePlayCommand(interaction);
        } else if (interaction.commandName === 'queue') {
            await executeQueueCommand(interaction);
        } else if (interaction.commandName === 'clear') {
            await executeClearCommand(interaction);
        } else if (interaction.commandName === 'shuffle') {
            await executeShuffleCommand(interaction);
        }
    } 
    // Handle Button Interactions from the Dashboard
    else if (interaction.isButton()) {
        const guildId = interaction.guildId;
        if (!guildId) return;

        const player = getPlayer(guildId);
        if (!player.connection) {
            await interaction.reply({ content: 'Bot is not in a voice channel!', flags: MessageFlags.Ephemeral });
            return;
        }

        const customId = interaction.customId;

        if (customId === 'btn_playpause') {
            const isPlaying = player.player.state.status === 'playing';
            if (isPlaying) player.pause();
            else player.resume();
            await interaction.reply({ content: isPlaying ? 'Paused playback.' : 'Resumed playback.', flags: MessageFlags.Ephemeral });
        } else if (customId === 'btn_skip') {
            player.skip();
            await interaction.reply({ content: 'Skipped track.', flags: MessageFlags.Ephemeral });
        } else if (customId === 'btn_shuffle') {
            player.shuffle();
            await interaction.reply({ content: 'Shuffled the queue! 🔀', flags: MessageFlags.Ephemeral });
        } else if (customId === 'btn_stop') {
            player.stop();
            await interaction.reply({ content: 'Stopped playback.', flags: MessageFlags.Ephemeral });
        }
    }
});

// Register commands
async function registerCommands() {
    const rest = new REST({ version: '10' }).setToken(DISCORD_TOKEN!);
    try {
        console.log('Started refreshing application (/) commands.');

        const commands = [
            playCommandData.toJSON(),
            queueCommandData.toJSON(),
            clearCommandData.toJSON(),
            shuffleCommandData.toJSON()
        ];

        await rest.put(
            Routes.applicationCommands(CLIENT_ID!),
            { body: commands },
        );
        console.log('Successfully reloaded application (/) commands.');
    } catch (error) {
        console.error('Failed to register commands:', error);
    }
}

// Start the bot
async function bootstrap() {
    await registerCommands();
    await client.login(DISCORD_TOKEN);
}

bootstrap();
