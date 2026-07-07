/**
 * Core interface and error types for music streaming providers.
 */

export class ProviderError extends Error {
    provider: string;
    operation: string;
    originalError?: any;

    constructor(message: string, provider: string, operation: string, originalError?: any) {
        super(message);
        this.name = 'ProviderError';
        this.provider = provider;
        this.operation = operation;
        this.originalError = originalError;
    }
}

export interface SearchOptions {
    limit?: number;
    offset?: number;
    [key: string]: any;
}

export interface SearchResults {
    tracks?: { items: any[] };
    albums?: { items: any[] };
    artists?: { items: any[] };
    playlists?: { items: any[] };
    videos?: { items: any[] };
    [key: string]: any;
}

export interface StreamInfo {
    url: string;
    provider?: string;
    quality?: string;
    rgInfo?: any;
    [key: string]: any;
}

export interface Provider {
    readonly id: string;
    readonly name: string;

    // Search operations
    search(query: string, options?: SearchOptions): Promise<SearchResults>;
    searchTracks(query: string, options?: SearchOptions): Promise<{ items: any[] }>;
    searchAlbums(query: string, options?: SearchOptions): Promise<{ items: any[] }>;
    searchArtists(query: string, options?: SearchOptions): Promise<{ items: any[] }>;
    searchPlaylists?(query: string, options?: SearchOptions): Promise<{ items: any[] }>;
    searchVideos?(query: string, options?: SearchOptions): Promise<{ items: any[] }>;

    // Entity lookup operations
    getTrack(id: string | number, quality?: string): Promise<any>;
    getTrackMetadata(id: string | number): Promise<any>;
    getAlbum(id: string | number): Promise<any>;
    getArtist(id: string | number): Promise<any>;
    getArtistBiography?(id: string | number): Promise<any>;
    getPlaylist?(id: string | number): Promise<any>;
    getMix?(id: string | number): Promise<any>;
    getVideo?(id: string | number): Promise<any>;
    getVideoStreamUrl?(id: string | number): Promise<any>;

    // Streaming operations
    getStreamUrl(id: string | number, quality?: string): Promise<StreamInfo>;
    getTrackForDownload?(id: string | number, quality?: string): Promise<any>;

    // Artwork and media helpers
    getCoverUrl(id: string | number, size?: string): string;
    getCoverSrcset(id: string | number): string;
    getArtistPictureUrl(id: string | number, size?: string): string;
    getArtistPictureSrcset(id: string | number): string;
    getVideoCoverUrl?(imageId: string | number, size?: string): string | null;

    // Recommendations and relationships
    getSimilarArtists?(artistId: string | number): Promise<any>;
    getSimilarAlbums?(albumId: string | number): Promise<any>;
    getArtistTopTracks?(artistId: string | number, options?: any): Promise<any>;
    getRecommendedTracksForPlaylist?(tracks: any[], limit?: number, options?: any): Promise<any>;
}
