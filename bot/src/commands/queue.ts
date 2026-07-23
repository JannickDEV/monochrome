import { ChatInputCommandInteraction, SlashCommandBuilder, MessageFlags, EmbedBuilder } from 'discord.js';
import { getPlayer } from '../audio/musicPlayer.js';

export const data = new SlashCommandBuilder()
    .setName('queue')
    .setDescription('Show the current music queue');

export async function execute(interaction: ChatInputCommandInteraction) {
    const guildId = interaction.guildId;
    if (!guildId) {
        await interaction.reply({ content: 'This command can only be used in a server.', flags: MessageFlags.Ephemeral });
        return;
    }

    const player = getPlayer(guildId);
    if (!player.currentTrack && player.queue.length === 0) {
        await interaction.reply('The queue is currently empty.');
        return;
    }

    const embed = new EmbedBuilder()
        .setColor('#2b2d31')
        .setTitle('Music Queue');

    let description = '';

    if (player.currentTrack) {
        description += `**Now Playing:**\n[${player.currentTrack.title}](${player.currentTrack.url || '#'}) by ${player.currentTrack.artist.name}\n\n`;
    }

    if (player.queue.length > 0) {
        description += `**Up Next:**\n`;
        const nextTracks = player.queue.slice(0, 10);
        nextTracks.forEach((track, index) => {
            description += `${index + 1}. ${track.title} - ${track.artist.name}\n`;
        });
        
        if (player.queue.length > 10) {
            description += `\n*...and ${player.queue.length - 10} more tracks*`;
        }
    }

    embed.setDescription(description);
    
    if (player.currentTrack?.cover) {
        embed.setThumbnail(player.currentTrack.cover);
    }

    await interaction.reply({ embeds: [embed] });
}
