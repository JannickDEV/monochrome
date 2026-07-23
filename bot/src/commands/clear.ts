import { ChatInputCommandInteraction, SlashCommandBuilder, MessageFlags } from 'discord.js';
import { getPlayer } from '../audio/musicPlayer.js';

export const data = new SlashCommandBuilder()
    .setName('clear')
    .setDescription('Clear all upcoming tracks from the queue (does not stop the current track)');

export async function execute(interaction: ChatInputCommandInteraction) {
    const guildId = interaction.guildId;
    if (!guildId) {
        await interaction.reply({ content: 'This command can only be used in a server.', flags: MessageFlags.Ephemeral });
        return;
    }

    const player = getPlayer(guildId);
    
    if (player.queue.length === 0) {
        await interaction.reply('The queue is already empty.');
        return;
    }

    const count = player.queue.length;
    player.queue = [];
    
    await interaction.reply(`Cleared ${count} tracks from the queue.`);
}
