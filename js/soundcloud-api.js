// js/soundcloud-api.js
// SoundCloud API v2 integration for Monochrome Music

const SC_API_BASE = 'https://api-v2.soundcloud.com';

// Known working public client IDs as immediate fallback
const FALLBACK_CLIENT_IDS = [
    'LBCcHmOAgOVzD9BmwT4k8vO9nD8vO9nD',
    '2t9loNQH90kzJcsFANAw61Xz4d3P1h4q',
    'a3e059563d7f63e3e404b9015bc29591',
    'fDoItMDbsbZz8dY16ZzURWhAsJ6q150Y',
    'iZIs9mchVcX5lhVRyQGGAYlNPVAnPzEn',
];

export class SoundCloudAPI {
    constructor() {
        this.clientId = null;
        this.clientIdsIdx = 0;
        this.cache = new Map();
        this.cacheTimeout = 1000 * 60 * 5; // 5 minutes
    }

    async getClientId() {
        if (this.clientId) return this.clientId;

        // Try checking localStorage first
        try {
            const cached = localStorage.getItem('sc_client_id');
            if (cached && cached.length === 32) {
                this.clientId = cached;
                return this.clientId;
            }
        } catch {}

        // Fallback to our curated list of known working client IDs
        this.clientId = FALLBACK_CLIENT_IDS[this.clientIdsIdx % FALLBACK_CLIENT_IDS.length];
        return this.clientId;
    }

    rotateClientId() {
        this.clientIdsIdx++;
        this.clientId = FALLBACK_CLIENT_IDS[this.clientIdsIdx % FALLBACK_CLIENT_IDS.length];
        try {
            localStorage.setItem('sc_client_id', this.clientId);
        } catch {}
        return this.clientId;
    }

    async fetchWithRetry(endpoint, options = {}, retries = 4) {
        const clientId = await this.getClientId();
        const separator = endpoint.includes('?') ? '&' : '?';
        const url = `${SC_API_BASE}${endpoint}${separator}client_id=${clientId}`;

        try {
            const response = await fetch(url, {
                method: 'GET',
                signal: options.signal,
            });

            if ((response.status === 401 || response.status === 403 || response.status === 429) && retries > 0) {
                console.warn(`SoundCloud client ID ${response.status}, rotating client ID...`);
                this.rotateClientId();
                return this.fetchWithRetry(endpoint, options, retries - 1);
            }

            if (!response.ok) {
                throw new Error(`SoundCloud API failed with status ${response.status}`);
            }

            return await response.json();
        } catch (error) {
            if (error.name === 'AbortError') throw error;
            
            // When SoundCloud returns 401/403 on cross-origin requests, it omits CORS headers.
            // This causes the browser to throw a TypeError (NetworkError / Failed to fetch) instead of returning the HTTP status.
            if (retries > 0) {
                console.warn('SoundCloud network/CORS error (likely expired client ID), rotating and retrying...');
                this.rotateClientId();
                return this.fetchWithRetry(endpoint, options, retries - 1);
            }

            console.error('SoundCloud request error:', error);
            throw error;
        }
    }

    async searchTracks(query, options = {}) {
        try {
            const limit = options.limit || 20;
            const offset = options.offset || 0;
            const data = await this.fetchWithRetry(
                `/search/tracks?q=${encodeURIComponent(query)}&limit=${limit}&offset=${offset}`,
                options
            );

            if (!data || !data.collection) {
                return { items: [], total: 0 };
            }

            const tracks = data.collection
                .filter((item) => item.kind === 'track' && item.streamable !== false && item.policy !== 'BLOCK')
                .map((item) => this.transformSoundCloudTrack(item));

            return {
                items: tracks,
                total: data.total_results || tracks.length,
            };
        } catch (error) {
            if (error.name === 'AbortError') throw error;
            console.error('SoundCloud search failed:', error);
            return { items: [], total: 0 };
        }
    }

