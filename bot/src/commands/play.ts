import { ChatInputCommandInteraction, GuildMember, SlashCommandBuilder, TextChannel, MessageFlags } from 'discord.js';
import { getPlayer, Track } from '../audio/musicPlayer.js';
import { resolveQueryToTracks } from '../audio/urlParser.js';

export const data = new SlashCommandBuilder()
    .setName('play')
    .setDescription('Play a track or playlist')
    .addStringOption(option => 
        option.setName('query')
            .setDescription('Search query for Tidal/Qobuz')
            .setRequired(false))
    .addStringOption(option => 
        option.setName('title')
            .setDescription('Specific track title')
            .setRequired(false))
    .addStringOption(option => 
        option.setName('artist')
            .setDescription('Specific artist name')
            .setRequired(false))
    .addStringOption(option => 
        option.setName('url')
            .setDescription('Direct Track or Album URL (Tidal, Qobuz, SoundCloud)')
            .setRequired(false))
    .addStringOption(option => 
        option.setName('playlist')
            .setDescription('Direct Playlist URL (Spotify, Tidal, Qobuz, SoundCloud)')
            .setRequired(false));

export async function execute(interaction: ChatInputCommandInteraction) {
    const member = interaction.member as GuildMember;
    const channel = interaction.channel as TextChannel;
    
    if (!member.voice.channel) {
        return interaction.reply({ content: 'You must be in a voice channel!', flags: MessageFlags.Ephemeral });
    }

    const rawQuery = interaction.options.getString('query');
    const urlQuery = interaction.options.getString('url');
    const playlistQuery = interaction.options.getString('playlist');
    const query = rawQuery || urlQuery || playlistQuery;
    const title = interaction.options.getString('title');
    const artist = interaction.options.getString('artist');

    if (!query && !title) {
        return interaction.reply({ content: 'You must provide a query, url, playlist, or a title!', flags: MessageFlags.Ephemeral });
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const player = getPlayer(interaction.guildId!);
    
    try {
        if (!player.connection) {
            await player.join(member, channel);
        }

        let fullQuery = query || '';
        if (title) fullQuery += ` ${title}`;
        if (artist) fullQuery += ` ${artist}`;

        const tracks = await resolveQueryToTracks(fullQuery, interaction);

        if (!tracks || tracks.length === 0) {
            // resolveQueryToTracks handles its own editReply for empty/errors, 
            // but just in case we hit a silent empty array fallback:
            if (!interaction.replied) await interaction.editReply('No tracks found!');
            return;
        }

        for (const track of tracks) {
            await player.addTrack(track);
        }

        await interaction.editReply(`Added ${tracks.length} track(s) to queue!`);

    } catch (error) {
        console.error(error);
        await interaction.editReply(`Error playing track: ${error instanceof Error ? error.message : 'Unknown'}`);
    }
}
