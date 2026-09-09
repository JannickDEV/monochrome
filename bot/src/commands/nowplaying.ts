import { ChatInputCommandInteraction, SlashCommandBuilder, EmbedBuilder, MessageFlags } from 'discord.js';
import { getPlayer } from '../audio/musicPlayer.js';

export const data = new SlashCommandBuilder()
    .setName('nowplaying')
    .setDescription('Show the current track');

export async function execute(interaction: ChatInputCommandInteraction) {
    if (!interaction.guildId) {
        return interaction.reply({ content: 'Server only.', flags: MessageFlags.Ephemeral });
    }
    const player = getPlayer(interaction.guildId);
    const t = player.currentTrack;
    if (!t) {
        return interaction.reply({ content: 'Nothing is playing.', flags: MessageFlags.Ephemeral });
    }

    const embed = new EmbedBuilder()
        .setColor(0x2b2d31)
        .setTitle(t.title)
        .setDescription(
            `by **${t.artist.name}**\n\n` +
                `Provider: \`${t.provider.toUpperCase()}\`` +
                (player.isPaused ? '  •  ⏸ paused' : '') +
                (player.queue.length ? `\nUp next: **${player.queue.length}** track(s)` : '')
        );
    if (t.cover) embed.setThumbnail(t.cover);

    return interaction.reply({ embeds: [embed] });
}
