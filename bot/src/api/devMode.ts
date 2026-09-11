import { SearchOptions } from '../../../js/services/types.js';
import { FallbackProvider } from '../../../js/services/fallback/FallbackProvider.js';
import { QobuzProvider, type QobuzRequestClient } from '../../../js/services/qobuz/QobuzProvider.js';
import { TidalProvider } from '../../../js/services/tidal/TidalProvider.js';
import { config } from '../config.js';

const devModeUrl = config.hifiUrl;
const qobuzUrl = config.qobuzUrl;

/**
 * A single-instance HTTP client for the Qobuz wrapper API (the bot only ever
 * points at one Qobuz URL, no app-id/secret/token auth). QobuzClient itself
 * (js/services/qobuz/QobuzClient.ts) falls back to browser-only `storage.js`
 * settings when not given explicit options, which pulls in Vite-only asset
 * imports that neither `bun run` nor `bun build` can resolve outside the main
 * app — so the bot supplies its own minimal client satisfying the same
 * `request()` shape instead, and gets the exact same QobuzProvider logic
 * (normalizeItem's `q:` id-prefixing, the Atmos guard, the raw-numeric-id
 * guard, the `/trackManifests/` endpoint) on top of it.
 */
class BotQobuzClient implements QobuzRequestClient {
    async request(endpoint: string, params: Record<string, any> = {}): Promise<any> {
        const searchParams = new URLSearchParams();
        for (const [key, val] of Object.entries(params)) {
            if (val !== undefined && val !== null) searchParams.append(key, String(val));
        }
        const path = endpoint.startsWith('/') ? endpoint : '/' + endpoint;
        const qs = searchParams.toString();
        const res = await fetch(`${qobuzUrl}${path}${qs ? '?' + qs : ''}`, {
            headers: { Accept: 'application/json' },
        });
        const data = await res.json().catch(() => null);
        if (!res.ok) {
            const errMsg = data && (data.error || data.message || JSON.stringify(data));
            throw new Error(`Qobuz API Error (${res.status}): ${errMsg || res.statusText}`);
        }
        return data;
    }
}

/**
 * A single-instance HiFi API client (the bot only ever points at one Tidal
 * wrapper URL, unlike the main app's multi-instance `LosslessAPI`). Wrapped
 * by the shared `TidalProvider` so ID cleaning, error wrapping, and the
 * `supportsAtmos` flag stay identical to the main app's Tidal logic.
 */
class BotHiFiApi {
    async search(query: string, options: SearchOptions = {}): Promise<{ tracks: { items: any[] } }> {
        return { tracks: await this.searchTracks(query, options) };
    }

    async searchTracks(query: string, options: SearchOptions = {}): Promise<{ items: any[] }> {
        const limit = options.limit || 10;
        const res = await fetch(`${devModeUrl}/search/?s=${encodeURIComponent(query)}&limit=${limit}`);
        if (!res.ok) throw new Error(`Tidal search failed: ${res.statusText}`);
        const data = await res.json();
        return { items: data.data?.items || data.items || [] };
    }

    async searchAlbums(): Promise<{ items: any[] }> {
        return { items: [] };
    }

    async searchArtists(): Promise<{ items: any[] }> {
        return { items: [] };
    }

    async getTrack(id: string | number): Promise<any> {
        return this.getTrackMetadata(id);
    }

    async getTrackMetadata(id: string | number): Promise<any> {
        const res = await fetch(`${devModeUrl}/info/?id=${id}`);
        if (!res.ok) throw new Error(`Tidal metadata failed: ${res.statusText}`);
        const data = await res.json();
        return data.data || data;
    }

    async getAlbum(): Promise<any> {
        return null;
    }

    async getArtist(): Promise<any> {
        return null;
    }

    async getPlaylist(): Promise<any> {
        return null;
    }

    async getStreamUrl(id: string | number): Promise<{ url: string; quality?: string }> {
        const res = await fetch(`${devModeUrl}/streamUrl/?id=${id}`);
        if (!res.ok) throw new Error(`Tidal stream failed: ${res.statusText}`);
        const data = await res.json();
        return { url: data.url, quality: data.quality };
    }

    getCoverUrl(id: string | number): string {
        return `https://resources.tidal.com/images/${String(id).replace(/-/g, '/')}/640x640.jpg`;
    }

    getCoverSrcset(): string {
        return '';
    }

    getArtistPictureUrl(): string {
        return '';
    }

    getArtistPictureSrcset(): string {
        return '';
    }
}

export const qobuzProvider = new QobuzProvider(new BotQobuzClient());
export const tidalProvider = new TidalProvider(new BotHiFiApi());

// Re-use the exact same FallbackProvider logic (ISRC matching, priority cascading) from the main app
export const fallbackProvider = new FallbackProvider([qobuzProvider, tidalProvider]);

export { tidalProvider as defaultSearchProvider };
