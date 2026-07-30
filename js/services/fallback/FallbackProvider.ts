import type { Provider, SearchOptions, SearchResults, StreamInfo } from '../types.js';
import { ProviderError } from '../types.js';

export class FallbackProvider implements Provider {
    readonly id = 'fallback';
    readonly name = 'Fallback';
    private providers: Provider[];
    public isrcCache: Map<string, string>;
    public metaCache: Map<string, any>;
    private trackIdMapCache: Map<string, string | number>;

    constructor(providers: Provider[]) {
        this.providers = providers || [];
        this.isrcCache = new Map();
        this.metaCache = new Map();
        this.trackIdMapCache = new Map();
    }

    getProviders(): Provider[] {
        return this.providers;
    }

    private getProviderForId(id: string | number): Provider {
        if (!this.providers.length) {
            throw new Error('No providers configured in FallbackProvider');
        }
        const strId = String(id);
        if (strId.startsWith('sc_')) {
            const sc = this.providers.find(p => p.id === 'soundcloud');
            if (sc) return sc;
        }
        if (strId.startsWith('q:')) {
            const qobuz = this.providers.find(p => p.id === 'qobuz');
            if (qobuz) return qobuz;
        }
        if (strId.startsWith('t:') || strId.includes('-') || /^\d+$/.test(strId)) {
            const tidal = this.providers.find(p => p.id === 'tidal');
            if (tidal) return tidal;
        }
        return this.providers[0];
    }

