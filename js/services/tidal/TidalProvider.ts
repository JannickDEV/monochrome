import type { Provider, SearchOptions, SearchResults, StreamInfo } from '../types.js';
import { ProviderError } from '../types.js';

const cleanId = (id: string | number): string => String(id).replace(/^t:/, '');

export class TidalProvider implements Provider {
    readonly id = 'tidal';
    readonly name = 'Tidal';
    private api: any;

    constructor(losslessApiInstance: any) {
        this.api = losslessApiInstance;
    }

    async search(query: string, options: SearchOptions = {}): Promise<SearchResults> {
        try {
            return await this.api.search(query, { ...options, _fromProvider: true });
        } catch (err: any) {
            throw new ProviderError(err.message || 'Tidal search failed', this.id, 'search', err);
        }
    }

    async searchTracks(query: string, options: SearchOptions = {}): Promise<{ items: any[] }> {
        try {
            return await this.api.searchTracks(query, { ...options, _fromProvider: true });
        } catch (err: any) {
            throw new ProviderError(err.message || 'Tidal searchTracks failed', this.id, 'searchTracks', err);
        }
    }

    async searchAlbums(query: string, options: SearchOptions = {}): Promise<{ items: any[] }> {
        try {
            return await this.api.searchAlbums(query, { ...options, _fromProvider: true });
        } catch (err: any) {
            throw new ProviderError(err.message || 'Tidal searchAlbums failed', this.id, 'searchAlbums', err);
        }
    }

    async searchArtists(query: string, options: SearchOptions = {}): Promise<{ items: any[] }> {
        try {
            return await this.api.searchArtists(query, { ...options, _fromProvider: true });
        } catch (err: any) {
            throw new ProviderError(err.message || 'Tidal searchArtists failed', this.id, 'searchArtists', err);
        }
    }

    async searchPlaylists(query: string, options: SearchOptions = {}): Promise<{ items: any[] }> {
        try {
            if (typeof this.api.searchPlaylists === 'function') {
                return await this.api.searchPlaylists(query, { ...options, _fromProvider: true });
            }
            return { items: [] };
        } catch (err: any) {
            throw new ProviderError(err.message || 'Tidal searchPlaylists failed', this.id, 'searchPlaylists', err);
        }
    }

    async searchVideos(query: string, options: SearchOptions = {}): Promise<{ items: any[] }> {
        try {
            if (typeof this.api.searchVideos === 'function') {
                return await this.api.searchVideos(query, { ...options, _fromProvider: true });
            }
            return { items: [] };
        } catch (err: any) {
            throw new ProviderError(err.message || 'Tidal searchVideos failed', this.id, 'searchVideos', err);
        }
    }

    async getTrack(id: string | number, quality?: string): Promise<any> {
        try {
            return await this.api.getTrack(cleanId(id), quality, { _fromProvider: true });
        } catch (err: any) {
            throw new ProviderError(err.message || 'Tidal getTrack failed', this.id, 'getTrack', err);
        }
    }

    async getTrackMetadata(id: string | number): Promise<any> {
        try {
            if (typeof this.api.getTrackMetadata === 'function') {
                return await this.api.getTrackMetadata(cleanId(id), { _fromProvider: true });
            }
            return await this.api.getTrack(cleanId(id), undefined, { _fromProvider: true });
        } catch (err: any) {
            throw new ProviderError(err.message || 'Tidal getTrackMetadata failed', this.id, 'getTrackMetadata', err);
        }
    }

    async getAlbum(id: string | number): Promise<any> {
        try {
            return await this.api.getAlbum(cleanId(id), { _fromProvider: true });
        } catch (err: any) {
            throw new ProviderError(err.message || 'Tidal getAlbum failed', this.id, 'getAlbum', err);
        }
    }

    async getArtist(id: string | number): Promise<any> {
        try {
            return await this.api.getArtist(cleanId(id), { _fromProvider: true });
        } catch (err: any) {
            throw new ProviderError(err.message || 'Tidal getArtist failed', this.id, 'getArtist', err);
        }
    }

    async getArtistBiography(id: string | number): Promise<any> {
        try {
            if (typeof this.api.getArtistBiography === 'function') {
                return await this.api.getArtistBiography(cleanId(id), { _fromProvider: true });
            }
            return null;
        } catch (err: any) {
            throw new ProviderError(err.message || 'Tidal getArtistBiography failed', this.id, 'getArtistBiography', err);
        }
    }

