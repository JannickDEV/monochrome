import {
    ChatInputCommandInteraction,
    GuildMember,
    SlashCommandBuilder,
    TextChannel,
    MessageFlags,
} from 'discord.js';
import { getPlayer } from '../audio/musicPlayer.js';
import { resolveQueryToTracks } from '../audio/urlParser.js';

export const data = new SlashCommandBuilder()
    .setName('play')
    .setDescription('Play a track or playlist')
    .addStringOption((o) => o.setName('query').setDescription('Search text').setRequired(false))
    .addStringOption((o) => o.setName('title').setDescription('Specific track title').setRequired(false))
    .addStringOption((o) => o.setName('artist').setDescription('Specific artist name').setRequired(false))
    .addStringOption((o) =>
        o.setName('url').setDescription('Track / album URL (Tidal, Qobuz, SoundCloud)').setRequired(false)
    )
    .addStringOption((o) =>
        o
            .setName('playlist')
            .setDescription('Playlist URL (Spotify, Tidal, Qobuz)')
            .setRequired(false)
    );

export async function execute(interaction: ChatInputCommandInteraction) {
    const member = interaction.member as GuildMember;
    const channel = interaction.channel;

    if (!member?.voice?.channel) {
        return interaction.reply({ content: 'You must be in a voice channel!', flags: MessageFlags.Ephemeral });
    }
    if (!channel || !('send' in channel)) {
        return interaction.reply({ content: 'Run this in a normal text channel.', flags: MessageFlags.Ephemeral });
    }

    const url = interaction.options.getString('url') || interaction.options.getString('playlist');
    const text = interaction.options.getString('query');
    const title = interaction.options.getString('title');
    const artist = interaction.options.getString('artist');

    if (!url && !text && !title) {
        return interaction.reply({
            content: 'Give me a query, url, playlist, or title.',
            flags: MessageFlags.Ephemeral,
        });
    }

    // A URL is passed through untouched; otherwise join the text fragments.
    const query = url || [text, title, artist].filter(Boolean).join(' ');

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const player = getPlayer(interaction.guildId!);

    try {
        if (!player.connection) {
            await player.join(member, channel as TextChannel);
        }

        const tracks = await resolveQueryToTracks(query, interaction);
        if (tracks.length === 0) return; // resolveQueryToTracks already explained why

        player.addTracks(tracks);
        await interaction.editReply(
            tracks.length === 1
                ? `Queued **${tracks[0].title}**.`
                : `Queued **${tracks.length}** tracks.`
        );
    } catch (error) {
        console.error('[play] error:', error);
        await interaction
            .editReply(`Error: ${error instanceof Error ? error.message : 'unknown'}`)
            .catch(() => {});
    }
}
