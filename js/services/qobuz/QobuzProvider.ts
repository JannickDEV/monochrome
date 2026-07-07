import type { Provider, SearchOptions, SearchResults, StreamInfo } from '../types.js';
import { ProviderError } from '../types.js';
import { QobuzClient } from './QobuzClient.js';

function getQobuzFormatId(quality?: string): string {
    if (!quality) return '27';
    if (['5', '6', '7', '8', '13', '27'].includes(quality)) return quality;
    switch (quality) {
        case 'LOW':
        case 'HIGH':
            return '5'; // MP3 320 kbps
        case 'LOSSLESS':
            return '6'; // FLAC 16-bit / 44.1kHz
        case 'HI_RES':
            return '7'; // FLAC 24-bit / <= 96kHz
        case 'HI_RES_LOSSLESS':
            return '27'; // FLAC 24-bit / <= 192kHz max
        default:
            return '27';
    }
}

function prefixQobuzId(val: any): any {
    if (val === undefined || val === null) return val;
    const str = String(val);
    return str && !str.startsWith('q:') && !str.startsWith('http') ? 'q:' + str : val;
}

function normalizeItem(item: any, type: string): any {
    if (!item) return item;
    const normalized = {
        ...item,
        id: prefixQobuzId(item.id),
        cover: prefixQobuzId(item.cover),
        image: prefixQobuzId(item.image),
        picture: prefixQobuzId(item.picture),
        imageId: prefixQobuzId(item.imageId),
        provider: 'qobuz',
        type: item.type || type,
    };
    if (normalized.album) {
        normalized.album = {
            ...normalized.album,
            id: prefixQobuzId(normalized.album.id),
            cover: prefixQobuzId(normalized.album.cover),
            image: prefixQobuzId(normalized.album.image),
        };
    }
    if (normalized.artist) {
        normalized.artist = {
            ...normalized.artist,
            id: prefixQobuzId(normalized.artist.id),
            picture: prefixQobuzId(normalized.artist.picture),
            image: prefixQobuzId(normalized.artist.image),
        };
    }
    if (!normalized.artist && Array.isArray(normalized.artists) && normalized.artists.length > 0) {
        normalized.artist = normalized.artists[0];
    } else if (normalized.artist && !normalized.artists) {
        normalized.artists = [normalized.artist];
    }
    if (normalized.album && !normalized.album.artist && normalized.artist) {
        normalized.album = { ...normalized.album, artist: normalized.artist };
    }
    return normalized;
}

const cleanId = (id: string | number): string => String(id).replace(/^q:/, '');

export class QobuzProvider implements Provider {
    readonly id = 'qobuz';
    readonly name = 'Qobuz';
    private client: QobuzClient;

    constructor(client?: QobuzClient) {
        this.client = client || new QobuzClient();
    }

    async search(query: string, options: SearchOptions = {}): Promise<SearchResults> {
        try {
            const limit = options.limit || 20;
            const offset = options.offset || 0;
            const res = await this.client.request('/search/', { q: query, limit, offset });
            return {
                tracks: { items: (res?.tracks?.items || []).map((t: any) => normalizeItem(t, 'track')) },
                albums: { items: (res?.albums?.items || []).map((a: any) => normalizeItem(a, 'album')) },
                artists: { items: (res?.artists?.items || []).map((ar: any) => normalizeItem(ar, 'artist')) },
                playlists: { items: (res?.playlists?.items || []).map((p: any) => normalizeItem(p, 'playlist')) },
                videos: { items: [] },
            };
        } catch (err: any) {
            throw new ProviderError(err.message, this.id, 'search', err);
        }
    }

    async searchTracks(query: string, options: SearchOptions = {}): Promise<{ items: any[] }> {
        try {
            const res = await this.client.request('/search/', { s: query, limit: options.limit || 20, offset: options.offset || 0 });
            return { items: (res?.tracks?.items || res?.items || []).map((t: any) => normalizeItem(t, 'track')) };
        } catch (err: any) {
            throw new ProviderError(err.message, this.id, 'searchTracks', err);
        }
    }

    async searchAlbums(query: string, options: SearchOptions = {}): Promise<{ items: any[] }> {
        try {
            const res = await this.client.request('/search/', { al: query, limit: options.limit || 20, offset: options.offset || 0 });
            return { items: (res?.albums?.items || res?.items || []).map((a: any) => normalizeItem(a, 'album')) };
        } catch (err: any) {
            throw new ProviderError(err.message, this.id, 'searchAlbums', err);
        }
    }

    async searchArtists(query: string, options: SearchOptions = {}): Promise<{ items: any[] }> {
        try {
            const res = await this.client.request('/search/', { a: query, limit: options.limit || 20, offset: options.offset || 0 });
            return { items: (res?.artists?.items || res?.items || []).map((ar: any) => normalizeItem(ar, 'artist')) };
        } catch (err: any) {
            throw new ProviderError(err.message, this.id, 'searchArtists', err);
        }
    }

