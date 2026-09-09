import { ChatInputCommandInteraction, SlashCommandBuilder, MessageFlags } from 'discord.js';
import { getPlayer } from '../audio/musicPlayer.js';

export const data = new SlashCommandBuilder().setName('resume').setDescription('Resume playback');

export async function execute(interaction: ChatInputCommandInteraction) {
    if (!interaction.guildId) {
        return interaction.reply({ content: 'Server only.', flags: MessageFlags.Ephemeral });
    }
    const player = getPlayer(interaction.guildId);
    if (!player.isPaused) {
        return interaction.reply({ content: 'Playback is not paused.', flags: MessageFlags.Ephemeral });
    }
    player.resume();
    return interaction.reply({ content: 'Resumed.', flags: MessageFlags.Ephemeral });
}