    async getPlaylist(id: string | number): Promise<any> {
        try {
            return await this.api.getPlaylist(cleanId(id), { _fromProvider: true });
        } catch (err: any) {
            throw new ProviderError(err.message || 'Tidal getPlaylist failed', this.id, 'getPlaylist', err);
        }
    }

    async getMix(id: string | number): Promise<any> {
        try {
            if (typeof this.api.getMix === 'function') {
                return await this.api.getMix(cleanId(id));
            }
            return null;
        } catch (err: any) {
            throw new ProviderError(err.message || 'Tidal getMix failed', this.id, 'getMix', err);
        }
    }

    async getVideo(id: string | number): Promise<any> {
        try {
            if (typeof this.api.getVideo === 'function') {
                return await this.api.getVideo(cleanId(id));
            }
            return null;
        } catch (err: any) {
            throw new ProviderError(err.message || 'Tidal getVideo failed', this.id, 'getVideo', err);
        }
    }

    async getVideoStreamUrl(id: string | number): Promise<any> {
        try {
            if (typeof this.api.getVideoStreamUrl === 'function') {
                return await this.api.getVideoStreamUrl(cleanId(id));
            }
            return null;
        } catch (err: any) {
            throw new ProviderError(err.message || 'Tidal getVideoStreamUrl failed', this.id, 'getVideoStreamUrl', err);
        }
    }

    async getStreamUrl(id: string | number, quality?: string): Promise<StreamInfo> {
        try {
            const res = await this.api.getStreamUrl(cleanId(id), quality, { _fromProvider: true });
            if (!res) throw new Error('Tidal returned empty stream info');
            if (typeof res === 'string') {
                return { url: res, provider: 'tidal', quality };
            }
            return { ...res, provider: 'tidal' };
        } catch (err: any) {
            throw new ProviderError(err.message || 'Tidal getStreamUrl failed', this.id, 'getStreamUrl', err);
        }
    }

    async getTrackForDownload(id: string | number, quality?: string): Promise<any> {
        try {
            if (typeof this.api.getTrackForDownload === 'function') {
                return await this.api.getTrackForDownload(cleanId(id), quality, { _fromProvider: true });
            }
            return await this.getStreamUrl(cleanId(id), quality);
        } catch (err: any) {
            throw new ProviderError(err.message || 'Tidal getTrackForDownload failed', this.id, 'getTrackForDownload', err);
        }
    }

    getCoverUrl(id: string | number, size = '320'): string {
        return this.api.getCoverUrl(cleanId(id), size);
    }

    getCoverSrcset(id: string | number): string {
        return typeof this.api.getCoverSrcset === 'function' ? this.api.getCoverSrcset(cleanId(id)) : '';
    }

    getArtistPictureUrl(id: string | number, size = '320'): string {
        return this.api.getArtistPictureUrl(cleanId(id), size);
    }

    getArtistPictureSrcset(id: string | number): string {
        return typeof this.api.getArtistPictureSrcset === 'function' ? this.api.getArtistPictureSrcset(cleanId(id)) : '';
    }

    async getSimilarArtists(artistId: string | number): Promise<any> {
        if (typeof this.api.getSimilarArtists === 'function') {
            return this.api.getSimilarArtists(cleanId(artistId));
        }
        return [];
    }

    async getSimilarAlbums(albumId: string | number): Promise<any> {
        if (typeof this.api.getSimilarAlbums === 'function') {
            return this.api.getSimilarAlbums(cleanId(albumId));
        }
        return [];
    }

    async getArtistTopTracks(artistId: string | number, options?: any): Promise<any> {
        if (typeof this.api.getArtistTopTracks === 'function') {
            return this.api.getArtistTopTracks(cleanId(artistId), { ...options, _fromProvider: true });
        }
        return [];
    }

    async getRecommendedTracksForPlaylist(tracks: any[], limit?: number, options?: any): Promise<any> {
        if (typeof this.api.getRecommendedTracksForPlaylist === 'function') {
            return this.api.getRecommendedTracksForPlaylist(tracks, limit, { ...options, _fromProvider: true });
        }
        return [];
    }
}
