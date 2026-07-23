import { Provider, SearchOptions, SearchResults, StreamInfo } from '../../../js/services/types.js';
import { FallbackProvider } from '../../../js/services/fallback/FallbackProvider.js';

const devModeUrl = process.env.DEV_MODE_URL || 'https://hf-core.bitperfect.dedyn.io';
const qobuzUrl = process.env.QOBUZ_URL || 'https://qz-api.bitperfect.dedyn.io';

class BotTidalProvider implements Provider {
    readonly id = 'tidal';
    readonly name = 'Tidal';

    async searchTracks(query: string, options: SearchOptions = {}): Promise<{ items: any[] }> {
        const limit = options.limit || 10;
        const res = await fetch(`${devModeUrl}/search/?s=${encodeURIComponent(query)}&limit=${limit}`);
        if (!res.ok) throw new Error(`Tidal search failed: ${res.statusText}`);
        const data = await res.json();
        return { items: data.tracks?.items || [] };
    }

    async getStreamUrl(id: string | number): Promise<StreamInfo> {
        const cleanId = String(id).replace(/^t:/, '');
        const res = await fetch(`${devModeUrl}/streamUrl/?id=${cleanId}`);
        if (!res.ok) throw new Error(`Tidal stream failed: ${res.statusText}`);
        const data = await res.json();
        return { url: data.url, provider: 'tidal', quality: data.quality };
    }

    async getTrackMetadata(id: string | number): Promise<any> {
        const cleanId = String(id).replace(/^t:/, '');
        const res = await fetch(`${devModeUrl}/info/?id=${cleanId}`);
        if (!res.ok) throw new Error(`Tidal metadata failed: ${res.statusText}`);
        return await res.json();
    }

    // Dummy implementations for Provider interface
    async search(query: string) { return { tracks: await this.searchTracks(query) }; }
    async searchAlbums() { return { items: [] }; }
    async searchArtists() { return { items: [] }; }
    async getTrack(id: string | number) { return await this.getTrackMetadata(id); }
    async getAlbum() { return null; }
    async getArtist() { return null; }
    getCoverUrl(id: string | number) { return `https://resources.tidal.com/images/${String(id).replace(/-/g, '/')}/640x640.jpg`; }
    getCoverSrcset() { return ''; }
    getArtistPictureUrl() { return ''; }
    getArtistPictureSrcset() { return ''; }
}

class BotQobuzProvider implements Provider {
    readonly id = 'qobuz';
    readonly name = 'Qobuz';

    async searchTracks(query: string, options: SearchOptions = {}): Promise<{ items: any[] }> {
        const limit = options.limit || 10;
        const res = await fetch(`${qobuzUrl}/search?query=${encodeURIComponent(query)}&limit=${limit}&type=tracks`);
        if (!res.ok) throw new Error(`Qobuz search failed: ${res.statusText}`);
        const data = await res.json();
        return { items: data.tracks?.items || [] };
    }

    async getStreamUrl(id: string | number): Promise<StreamInfo> {
        const cleanId = String(id).replace(/^q:/, '');
        const res = await fetch(`${qobuzUrl}/track/getFileUrl?track_id=${cleanId}&format_id=27`);
        if (!res.ok) throw new Error(`Qobuz stream failed: ${res.statusText}`);
        const data = await res.json();
        return { url: data.url, provider: 'qobuz', quality: 'HI_RES' };
    }

    async getTrackMetadata(id: string | number): Promise<any> {
        const cleanId = String(id).replace(/^q:/, '');
        const res = await fetch(`${qobuzUrl}/track/get?track_id=${cleanId}`);
        if (!res.ok) throw new Error(`Qobuz metadata failed: ${res.statusText}`);
        return await res.json();
    }

    // Dummy implementations for Provider interface
    async search(query: string) { return { tracks: await this.searchTracks(query) }; }
    async searchAlbums() { return { items: [] }; }
    async searchArtists() { return { items: [] }; }
    async getTrack(id: string | number) { return await this.getTrackMetadata(id); }
    async getAlbum() { return null; }
    async getArtist() { return null; }
    getCoverUrl() { return ''; }
    getCoverSrcset() { return ''; }
    getArtistPictureUrl() { return ''; }
    getArtistPictureSrcset() { return ''; }
}

export const qobuzProvider = new BotQobuzProvider();
export const tidalProvider = new BotTidalProvider();

// Re-use the exact same FallbackProvider logic (ISRC matching, priority cascading) from the main app
export const fallbackProvider = new FallbackProvider([qobuzProvider, tidalProvider]);

export { tidalProvider as defaultSearchProvider };
