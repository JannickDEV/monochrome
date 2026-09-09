import { ChatInputCommandInteraction, SlashCommandBuilder, MessageFlags } from 'discord.js';
import { getPlayer } from '../audio/musicPlayer.js';

export const data = new SlashCommandBuilder()
    .setName('stop')
    .setDescription('Stop playback, clear the queue and leave the voice channel');

export async function execute(interaction: ChatInputCommandInteraction) {
    if (!interaction.guildId) {
        return interaction.reply({ content: 'Server only.', flags: MessageFlags.Ephemeral });
    }
    const player = getPlayer(interaction.guildId);
    if (!player.connection) {
        return interaction.reply({ content: 'I am not in a voice channel.', flags: MessageFlags.Ephemeral });
    }
    player.stop();
    return interaction.reply({ content: 'Stopped and left the channel.', flags: MessageFlags.Ephemeral });
}
