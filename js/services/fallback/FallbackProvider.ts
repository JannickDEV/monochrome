import type { Provider, SearchOptions, SearchResults, StreamInfo } from '../types.js';
import { ProviderError } from '../types.js';

export class FallbackProvider implements Provider {
    readonly id = 'fallback';
    readonly name = 'Fallback';
    private providers: Provider[];

    constructor(providers: Provider[]) {
        this.providers = providers || [];
    }

    getProviders(): Provider[] {
        return this.providers;
    }

    private getProviderForId(id: string | number): Provider {
        if (!this.providers.length) {
            throw new Error('No providers configured in FallbackProvider');
        }
        const strId = String(id);
        if (strId.startsWith('t:') || strId.includes('-')) {
            const tidal = this.providers.find(p => p.id === 'tidal');
            if (tidal) return tidal;
        }
        if (strId.startsWith('q:')) {
            const qobuz = this.providers.find(p => p.id === 'qobuz');
            if (qobuz) return qobuz;
        }
        return this.providers[0];
    }

    private async executeWithFallback<T>(
        operation: string,
        args: any[],
        fn: (provider: Provider) => Promise<T>,
        isEmptyResult?: (res: T) => boolean
    ): Promise<T> {
        if (!this.providers.length) {
            throw new ProviderError('No providers configured in FallbackProvider', 'fallback', operation);
        }
        const errors: Error[] = [];
        for (const provider of this.providers) {
            try {
                const res = await fn(provider);
                if (isEmptyResult && isEmptyResult(res)) {
                    throw new Error(`Provider ${provider.name} returned empty/unusable results`);
                }
                return res;
            } catch (err: any) {
                errors.push(err);
                console.warn(`[FallbackProvider] ${provider.name} failed for ${operation}(${JSON.stringify(args)}): ${err.message || err}. Falling back to next provider.`);
            }
        }
        const lastErr = errors[errors.length - 1];
        throw new ProviderError(
            `All providers failed for ${operation}: ${errors.map(e => e.message).join('; ')}`,
            'fallback',
            operation,
            lastErr
        );
    }

    async search(query: string, options: SearchOptions = {}): Promise<SearchResults> {
        return this.executeWithFallback(
            'search',
            [query, options],
            p => p.search(query, options),
            res => !res || ((!res.tracks?.items?.length) && (!res.albums?.items?.length) && (!res.artists?.items?.length) && (!res.playlists?.items?.length))
        );
    }

    async searchTracks(query: string, options: SearchOptions = {}): Promise<{ items: any[] }> {
        return this.executeWithFallback(
            'searchTracks',
            [query, options],
            p => p.searchTracks(query, options),
            res => !res || !res.items?.length
        );
    }

    async searchAlbums(query: string, options: SearchOptions = {}): Promise<{ items: any[] }> {
        return this.executeWithFallback(
            'searchAlbums',
            [query, options],
            p => p.searchAlbums(query, options),
            res => !res || !res.items?.length
        );
    }

    async searchArtists(query: string, options: SearchOptions = {}): Promise<{ items: any[] }> {
        return this.executeWithFallback(
            'searchArtists',
            [query, options],
            p => p.searchArtists(query, options),
            res => !res || !res.items?.length
        );
    }

    async searchPlaylists(query: string, options: SearchOptions = {}): Promise<{ items: any[] }> {
        return this.executeWithFallback(
            'searchPlaylists',
            [query, options],
            async p => {
                if (typeof p.searchPlaylists === 'function') {
                    return p.searchPlaylists(query, options);
                }
                return { items: [] };
            },
            res => !res || !res.items?.length
        );
    }

    async searchVideos(query: string, options: SearchOptions = {}): Promise<{ items: any[] }> {
        return this.executeWithFallback(
            'searchVideos',
            [query, options],
            async p => {
                if (typeof p.searchVideos === 'function') {
                    return p.searchVideos(query, options);
                }
                return { items: [] };
            },
            res => !res || !res.items?.length
        );
    }

    async getTrack(id: string | number, quality?: string): Promise<any> {
        return this.executeWithFallback(
            'getTrack',
            [id, quality],
            p => p.getTrack(id, quality),
            res => !res
        );
    }

    async getTrackMetadata(id: string | number): Promise<any> {
        return this.executeWithFallback(
            'getTrackMetadata',
            [id],
            p => p.getTrackMetadata(id),
            res => !res
        );
    }

    async getAlbum(id: string | number): Promise<any> {
        return this.executeWithFallback(
            'getAlbum',
            [id],
            p => p.getAlbum(id),
            res => !res
        );
    }

