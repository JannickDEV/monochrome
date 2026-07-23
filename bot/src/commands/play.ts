import { ChatInputCommandInteraction, GuildMember, SlashCommandBuilder, TextChannel } from 'discord.js';
import { getPlayer, Track } from '../audio/musicPlayer.js';
import { defaultSearchProvider } from '../api/devMode.js';
import { SoundCloudProvider } from '../api/soundcloud.js';

const scProvider = new SoundCloudProvider();

export const data = new SlashCommandBuilder()
    .setName('play')
    .setDescription('Play a track from Monochrome')
    .addStringOption(option => 
        option.setName('query')
            .setDescription('URL or generic search query')
            .setRequired(false))
    .addStringOption(option => 
        option.setName('title')
            .setDescription('Specific title to search for')
            .setRequired(false))
    .addStringOption(option => 
        option.setName('artist')
            .setDescription('Specific artist to search for')
            .setRequired(false));

export async function execute(interaction: ChatInputCommandInteraction) {
    const member = interaction.member as GuildMember;
    const channel = interaction.channel as TextChannel;
    
    if (!member.voice.channel) {
        return interaction.reply({ content: 'You must be in a voice channel!', ephemeral: true });
    }

    const query = interaction.options.getString('query');
    const title = interaction.options.getString('title');
    const artist = interaction.options.getString('artist');

    if (!query && !title) {
        return interaction.reply({ content: 'You must provide a query or a title!', ephemeral: true });
    }

    await interaction.deferReply({ ephemeral: true });
    const player = getPlayer(interaction.guildId!);
    
    try {
        if (!player.connection) {
            await player.join(member, channel);
        }

        let tracks: Track[] = [];

        // 1. URL Support & SoundCloud Direct Bypass Mode
        if (query && (query.startsWith('http://') || query.startsWith('https://'))) {
            if (query.includes('soundcloud.com')) {
                const scTrack = await scProvider.resolveUrl(query);
                if (scTrack) tracks.push(scTrack);
            } else {
                // TODO: Support Monochrome sharing links (e.g., https://monochrome.tf/track/123)
                await interaction.editReply('Generic URLs not fully supported yet unless it is SoundCloud.');
                return;
            }
        } 
        // 2. Text Search (Tidal Default Provider)
        else {
            let searchQuery = query || '';
            if (title) searchQuery += ` ${title}`;
            if (artist) searchQuery += ` ${artist}`;
            
            // Text search prioritizes TIDAL as per plan
            const searchResults = await defaultSearchProvider.searchTracks(searchQuery.trim(), { limit: 5 });
            if (searchResults && searchResults.items && searchResults.items.length > 0) {
                const item = searchResults.items[0];
                tracks.push({
                    id: item.id,
                    title: item.title,
                    artist: { name: item.artist?.name || 'Unknown', id: item.artist?.id },
                    provider: item.provider || 'tidal', // defaultSearchProvider is tidalProvider
                    cover: item.cover || item.image || null
                });
            }
        }

        if (tracks.length === 0) {
            await interaction.editReply('No tracks found!');
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