    async searchPlaylists(query: string, options: SearchOptions = {}): Promise<{ items: any[] }> {
        try {
            const res = await this.client.request('/search/', { p: query, limit: options.limit || 20, offset: options.offset || 0 });
            return { items: (res?.playlists?.items || res?.items || []).map((p: any) => normalizeItem(p, 'playlist')) };
        } catch (err: any) {
            throw new ProviderError(err.message, this.id, 'searchPlaylists', err);
        }
    }

    async getTrack(id: string | number, quality?: string): Promise<any> {
        try {
            const res = await this.client.request('/track/', { id: cleanId(id) });
            if (!res || res.error) throw new Error(res?.error || 'Track not found');
            return normalizeItem(res, 'track');
        } catch (err: any) {
            throw new ProviderError(err.message, this.id, 'getTrack', err);
        }
    }

    async getTrackMetadata(id: string | number): Promise<any> {
        try {
            const res = await this.client.request('/info/', { id: cleanId(id) });
            if (!res || res.error) throw new Error(res?.error || 'Track metadata not found');
            return normalizeItem(res, 'track');
        } catch (err: any) {
            throw new ProviderError(err.message, this.id, 'getTrackMetadata', err);
        }
    }

    async getAlbum(id: string | number): Promise<any> {
        try {
            const res = await this.client.request('/album/', { id: cleanId(id) });
            if (!res || res.error) throw new Error(res?.error || 'Album not found');
            return normalizeItem(res, 'album');
        } catch (err: any) {
            throw new ProviderError(err.message, this.id, 'getAlbum', err);
        }
    }

    async getArtist(id: string | number): Promise<any> {
        try {
            const res = await this.client.request('/artist/', { id: cleanId(id) });
            if (!res || res.error) throw new Error(res?.error || 'Artist not found');
            return normalizeItem(res, 'artist');
        } catch (err: any) {
            throw new ProviderError(err.message, this.id, 'getArtist', err);
        }
    }

    async getPlaylist(id: string | number): Promise<any> {
        try {
            const res = await this.client.request('/playlist/', { id: cleanId(id) });
            if (!res || res.error) throw new Error(res?.error || 'Playlist not found');
            return normalizeItem(res, 'playlist');
        } catch (err: any) {
            throw new ProviderError(err.message, this.id, 'getPlaylist', err);
        }
    }

    async getStreamUrl(id: string | number, quality?: string): Promise<StreamInfo> {
        try {
            const formatId = getQobuzFormatId(quality);
            const res = await this.client.request('/trackManifests/', { id: cleanId(id), format_id: formatId, intent: 'stream' });
            const url = res?.url || res?.url_stream || res?.file_url || res?.data?.url;
            if (!url || typeof url !== 'string') {
                throw new Error('Qobuz did not return a valid stream URL');
            }
            return {
                url,
                provider: 'qobuz',
                quality: formatId === '27' ? 'HI_RES_LOSSLESS' : formatId === '7' ? 'HI_RES' : formatId === '6' ? 'LOSSLESS' : 'HIGH',
                rgInfo: null,
            };
        } catch (err: any) {
            throw new ProviderError(err.message, this.id, 'getStreamUrl', err);
        }
    }

    async getTrackForDownload(id: string | number, quality?: string): Promise<StreamInfo> {
        try {
            const formatId = getQobuzFormatId(quality);
            const res = await this.client.request('/track/getFileUrl', { track_id: cleanId(id), id: cleanId(id), format_id: formatId, intent: 'stream' });
            const url = res?.url || res?.url_stream || res?.file_url || res?.data?.url;
            if (!url || typeof url !== 'string') {
                throw new Error('Qobuz did not return a valid download URL');
            }
            return {
                url,
                provider: 'qobuz',
                quality: formatId === '27' ? 'HI_RES_LOSSLESS' : formatId === '7' ? 'HI_RES' : formatId === '6' ? 'LOSSLESS' : 'HIGH',
                rgInfo: null,
            };
        } catch (err: any) {
            throw new ProviderError(err.message || 'Qobuz getTrackForDownload failed', this.id, 'getTrackForDownload', err);
        }
    }

    getCoverUrl(id: string | number, size = '600'): string {
        return `https://static.qobuz.com/images/covers/${cleanId(id)}_${size}.jpg`;
    }

    getCoverSrcset(id: string | number): string {
        return `${this.getCoverUrl(id, '300')} 300w, ${this.getCoverUrl(id, '600')} 600w`;
    }

    getArtistPictureUrl(id: string | number, size = '600'): string {
        return `https://static.qobuz.com/images/artists/${cleanId(id)}_${size}.jpg`;
    }

    getArtistPictureSrcset(id: string | number): string {
        return `${this.getArtistPictureUrl(id, '300')} 300w, ${this.getArtistPictureUrl(id, '600')} 600w`;
    }
}