    async getArtist(id: string | number): Promise<any> {
        return this.executeWithFallback(
            'getArtist',
            [id],
            p => p.getArtist(id),
            res => !res
        );
    }

    async getArtistBiography(id: string | number): Promise<any> {
        return this.executeWithFallback(
            'getArtistBiography',
            [id],
            async p => {
                if (typeof p.getArtistBiography === 'function') {
                    return p.getArtistBiography(id);
                }
                return null;
            },
            res => !res
        );
    }

    async getPlaylist(id: string | number): Promise<any> {
        return this.executeWithFallback(
            'getPlaylist',
            [id],
            async p => {
                if (typeof p.getPlaylist === 'function') {
                    return p.getPlaylist(id);
                }
                return null;
            },
            res => !res
        );
    }

    async getMix(id: string | number): Promise<any> {
        return this.executeWithFallback(
            'getMix',
            [id],
            async p => {
                if (typeof p.getMix === 'function') {
                    return p.getMix(id);
                }
                return null;
            },
            res => !res
        );
    }

    async getVideo(id: string | number): Promise<any> {
        return this.executeWithFallback(
            'getVideo',
            [id],
            async p => {
                if (typeof p.getVideo === 'function') {
                    return p.getVideo(id);
                }
                return null;
            },
            res => !res
        );
    }

    async getVideoStreamUrl(id: string | number): Promise<any> {
        return this.executeWithFallback(
            'getVideoStreamUrl',
            [id],
            async p => {
                if (typeof p.getVideoStreamUrl === 'function') {
                    return p.getVideoStreamUrl(id);
                }
                return null;
            },
            res => !res
        );
    }

    async getStreamUrl(id: string | number, quality?: string): Promise<StreamInfo> {
        return this.executeWithFallback(
            'getStreamUrl',
            [id, quality],
            p => p.getStreamUrl(id, quality),
            res => !res || !res.url
        );
    }

    async getTrackForDownload(id: string | number, quality?: string): Promise<any> {
        return this.executeWithFallback(
            'getTrackForDownload',
            [id, quality],
            async p => {
                if (typeof p.getTrackForDownload === 'function') {
                    return p.getTrackForDownload(id, quality);
                }
                return null;
            },
            res => !res
        );
    }

    getCoverUrl(id: string | number, size = '320'): string {
        const provider = this.getProviderForId(id);
        return provider.getCoverUrl(id, size);
    }

    getCoverSrcset(id: string | number): string {
        const provider = this.getProviderForId(id);
        return provider.getCoverSrcset(id);
    }

    getArtistPictureUrl(id: string | number, size = '320'): string {
        const provider = this.getProviderForId(id);
        return provider.getArtistPictureUrl(id, size);
    }

    getArtistPictureSrcset(id: string | number): string {
        const provider = this.getProviderForId(id);
        return provider.getArtistPictureSrcset(id);
    }

    async getSimilarArtists(artistId: string | number): Promise<any> {
        return this.executeWithFallback(
            'getSimilarArtists',
            [artistId],
            async p => {
                if (typeof p.getSimilarArtists === 'function') {
                    return p.getSimilarArtists(artistId);
                }
                return [];
            },
            res => !res || (Array.isArray(res) && res.length === 0)
        );
    }

    async getSimilarAlbums(albumId: string | number): Promise<any> {
        return this.executeWithFallback(
            'getSimilarAlbums',
            [albumId],
            async p => {
                if (typeof p.getSimilarAlbums === 'function') {
                    return p.getSimilarAlbums(albumId);
                }
                return [];
            },
            res => !res || (Array.isArray(res) && res.length === 0)
        );
    }

    async getArtistTopTracks(artistId: string | number, options?: any): Promise<any> {
        return this.executeWithFallback(
            'getArtistTopTracks',
            [artistId, options],
            async p => {
                if (typeof p.getArtistTopTracks === 'function') {
                    return p.getArtistTopTracks(artistId, options);
                }
                return [];
            },
            res => !res || (Array.isArray(res) && res.length === 0)
        );
    }

    async getRecommendedTracksForPlaylist(tracks: any[], limit?: number, options?: any): Promise<any> {
        return this.executeWithFallback(
            'getRecommendedTracksForPlaylist',
            [tracks, limit, options],
            async p => {
                if (typeof p.getRecommendedTracksForPlaylist === 'function') {
                    return p.getRecommendedTracksForPlaylist(tracks, limit, options);
                }
                return [];
            },
            res => !res || (Array.isArray(res) && res.length === 0)
        );
    }
}
