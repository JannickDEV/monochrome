import { ChatInputCommandInteraction, SlashCommandBuilder, MessageFlags } from 'discord.js';
import { getPlayer } from '../audio/musicPlayer.js';

export const data = new SlashCommandBuilder().setName('skip').setDescription('Skip the current track');

export async function execute(interaction: ChatInputCommandInteraction) {
    if (!interaction.guildId) {
        return interaction.reply({ content: 'Server only.', flags: MessageFlags.Ephemeral });
    }
    const player = getPlayer(interaction.guildId);
    if (!player.currentTrack && player.queue.length === 0) {
        return interaction.reply({ content: 'Nothing to skip.', flags: MessageFlags.Ephemeral });
    }
    player.skip();
    return interaction.reply({ content: 'Skipped.', flags: MessageFlags.Ephemeral });
}
