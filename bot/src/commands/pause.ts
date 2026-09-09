import { ChatInputCommandInteraction, SlashCommandBuilder, MessageFlags } from 'discord.js';
import { getPlayer } from '../audio/musicPlayer.js';

export const data = new SlashCommandBuilder().setName('pause').setDescription('Pause playback');

export async function execute(interaction: ChatInputCommandInteraction) {
    if (!interaction.guildId) {
        return interaction.reply({ content: 'Server only.', flags: MessageFlags.Ephemeral });
    }
    const player = getPlayer(interaction.guildId);
    if (!player.currentTrack) {
        return interaction.reply({ content: 'Nothing is playing.', flags: MessageFlags.Ephemeral });
    }
    player.pause();
    return interaction.reply({ content: 'Paused.', flags: MessageFlags.Ephemeral });
}
