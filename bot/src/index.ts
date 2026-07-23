import { Client, GatewayIntentBits, Interaction, REST, Routes, MessageFlags } from 'discord.js';
import * as dotenv from 'dotenv';
import PocketBase from 'pocketbase';
import { data as playCommandData, execute as executePlayCommand } from './commands/play.js';
import { data as queueCommandData, execute as executeQueueCommand } from './commands/queue.js';
import { data as clearCommandData, execute as executeClearCommand } from './commands/clear.js';
import { getPlayer } from './audio/musicPlayer.js';

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

client.on('interactionCreate', async (interaction: Interaction) => {
    // Handle Slash Commands
    if (interaction.isChatInputCommand()) {
        if (interaction.commandName === 'play') {
            await executePlayCommand(interaction);
        } else if (interaction.commandName === 'queue') {
            await executeQueueCommand(interaction);
        } else if (interaction.commandName === 'clear') {
            await executeClearCommand(interaction);
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
            clearCommandData.toJSON()
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
