import { ChatInputCommandInteraction, SlashCommandBuilder, MessageFlags, EmbedBuilder } from 'discord.js';
import { getPlayer } from '../audio/musicPlayer.js';
import { EMBED_LIMITS, joinWithin, trackLine } from '../ui/format.js';

export const data = new SlashCommandBuilder().setName('queue').setDescription('Show the current music queue');

const SHOWN = 10;

export async function execute(interaction: ChatInputCommandInteraction) {
    const guildId = interaction.guildId;
    if (!guildId) {
        await interaction.reply({
            content: 'This command can only be used in a server.',
            flags: MessageFlags.Ephemeral,
        });
        return;
    }

    const player = getPlayer(guildId);
    if (!player.currentTrack && player.queue.length === 0) {
        await interaction.reply('The queue is currently empty.');
        return;
    }

    const embed = new EmbedBuilder().setColor('#2b2d31').setTitle('Music Queue');

    let description = '';

    if (player.currentTrack) {
        description += `**Now Playing:**\n${trackLine(player.currentTrack)}\n\n`;
    }

    if (player.queue.length > 0) {
        description += `**Up Next:**\n`;
        const lines = player.queue.slice(0, SHOWN).map((track, i) => trackLine(track, i + 1));
        const hidden = Math.max(0, player.queue.length - SHOWN);
        description += joinWithin(lines, EMBED_LIMITS.description - description.length, hidden);
    }

    embed.setDescription(description);

    if (player.currentTrack?.cover) {
        embed.setThumbnail(player.currentTrack.cover);
    }

    await interaction.reply({ embeds: [embed] });
}