    private async resolveProviderTrackId(targetProvider: Provider, id: string | number): Promise<string | number> {
        const strId = String(id);
        const isTargetQobuz = targetProvider.id === 'qobuz';
        const isIdQobuz = strId.startsWith('q:');

        // If the ID already matches the target provider's catalog format, return it directly
        if ((isTargetQobuz && isIdQobuz) || (!isTargetQobuz && !isIdQobuz)) {
            return id;
        }

        const cacheKey = `${targetProvider.id}_${strId}`;
        if (this.trackIdMapCache.has(cacheKey)) {
            return this.trackIdMapCache.get(cacheKey)!;
        }

        // We need to translate the ID via ISRC from the source provider
        let isrc = this.isrcCache.get(strId);
        let meta: any = null;
        const sourceProvider = this.getProviderForId(id) || targetProvider;

        if (sourceProvider) {
            try {
                // Attempt to fetch metadata, fallback to getTrack if it fails or returns something without a title
                meta = typeof sourceProvider.getTrackMetadata === 'function' 
                    ? await sourceProvider.getTrackMetadata(id)
                    : null;
                
                if (!meta || !meta.title) {
                    meta = typeof sourceProvider.getTrack === 'function' ? await sourceProvider.getTrack(id) : null;
                }
                
                // Some providers return { item: {...} } or { tracks: [...] }
                if (meta && meta.item) meta = meta.item;
                if (meta && meta.tracks && meta.tracks[0]) meta = meta.tracks[0];
            } catch (e) {
                console.warn(`[FallbackProvider] Could not fetch metadata from source provider for ${id}:`, e);
            }
        }

        // If metadata fetch failed or returned something without a title, try our metaCache
        if (!meta || !meta.title) {
            const cachedMeta = this.metaCache.get(strId);
            if (cachedMeta && cachedMeta.title) {
                meta = cachedMeta;
                console.log(`[FallbackProvider] Rescued metadata from metaCache for ${id}: ${meta.title}`);
            }
        }

        if (!isrc && meta && meta.isrc) {
            isrc = meta.isrc;
            this.isrcCache.set(strId, isrc);
        }

        if (typeof targetProvider.searchTracks !== 'function') {
            throw new Error(`Cannot translate track ID ${id} to ${targetProvider.name} (missing search API)`);
        }

        let match: any = null;

        if (isrc) {
            try {
                const searchRes = await targetProvider.searchTracks(isrc, { limit: 10 });
                const items = searchRes?.items || [];

                if (items.length > 0) {
                    // Match exact ISRC case-insensitively
                    match = items.find((t: any) => t.isrc?.toLowerCase() === isrc!.toLowerCase());
                    
                    // If search result doesn't include ISRC, we must fetch the track details to verify it
                    if (!match && items[0]) {
                        const firstResult = items[0];
                        if (!firstResult.isrc) {
                            try {
                                const trackMeta = typeof targetProvider.getTrackMetadata === 'function' 
                                    ? await targetProvider.getTrackMetadata(firstResult.id)
                                    : (typeof targetProvider.getTrack === 'function' ? await targetProvider.getTrack(firstResult.id) : null);
                                    
                                if (trackMeta?.isrc?.toLowerCase() === isrc!.toLowerCase()) {
                                    match = firstResult;
                                } else {
                                    console.warn(`[FallbackProvider] Rejecting fallback for ${id}: ISRC mismatch (expected ${isrc}, got ${trackMeta?.isrc})`);
                                }
                            } catch (err) {
                                console.warn(`[FallbackProvider] Failed to verify ISRC for ${firstResult.id}:`, err);
                            }
                        } else {
                            console.warn(`[FallbackProvider] Rejecting fallback for ${id}: first result had ISRC ${firstResult.isrc} which didn't match ${isrc}`);
                        }
                    }

                    // Validate the ISRC match to prevent label metadata errors (different song, same ISRC)
                    if (match) {
                        if (!meta && sourceProvider) {
                            try {
                                meta = typeof sourceProvider.getTrackMetadata === 'function' 
                                    ? await sourceProvider.getTrackMetadata(id)
                                    : (typeof sourceProvider.getTrack === 'function' ? await sourceProvider.getTrack(id) : null);
                            } catch (e) {
                                console.warn(`[FallbackProvider] Could not fetch metadata for validation for ${id}:`, e);
                            }
                        }
                        
                        if (meta && meta.title && match.title) {
                            const mTitle = meta.title.toLowerCase().trim();
                            const tTitle = match.title.toLowerCase().trim();
                            
                            // Check if titles are at least partially similar
                            const isTitleSimilar = tTitle === mTitle || tTitle.includes(mTitle) || mTitle.includes(tTitle);
                            
                            if (!isTitleSimilar) {
                                console.warn(`[FallbackProvider] ISRC match rejected due to completely different title! Expected "${meta.title}", got "${match.title}" (ISRC: ${isrc})`);
                                match = null;
                            }
                        }
                    }
                }
            } catch (err: any) {
                console.warn(`[FallbackProvider] ISRC search failed on ${targetProvider.name} for ISRC ${isrc}:`, err);
            }
        }

        // If ISRC search failed to yield a match, fallback to search by Title + Artist
        if (!match) {
            console.log(`[FallbackProvider] ISRC search yielded no match for ${id} (ISRC: ${isrc}), falling back to metadata search...`);

            if (meta && (meta.title || meta.name)) {
                const title = meta.title || meta.name;
                const artistName = meta.artist?.name || meta.artists?.[0]?.name || '';
                const query = artistName ? `${artistName} ${title}` : title;
                console.log(`[FallbackProvider] Running Title+Artist search with query: "${query}"`);
                
                try {
                    const fallbackSearchRes = await targetProvider.searchTracks(query, { limit: 10 });
                    const items = fallbackSearchRes?.items || [];
                    
                    if (items.length > 0) {
                        const mTitle = meta.title?.toLowerCase().trim();
                        const mDuration = meta.duration || 0;
                        
                        // Filter by duration if available
                        let validCandidates = items;
                        if (mDuration > 0) {
                            validCandidates = items.filter((t: any) => {
                                const tDuration = t.duration || 0;
                                if (tDuration === 0) return true; // Can't compare, assume valid
                                return Math.abs(tDuration - mDuration) <= 10;
                            });
                        }
                        
                        if (validCandidates.length > 0) {
                            // Try exact title match first
                            match = validCandidates.find((t: any) => {
                                const tTitle = t.title?.toLowerCase().trim();
                                return tTitle === mTitle;
                            });
                            
                            // If no exact match, try partial title match
                            if (!match) {
                                match = validCandidates.find((t: any) => {
                                    const tTitle = t.title?.toLowerCase().trim();
                                    return tTitle?.includes(mTitle) || mTitle?.includes(tTitle);
                                });
                            }
                        } else {
                            console.warn(`[FallbackProvider] No search results matched the expected duration (~${mDuration}s). First result duration: ${items[0].duration}s`);
                        }
                    }
                } catch (err: any) {
                    console.warn(`[FallbackProvider] Title/Artist search failed on ${targetProvider.name} for query "${query}":`, err);
                }
            }
        }

        if (!match || !match.id) {
            throw new Error(`Cannot translate track ID ${id} to ${targetProvider.name} (no match found via ISRC or title/artist)`);
        }

        console.log(`[FallbackProvider] Resolved track ID ${id} -> ${match.id} on ${targetProvider.name}`);
        this.trackIdMapCache.set(cacheKey, match.id);
        return match.id;
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
            async p => {
                const targetId = await this.resolveProviderTrackId(p, id);
                return p.getTrack(targetId, quality);
            },
            res => !res
        );
    }

    async getTrackMetadata(id: string | number): Promise<any> {
        return this.executeWithFallback(
            'getTrackMetadata',
            [id],
            async p => {
                const targetId = await this.resolveProviderTrackId(p, id);
                return p.getTrackMetadata(targetId);
            },
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
            async p => {
                const targetId = await this.resolveProviderTrackId(p, id);
                return p.getStreamUrl(targetId, quality);
            },
            res => !res || !res.url
        );
    }

    async getTrackForDownload(id: string | number, quality?: string): Promise<any> {
        return this.executeWithFallback(
            'getTrackForDownload',
            [id, quality],
            async p => {
                const targetId = await this.resolveProviderTrackId(p, id);
                if (typeof p.getTrackForDownload === 'function') {
                    return p.getTrackForDownload(targetId, quality);
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