    async getTrackById(trackId, options = {}) {
        const numericId = String(trackId).replace(/^sc_/, '');
        const cacheKey = `track_${numericId}`;
        const cached = this.cache.get(cacheKey);
        if (cached && Date.now() - cached.timestamp < this.cacheTimeout) {
            return cached.data;
        }

        const data = await this.fetchWithRetry(`/tracks/${numericId}`, options);
        if (data) {
            const transformed = this.transformSoundCloudTrack(data);
            this.cache.set(cacheKey, { data: transformed, timestamp: Date.now() });
            return transformed;
        }
        return null;
    }

    async getStreamUrl(trackId, options = {}) {
        const numericId = String(trackId).replace(/^sc_/, '');
        const trackData = await this.fetchWithRetry(`/tracks/${numericId}`, options);

        if (!trackData || !trackData.media || !trackData.media.transcodings || trackData.media.transcodings.length === 0) {
            throw new Error('No audio transcodings available for this SoundCloud track');
        }

        const transcodings = trackData.media.transcodings;

        // Prefer progressive HTTP stream (audio/mpeg) for clean direct playback and downloading
        let selected = transcodings.find((t) => t.format && t.format.protocol === 'progressive');
        if (!selected) {
            // Fallback to HLS (m3u8)
            selected = transcodings.find((t) => t.format && t.format.protocol === 'hls');
        }

        if (!selected || !selected.url) {
            throw new Error('Could not find a supported stream protocol in SoundCloud transcodings');
        }

        const clientId = await this.getClientId();
        const separator = selected.url.includes('?') ? '&' : '?';
        const streamRes = await fetch(`${selected.url}${separator}client_id=${clientId}`, {
            signal: options.signal,
        });

        if (!streamRes.ok) {
            throw new Error(`Failed to resolve SoundCloud stream URL: ${streamRes.status}`);
        }

        const streamJson = await streamRes.json();
        if (!streamJson || !streamJson.url) {
            throw new Error('SoundCloud stream URL response was empty');
        }

        return {
            url: streamJson.url,
            provider: 'soundcloud',
            quality: 'HIGH',
            qualityDisplay: 'MP3 320 / AAC',
            mimeType: selected.format?.mime_type || 'audio/mpeg',
            protocol: selected.format?.protocol || 'progressive',
            rgInfo: null,
        };
    }

    transformSoundCloudTrack(scTrack) {
        const id = scTrack.id ? `sc_${scTrack.id}` : `sc_${Date.now()}`;
        const title = scTrack.title || 'Unknown Title';
        const artistName = scTrack.user?.username || 'Unknown Artist';
        const artistId = scTrack.user?.id || null;
        
        // Artwork URL upgrade: SoundCloud defaults to 'large' (100x100), upgrade to 't500x500' for high quality
        let artwork = scTrack.artwork_url || scTrack.user?.avatar_url || '';
        if (artwork && artwork.includes('-large.')) {
            artwork = artwork.replace('-large.', '-t500x500.');
        }

        const durationSec = Math.floor((scTrack.duration || 0) / 1000);

        return {
            id,
            title,
            artist: { id: artistId, name: artistName },
            artists: [{ id: artistId, name: artistName }],
            album: {
                id: null,
                title, // In SoundCloud, track title often acts as single release title
                cover: artwork,
            },
            duration: durationSec,
            explicit: false, // SoundCloud API does not provide standard explicit flag
            provider: 'soundcloud',
            isSoundCloud: true,
            audioQuality: 'HIGH',
            dateAdded: scTrack.created_at || new Date().toISOString(),
            permalinkUrl: scTrack.permalink_url || '',
            description: scTrack.description || '',
            playbackCount: scTrack.playback_count || 0,
            likesCount: scTrack.likes_count || 0,
            raw: scTrack,
        };
    }
}

export const soundCloudAPI = new SoundCloudAPI();
