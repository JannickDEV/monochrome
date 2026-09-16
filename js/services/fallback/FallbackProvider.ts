import type { Provider, SearchOptions, SearchResults, StreamInfo } from '../types.js';
import { ProviderError } from '../types.js';

/** Any spelling of a Dolby Atmos quality token (DOLBY_ATMOS, DOLBY_ATMOS_EAC3_HIGH, …, EAC3_JOC, AC-4). */
const isAtmosQualityToken = (quality?: string): boolean => !!quality && /ATMOS|EAC3[_-]?JOC|AC[_-]?4/i.test(quality);

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

    /**
     * Guesses which of *this instance's* providers an id belongs to, purely
     * from its shape. Returns `null` — not a fallback guess — when the id
     * carries a prefix that isn't one of ours (e.g. `apple:track:…`): such an
     * id definitely doesn't belong to any provider here, so callers must not
     * treat "no known source" as "must be the target provider".
     */
    private getProviderForId(id: string | number): Provider | null {
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
        // A `word:`-style prefix (apple:, spotify:, …) belongs to a catalog none
        // of our providers speak — never guess one of them owns it.
        if (/^[a-z]+:/i.test(strId)) {
            return null;
        }
        return this.providers[0];
    }

    private async resolveProviderTrackId(targetProvider: Provider, id: string | number): Promise<string | number> {
        const strId = String(id);
        // Only set when we're actually confident which provider the id belongs
        // to. Never treated as "must be the target provider" just because it's
        // unrecognised — that's how a foreign id (e.g. apple:track:…) used to
        // get handed straight to Qobuz/Tidal and 400.
        const knownSourceProvider = this.getProviderForId(id);

        // Strict target validation:
        if (targetProvider.id === 'qobuz' && strId.startsWith('q:')) {
            return id;
        } else if (targetProvider.id === 'tidal' && (strId.startsWith('t:') || /^\d+$/.test(strId))) {
            return id;
        } else if (targetProvider.id !== 'qobuz' && targetProvider.id !== 'tidal') {
            if (knownSourceProvider && knownSourceProvider.id === targetProvider.id) {
                return id;
            }
        }

        // ONE MORE STRICT CHECK: If the user passed a purely numerical ID (TIDAL), but target is QOBUZ.
        // We absolutely CANNOT return this ID directly to Qobuz. We MUST translate it.
        // If knownSourceProvider is mistakenly determined as Qobuz, we still force translation if it's purely numerical.
        if (knownSourceProvider && knownSourceProvider.id === targetProvider.id) {
            // Only allow if it's not a cross-provider numerical ID confusion
            if (!(targetProvider.id === 'qobuz' && /^\d+$/.test(strId))) {
                return id;
            }
        }

        const cacheKey = `${targetProvider.id}_${strId}`;
        if (this.trackIdMapCache.has(cacheKey)) {
            return this.trackIdMapCache.get(cacheKey)!;
        }

        // We need to translate the ID via ISRC from the source provider
        let isrc = this.isrcCache.get(strId);
        let meta: any = null;

        // Only ask a provider for metadata on an id we're confident is theirs —
        // asking e.g. Qobuz to look up an `apple:track:…` id is a guaranteed
        // 400, not a fallback attempt. Foreign ids go straight to metaCache below.
        if (knownSourceProvider) {
            try {
                // Attempt to fetch metadata, fallback to getTrack if it fails or returns something without a title
                meta = typeof knownSourceProvider.getTrackMetadata === 'function'
                    ? await knownSourceProvider.getTrackMetadata(id)
                    : null;

                if (!meta || !meta.title) {
                    meta = typeof knownSourceProvider.getTrack === 'function' ? await knownSourceProvider.getTrack(id) : null;
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
            isrc = String(meta.isrc);
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

                if (items.length === 0 && targetProvider.id === 'qobuz') {
                    console.warn(`[Safeguard] ISRC search results on Qobuz turned up entirely empty for ${id}. Forcing fallback to TIDAL.`);
                    throw new Error(`Qobuz ISRC search turned up entirely empty for ${id}`);
                }

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
                        if (!meta && knownSourceProvider) {
                            try {
                                meta = typeof knownSourceProvider.getTrackMetadata === 'function'
                                    ? await knownSourceProvider.getTrackMetadata(id)
                                    : (typeof knownSourceProvider.getTrack === 'function' ? await knownSourceProvider.getTrack(id) : null);
                            } catch (e) {
                                console.warn(`[FallbackProvider] Could not fetch metadata for validation for ${id}:`, e);
                            }
                        }
                        
                        if (meta && (meta.title || meta.name) && match.title) {
                            const mTitle = (meta.title || meta.name).toLowerCase().trim();
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

        // ISRC translation failed or wasn't possible (no isrc at all, or the
        // target catalog doesn't carry that ISRC — common for Apple-sourced
        // search results). Fall back to a plain title + artist search. Less
        // certain than an ISRC match, so require both to look right.
        if ((!match || !match.id) && meta && (meta.title || meta.name)) {
            const rawTitle = String(meta.title || meta.name);
            const rawArtist = String(meta.artist?.name || meta.artists?.[0]?.name || meta.artist || '');
            const metaTitle = rawTitle.toLowerCase().trim();
            const metaArtist = rawArtist.toLowerCase().trim();

            if (metaTitle) {
                try {
                    const query = rawArtist ? `${rawTitle} ${rawArtist}` : rawTitle;
                    const searchRes = await targetProvider.searchTracks(query, { limit: 5 });
                    const items = searchRes?.items || [];

                    const candidate = items.find((t: any) => {
                        const tTitle = String(t.title || '').toLowerCase().trim();
                        const tArtist = String(t.artist?.name || t.artists?.[0]?.name || '').toLowerCase().trim();
                        const titleOk = tTitle === metaTitle || tTitle.includes(metaTitle) || metaTitle.includes(tTitle);
                        const artistOk =
                            !metaArtist || tArtist === metaArtist || tArtist.includes(metaArtist) || metaArtist.includes(tArtist);
                        return titleOk && artistOk;
                    });

                    if (candidate) {
                        console.log(
                            `[FallbackProvider] Matched ${id} -> ${candidate.id} on ${targetProvider.name} via title/artist (no ISRC match)`
                        );
                        match = candidate;
                    }
                } catch (err) {
                    console.warn(`[FallbackProvider] Title/artist search failed on ${targetProvider.name} for "${meta.title}":`, err);
                }
            }
        }

        if (!match || !match.id) {
            throw new Error(`Cannot translate track ID ${id} to ${targetProvider.name} (no match found via ISRC or title/artist)`);
        }

        // Final safety net: if target is Qobuz, ensure the resolved ID is actually a Qobuz ID.
        // Qobuz IDs from normalizeItem always carry the 'q:' prefix. A raw numeric ID here
        // means a TIDAL ID leaked through — reject it immediately to force TIDAL fallback.
        if (targetProvider.id === 'qobuz') {
            const resolvedStr = String(match.id);
            if (!resolvedStr.startsWith('q:') && /^\d+$/.test(resolvedStr)) {
                console.warn(`[FallbackProvider] SAFETY NET: Resolved ID ${match.id} for Qobuz looks like a raw TIDAL ID. Rejecting to prevent wrong-provider playback.`);
                throw new Error(`Resolved ID ${match.id} is a raw numeric ID — refusing to send to Qobuz (likely a TIDAL ID)`);
            }
        }

        console.log(`[FallbackProvider] Resolved track ID ${id} -> ${match.id} on ${targetProvider.name}`);
        this.trackIdMapCache.set(cacheKey, match.id);
        return match.id;
    }

    /**
     * The providers to try for a stream/download at `quality`, in order. For an
     * Atmos quality, only Atmos-capable providers (e.g. Tidal) — asking Qobuz for
     * Atmos just yields a silent stereo fallback. Falls back to every provider if
     * none advertise Atmos support, so nothing regresses.
     */
    private providersForQuality(quality?: string): Provider[] {
        if (!isAtmosQualityToken(quality)) return this.providers;
        const atmosCapable = this.providers.filter(p => p.supportsAtmos);
        return atmosCapable.length ? atmosCapable : this.providers;
    }

    private async executeWithFallback<T>(
        operation: string,
        args: any[],
        fn: (provider: Provider) => Promise<T>,
        isEmptyResult?: (res: T) => boolean,
        providersOverride?: Provider[]
    ): Promise<T> {
        const providers = providersOverride ?? this.providers;
        if (!providers.length) {
            throw new ProviderError('No providers configured in FallbackProvider', 'fallback', operation);
        }
        const errors: Error[] = [];
        for (const provider of providers) {
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
                // Guard: never send a raw TIDAL numeric ID to Qobuz for streaming
                if (p.id === 'qobuz' && /^\d+$/.test(String(targetId))) {
                    throw new Error(`[getStreamUrl] Refusing to stream raw numeric ID ${targetId} on Qobuz — likely a TIDAL ID`);
                }
                return p.getStreamUrl(targetId, quality);
            },
            res => !res || !res.url,
            this.providersForQuality(quality)
        );
    }

    async getTrackForDownload(id: string | number, quality?: string): Promise<any> {
        return this.executeWithFallback(
            'getTrackForDownload',
            [id, quality],
            async p => {
                const targetId = await this.resolveProviderTrackId(p, id);
                // Guard: never send a raw TIDAL numeric ID to Qobuz for download
                if (p.id === 'qobuz' && /^\d+$/.test(String(targetId))) {
                    throw new Error(`[getTrackForDownload] Refusing to download raw numeric ID ${targetId} on Qobuz — likely a TIDAL ID`);
                }
                if (typeof p.getTrackForDownload === 'function') {
                    return p.getTrackForDownload(targetId, quality);
                }
                return null;
            },
            res => !res || !res.url,
            this.providersForQuality(quality)
        );
    }

    getCoverUrl(id: string | number, size = '320'): string {
        // No provider recognises this id's shape (e.g. a foreign apple:… id) —
        // there's no async ISRC translation available here, so best-effort
        // fall back to the first provider rather than throw.
        const provider = this.getProviderForId(id) || this.providers[0];
        return provider.getCoverUrl(id, size);
    }

    getCoverSrcset(id: string | number): string {
        const provider = this.getProviderForId(id) || this.providers[0];
        return provider.getCoverSrcset(id);
    }

    getArtistPictureUrl(id: string | number, size = '320'): string {
        const provider = this.getProviderForId(id) || this.providers[0];
        return provider.getArtistPictureUrl(id, size);
    }

    getArtistPictureSrcset(id: string | number): string {
        const provider = this.getProviderForId(id) || this.providers[0];
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
