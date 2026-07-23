import { Client, GatewayIntentBits, Interaction, REST, Routes } from 'discord.js';
import * as dotenv from 'dotenv';
import PocketBase from 'pocketbase';
import { data as playCommandData, execute as executePlayCommand } from './commands/play.js';
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
        }
    } 
    // Handle Button Interactions from the Dashboard
    else if (interaction.isButton()) {
        const guildId = interaction.guildId;
        if (!guildId) return;

        const player = getPlayer(guildId);
        if (!player.connection) {
            await interaction.reply({ content: 'Bot is not in a voice channel!', ephemeral: true });
            return;
        }

        const customId = interaction.customId;
        await interaction.deferUpdate();

        if (customId === 'btn_playpause') {
            if (player.player.state.status === 'playing') player.pause();
            else player.resume();
        } else if (customId === 'btn_skip') {
            player.skip();
        } else if (customId === 'btn_stop') {
            player.stop();
        }
    }
});

// Register commands
async function registerCommands() {
    const rest = new REST({ version: '10' }).setToken(DISCORD_TOKEN!);
    try {
        console.log('Started refreshing application (/) commands.');
        await rest.put(
            Routes.applicationCommands(CLIENT_ID!),
            { body: [playCommandData.toJSON()] },
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
