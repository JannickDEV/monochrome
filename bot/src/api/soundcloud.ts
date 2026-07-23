import { Provider, ProviderError, SearchOptions, SearchResults, StreamInfo } from '../../../js/services/types.js';

const FALLBACK_SC_API_BASE = 'https://api-v2.soundcloud.com';
const FALLBACK_CLIENT_IDS = [
    '6bs1QjDBWrmh7FpcKrIDvzodJ2ZZpRwe',
    'd3d2c6e6d11b31542f7c006b52a1c22b',
];

export class SoundCloudProvider implements Provider {
    readonly id = 'soundcloud';
    readonly name = 'SoundCloud';
    
    private clientId: string | null = null;
    private clientIdsIdx = 0;

    async getClientId(): Promise<string> {
        if (this.clientId) return this.clientId;
        this.clientId = FALLBACK_CLIENT_IDS[0];
        return this.clientId;
    }

    rotateClientId(): string {
        this.clientIdsIdx++;
        this.clientId = FALLBACK_CLIENT_IDS[this.clientIdsIdx % FALLBACK_CLIENT_IDS.length];
        return this.clientId;
    }

    async extractFreshClientId(): Promise<string | null> {
        console.info('[SoundCloudProvider] Extracting fresh client ID...');
        try {
            const res = await fetch('https://soundcloud.com');
            if (!res.ok) return null;
            const html = await res.text();
            
            const scriptMatches = [...html.matchAll(/src="(https:\/\/a-v2\.sndcdn\.com\/assets\/[^"]+\.js)"/g)];
            if (!scriptMatches.length) return null;
            
            const scriptsToCheck = scriptMatches.slice(-5).map((m) => m[1]);
            for (const scriptUrl of scriptsToCheck) {
                const scriptRes = await fetch(scriptUrl);
                if (!scriptRes.ok) continue;
                const scriptText = await scriptRes.text();
                
                const idMatches = [...scriptText.matchAll(/client_id:["']([a-zA-Z0-9]{32})["']/g)];
                for (const idMatch of idMatches) {
                    const candidateId = idMatch[1];
                    const testRes = await fetch(`${FALLBACK_SC_API_BASE}/search/tracks?q=test&limit=1&client_id=${candidateId}`);
                    if (testRes.ok) {
                        this.clientId = candidateId;
                        console.info('[SoundCloudProvider] Found valid client_id:', candidateId);
                        return candidateId;
                    }
                }
            }
        } catch (e) {
            console.error('[SoundCloudProvider] Failed to extract client_id', e);
        }
        return null;
    }

    async fetchWithRetry(endpoint: string, retries = 3): Promise<any> {
        const clientId = await this.getClientId();
        const separator = endpoint.includes('?') ? '&' : '?';
        const url = `${FALLBACK_SC_API_BASE}${endpoint}${separator}client_id=${clientId}`;

        try {
            const response = await fetch(url);
            if (response.status === 401 || response.status === 403 || response.status === 429) {
                if (retries > 0) {
                    if (retries === 1) await this.extractFreshClientId();
                    else this.rotateClientId();
                    return this.fetchWithRetry(endpoint, retries - 1);
                }
            }
            if (!response.ok) throw new Error(`SoundCloud API failed with status ${response.status}`);
            return await response.json();
        } catch (error) {
            if (retries > 0) {
                this.rotateClientId();
                return this.fetchWithRetry(endpoint, retries - 1);
            }
            throw error;
        }
    }

    private transformTrack(item: any) {
        return {
            id: `sc_${item.id}`,
            originalId: item.id,
            title: item.title,
            artist: { name: item.user?.username || 'Unknown Artist', id: item.user?.id },
            album: { title: 'SoundCloud Single' },
            duration: Math.round((item.duration || 0) / 1000),
            provider: 'soundcloud',
            cover: item.artwork_url ? item.artwork_url.replace('-large', '-t500x500') : null,
            media: item.media
        };
    }

    async searchTracks(query: string, options: SearchOptions = {}): Promise<{ items: any[] }> {
        const limit = options.limit || 20;
        const data = await this.fetchWithRetry(`/search/tracks?q=${encodeURIComponent(query)}&limit=${limit}`);
        if (!data || !data.collection) return { items: [] };

        const items = data.collection
            .filter((item: any) => item.kind === 'track' && item.streamable !== false)
            .map((item: any) => this.transformTrack(item));
            
        return { items };
    }

    async resolveUrl(url: string): Promise<any> {
        const data = await this.fetchWithRetry(`/resolve?url=${encodeURIComponent(url)}`);
        if (data && data.kind === 'track') {
            return this.transformTrack(data);
        }
        throw new Error('URL did not resolve to a streamable track');
    }

    async getStreamUrl(id: string | number): Promise<StreamInfo> {
        const scId = String(id).replace('sc_', '');
        const trackData = await this.fetchWithRetry(`/tracks/${scId}`);
        if (!trackData || !trackData.media || !trackData.media.transcodings) {
            throw new ProviderError('No media streams available', 'soundcloud', 'getStreamUrl');
        }

        const transcodings = trackData.media.transcodings;
        // Prefer HLS Opus or HQ
        let selected = transcodings.find((t: any) => t.format.protocol === 'hls' && t.format.mime_type.includes('opus')) ||
                       transcodings.find((t: any) => t.format.protocol === 'hls' && t.quality === 'hq') ||
                       transcodings.find((t: any) => t.format.protocol === 'hls') ||
                       transcodings[0];

        const clientId = await this.getClientId();
        const streamInfoRes = await fetch(`${selected.url}?client_id=${clientId}`);
        if (!streamInfoRes.ok) throw new Error('Failed to fetch stream URL');
        
        const streamInfo = await streamInfoRes.json();
        return {
            url: streamInfo.url,
            provider: 'soundcloud',
            quality: selected.quality
        };
    }

    // Dummy implementations for full Provider interface compliance
    async search(query: string) { return { tracks: await this.searchTracks(query) }; }
    async searchAlbums() { return { items: [] }; }
    async searchArtists() { return { items: [] }; }
    async getTrack() { return null; }
    async getTrackMetadata() { return null; }
    async getAlbum() { return null; }
    async getArtist() { return null; }
    getCoverUrl() { return ''; }
    getCoverSrcset() { return ''; }
    getArtistPictureUrl() { return ''; }
    getArtistPictureSrcset() { return ''; }
}
