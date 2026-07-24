import spotifyUrlInfo from 'spotify-url-info';
import { Track } from './musicPlayer.js';
import { defaultSearchProvider, tidalProvider, qobuzProvider } from '../api/devMode.js';
import { SoundCloudProvider } from '../api/soundcloud.js';
import { ChatInputCommandInteraction } from 'discord.js';

const { getTracks: getSpotifyTracks } = spotifyUrlInfo(fetch);
const scProvider = new SoundCloudProvider();

export async function resolveQueryToTracks(query: string, interaction: ChatInputCommandInteraction): Promise<Track[]> {
    let tracks: Track[] = [];

    // 1. URL Support
    if (query.startsWith('http://') || query.startsWith('https://')) {
        if (query.includes('soundcloud.com')) {
            const scTrack = await scProvider.resolveUrl(query);
            if (scTrack) tracks.push(scTrack);
        } else if (query.includes('tidal.com/')) {
            if (query.includes('tidal.com/browse/playlist/') || query.includes('tidal.com/playlist/')) {
                const idMatch = query.match(/playlist\/([a-zA-Z0-9-]+)/);
                if (idMatch) {
                    await interaction.editReply('Fetching Tidal playlist...');
                    try {
                        const tidalRes = await fetch(`https://hf-core.bitperfect.dedyn.io/playlist/?id=${idMatch[1]}`);
                        if (tidalRes.ok) {
                            const data = await tidalRes.json();
                            const items = data.items || data.playlist?.items || [];
                            if (items.length > 0) {
                                for (const entry of items) {
                                    const item = entry.item || entry;
                                    if (item && item.id) {
                                        tracks.push({
                                            id: item.id.toString(),
                                            title: item.title,
                                            artist: { name: item.artist?.name || 'Unknown', id: item.artist?.id?.toString() },
                                            provider: 'tidal',
                                            cover: item.album?.cover ? defaultSearchProvider.getCoverUrl(item.album.cover) : null
                                        });
                                    }
                                }
                            } else {
                                await interaction.editReply('Playlist is empty or could not be found.');
                                return [];
                            }
                        } else {
                            await interaction.editReply(`Failed to fetch Tidal playlist. Error ${tidalRes.status}`);
                            return [];
                        }
                    } catch (e: any) {
                        await interaction.editReply(`Failed to parse Tidal playlist: ${e.message}`);
                        return [];
                    }
                } else {
                    await interaction.editReply('Could not extract a valid Tidal playlist ID from the URL.');
                    return [];
                }
            } else if (query.includes('tidal.com/browse/album/') || query.includes('tidal.com/album/')) {
                const idMatch = query.match(/album\/([0-9]+)/);
                if (idMatch) {
                    await interaction.editReply('Fetching Tidal album...');
                    try {
                        const tidalRes = await fetch(`https://hf-core.bitperfect.dedyn.io/album/?id=${idMatch[1]}`);
                        if (tidalRes.ok) {
                            const data = await tidalRes.json();
                            const items = data.items || data.data?.items || [];
                            if (items.length > 0) {
                                for (const entry of items) {
                                    const item = entry.item || entry;
                                    if (item && item.id) {
                                        tracks.push({
                                            id: item.id.toString(),
                                            title: item.title,
                                            artist: { name: item.artist?.name || 'Unknown', id: item.artist?.id?.toString() },
                                            provider: 'tidal',
                                            cover: item.album?.cover || data.data?.cover ? defaultSearchProvider.getCoverUrl(item.album?.cover || data.data?.cover) : null
                                        });
                                    }
                                }
                            } else {
                                await interaction.editReply('Album is empty or could not be found.');
                                return [];
                            }
                        } else {
                            await interaction.editReply(`Failed to fetch Tidal album. Error ${tidalRes.status}`);
                            return [];
                        }
                    } catch (e: any) {
                        await interaction.editReply(`Failed to parse Tidal album: ${e.message}`);
                        return [];
                    }
                } else {
                    await interaction.editReply('Could not extract a valid Tidal album ID from the URL.');
                    return [];
                }
            } else {
                // Tidal Track
                const match = query.match(/track\/(\d+)/);
                if (match) {
                    const id = match[1];
                    const metadata = await tidalProvider.getTrackMetadata(id);
                    if (metadata) {
                        tracks.push({
                            id: metadata.id,
                            title: metadata.title,
                            artist: { name: metadata.artist?.name || 'Unknown', id: metadata.artist?.id },
                            provider: 'tidal',
                            cover: metadata.album?.cover ? tidalProvider.getCoverUrl(metadata.album.cover) : null
                        });
                    }
                } else {
                    await interaction.editReply('Could not extract a valid Tidal track ID from the URL. Please ensure it is a track URL.');
                    return [];
                }
            }
        } else if (query.includes('qobuz.com/') || query.includes('m-app.bitperfect.dedyn.io/')) {
            // First check if it's an album or playlist
            if (query.includes('/album/')) {
                const idMatch = query.match(/album\/[^\/]+\/([a-zA-Z0-9]+)/) || query.match(/album\/([a-zA-Z0-9]+)/);
                if (idMatch) {
                    await interaction.editReply('Fetching Qobuz album...');
                try {
                    const qobuzRes = await fetch(`https://qz-api.bitperfect.dedyn.io/album/get?album_id=${idMatch[1]}`);
                    if (qobuzRes.ok) {
                        const data = await qobuzRes.json();
                        const items = data.tracks?.items || [];
                        if (items.length > 0) {
                            for (const item of items) {
                                if (item && item.id) {
                                    tracks.push({
                                        id: `q:${item.id}`,
                                        title: item.title,
                                        artist: { name: item.performer?.name || item.artist?.name || 'Unknown', id: item.performer?.id?.toString() || item.artist?.id?.toString() },
                                        provider: 'qobuz',
                                        cover: item.album?.image?.large || data.image?.large ? defaultSearchProvider.getCoverUrl(item.album?.image?.large || data.image?.large) : null
                                    });
                                }
                            }
                        } else {
                            await interaction.editReply('Album is empty or could not be found.');
                            return [];
                        }
                    } else {
                        await interaction.editReply(`Failed to fetch Qobuz album. Error ${qobuzRes.status}`);
                        return [];
                    }
                } catch (e: any) {
                    await interaction.editReply(`Failed to parse Qobuz album: ${e.message}`);
                    return [];
                }
            } else {
                await interaction.editReply('Could not extract a valid Qobuz album ID from the URL.');
                return [];
            }
        } else if (query.includes('qobuz.com/playlist/') || query.includes('play.qobuz.com/playlist/') || query.includes('m-app.bitperfect.dedyn.io/playlist/')) {
            const idMatch = query.match(/playlist\/[^\/]+\/([a-zA-Z0-9-]+)/) || query.match(/playlist\/([a-zA-Z0-9-]+)/);
            if (idMatch) {
                await interaction.editReply('Fetching Qobuz playlist...');
                try {
                    const qobuzRes = await fetch(`https://qz-api.bitperfect.dedyn.io/playlist/get?playlist_id=${idMatch[1]}&extra=tracks`);
                    if (qobuzRes.ok) {
                        const data = await qobuzRes.json();
                        const items = data.tracks?.items || [];
                        if (items.length > 0) {
                            for (const item of items) {
                                if (item && item.id) {
                                    tracks.push({
                                        id: `q:${item.id}`,
                                        title: item.title,
                                        artist: { name: item.performer?.name || item.artist?.name || 'Unknown', id: item.performer?.id?.toString() || item.artist?.id?.toString() },
                                        provider: 'qobuz',
                                        cover: item.album?.image?.large ? defaultSearchProvider.getCoverUrl(item.album.image.large) : null
                                    });
                                }
                            }
                        } else {
                            await interaction.editReply('Playlist is empty or could not be found.');
                            return [];
                        }
                    } else {
                        await interaction.editReply(`Failed to fetch Qobuz playlist. Error ${qobuzRes.status}`);
                        return [];
                    }
                } catch (e: any) {
                    await interaction.editReply(`Failed to parse Qobuz playlist: ${e.message}`);
                    return [];
                }
            } else {
                await interaction.editReply('Could not extract a valid Qobuz playlist ID from the URL.');
                return [];
            }
        } else {
            // Handle tracks
            const match = query.match(/track\/([a-zA-Z0-9_-]+)/);
            if (match) {
                const id = match[1];
                const metadata = await qobuzProvider.getTrackMetadata(id);
                if (metadata) {
                    tracks.push({
                        id: `q:${metadata.id || id}`,
                        title: metadata.title,
                        artist: { name: metadata.performer?.name || metadata.artist?.name || 'Unknown', id: undefined },
                        provider: 'qobuz',
                        cover: metadata.album?.image?.large || metadata.album?.image?.small || metadata.image?.large || null
                    });
                }
            } else {
                await interaction.editReply('Could not extract a valid Qobuz track ID from the URL. Please ensure it is a track URL.');
                return [];
            }
        }
    } else if (query.includes('open.spotify.com/playlist/') || query.includes('open.spotify.com/album/')) {
        await interaction.editReply('Parsing Spotify playlist... this may take a moment.');
        try {
            const spTracks = await getSpotifyTracks(query);
            if (spTracks && spTracks.length > 0) {
                await interaction.editReply(`Found ${spTracks.length} tracks on Spotify. Resolving on Tidal/Qobuz...`);
                let addedCount = 0;
                for (const spTrack of spTracks) {
                    const searchQuery = `${spTrack.name} ${spTrack.artist || spTrack.artists?.[0]?.name || ''}`.trim();
                    const searchResults = await defaultSearchProvider.searchTracks(searchQuery, { limit: 1 });
                    if (searchResults?.items?.length > 0) {
                        const item = searchResults.items[0];
                        tracks.push({
                            id: item.id,
                            title: item.title,
                            artist: { name: item.artist?.name || 'Unknown', id: item.artist?.id },
                            provider: item.provider || 'tidal',
                            cover: item.album?.cover ? defaultSearchProvider.getCoverUrl(item.album.cover) : null
                        });
                        addedCount++;
                    }
                }
                if (addedCount === 0) {
                    await interaction.editReply('Could not resolve any of the Spotify tracks on Tidal/Qobuz.');
                    return [];
                }
            } else {
                await interaction.editReply('Could not find any tracks in this Spotify URL.');
                return [];
            }
        } catch (e: any) {
            await interaction.editReply(`Failed to parse Spotify URL: ${e.message}`);
            return [];
        }
    } else {
        await interaction.editReply('That URL provider is not fully supported yet (Only SoundCloud, Tidal, Qobuz, and Spotify Playlists are supported).');
        return [];
    }
    } else {
        // 2. Text Search (Tidal Default Provider)
        const searchResults = await defaultSearchProvider.searchTracks(query.trim(), { limit: 5 });
        if (searchResults && searchResults.items && searchResults.items.length > 0) {
            const item = searchResults.items[0];
            tracks.push({
                id: item.id,
                title: item.title,
                artist: { name: item.artist?.name || 'Unknown', id: item.artist?.id },
                provider: item.provider || 'tidal', // defaultSearchProvider is tidalProvider
                cover: item.album?.cover ? defaultSearchProvider.getCoverUrl(item.album.cover) : (item.cover || item.image || null)
            });
        }
    }

    return tracks;
}
