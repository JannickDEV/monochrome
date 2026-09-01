// js/soundcloud-api.js
// SoundCloud API v2 integration for Monochrome Music

import { soundcloudSettings } from './storage.js';
import { toProxyUrl } from './proxy-utils.js';

const FALLBACK_SC_API_BASE = 'https://api-v2.soundcloud.com';

// Known working public client IDs as immediate fallback
const FALLBACK_CLIENT_IDS = [
    'pJ6Fj6roW2KRzWAOwGj6kkQ8VRBJjyBD',
    '6bs1QjDBWrmh7FpcKrIDvzodJ2ZZpRwe',
    'd3d2c6e6d11b31542f7c006b52a1c22b',
];

// Known expired/revoked client IDs to automatically purge from user localStorage
const REVOKED_CLIENT_IDS = new Set([
    '6bs1qIDBmrmh7FpcKRIDvzadJ2ZzpRwe',
    'iZIs9mchVcX5lhVRyQGGAYlNPVAnPzEn',
    'YNSWSuvBmbIa5j7gpUTImuB9itX3isOC',
    'LBCcHmOAgOVzD9BmwT4k8vO9nD8vO9nD',
    '2t9loNQH90kzJcsFANAw61Xz4d3P1h4q',
    'a3e059563d7f63e3e404b9015bc29591',
    'fDoItMDbsbZz8dY16ZzURWhAsJ6q150Y',
]);

let lastSoundCloudMissingNotifyAt = 0;
export function notifySoundCloudSourceMissing() {
    const now = Date.now();
    if (now - lastSoundCloudMissingNotifyAt < 3000) return;
    lastSoundCloudMissingNotifyAt = now;
    import('./downloads.js').then((m) => m.showNotification('Could not find SoundCloud Audio Source (Go+ / Subscriber Only)')).catch(() => {});
}

export class SoundCloudAPI {
    constructor() {
        this.clientId = null;
        this.clientIdsIdx = 0;
        this.cache = new Map();
        this.cacheTimeout = 1000 * 60 * 5; // 5 minutes
    }

    getApiBase() {
        const url = soundcloudSettings.getApiBaseUrl().replace(/\/$/, '');
        if (url.startsWith('/') && (window.Capacitor?.isNativePlatform() || window.location.protocol === 'capacitor:' || window.location.protocol === 'file:')) {
            return FALLBACK_SC_API_BASE;
        }
        return url;
    }

    async getClientId() {
        if (this.clientId && !REVOKED_CLIENT_IDS.has(this.clientId)) return this.clientId;

        // Try checking custom ID from settings or localStorage first
        try {
            const cached = soundcloudSettings.getClientId();
            if (cached && !REVOKED_CLIENT_IDS.has(cached)) {
                this.clientId = cached;
                return cached;
            }
        } catch {}

        // Fallback to our known working IDs
        this.clientId = FALLBACK_CLIENT_IDS[0];
        try {
            soundcloudSettings.setClientId(this.clientId);
        } catch {}
        return this.clientId;
    }

    rotateClientId() {
        this.clientIdsIdx++;
        this.clientId = FALLBACK_CLIENT_IDS[this.clientIdsIdx % FALLBACK_CLIENT_IDS.length];
        try {
            soundcloudSettings.setClientId(this.clientId);
        } catch {}
        return this.clientId;
    }

    async extractFreshClientId() {
        console.info('Attempting to automatically extract a fresh SoundCloud client_id...');
        const now = Date.now();
        if (this._lastExtractionAttempt && now - this._lastExtractionAttempt < 10000) {
            console.warn('Skipping repeated client_id extraction (throttled).');
            return null;
        }
        this._lastExtractionAttempt = now;

        const fetchText = async (url) => {
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), 15000);
            try {
                const res = await fetch(url, { signal: controller.signal });
                return res.ok ? await res.text() : null;
            } catch {
                return null;
            } finally {
                clearTimeout(timer);
            }
        };

        const getProxyUrls = (targetUrl) => [
            targetUrl === 'https://soundcloud.com' ? '/sc-web' : (targetUrl.startsWith('https://a-v2.sndcdn.com') ? targetUrl.replace('https://a-v2.sndcdn.com', '/sc-sndcdn') : null),
            toProxyUrl(targetUrl),
        ].filter(Boolean);

        const collectCandidateIds = (text, ids) => {
            const patterns = [
                // Plain: client_id:"<id>" or client_id:'<id>'
                /client_id:["']([a-zA-Z0-9]{20,64})["']/g,
                // Concatenated: client_id:"ab"+"cd"... (common obfuscation)
                /client_id:["']([a-zA-Z0-9]{4,64}(?:["']\s*\+\s*["'][a-zA-Z0-9]{4,64})+["'])/g,
                // Assignment form: client_id="<id>"
                /client_id\s*=\s*["']([a-zA-Z0-9]{20,64})["']/g,
                // camelCase variant used in newer bundles
                /clientId:["']([a-zA-Z0-9]{20,64})["']/g,
            ];
            for (const re of patterns) {
                for (const m of text.matchAll(re)) {
                    const joined = m[1].replace(/[^a-zA-Z0-9]/g, '');
                    if (/^[a-zA-Z0-9]{20,64}$/.test(joined)) ids.add(joined);
                }
            }
        };

        const candidateIds = new Set();
        let scriptUrls = [];

        // 1. Fetch the SoundCloud home page through the local proxy first, then CORS proxies
        for (const proxyUrl of getProxyUrls('https://soundcloud.com')) {
            const html = await fetchText(proxyUrl);
            if (!html) continue;
            collectCandidateIds(html, candidateIds);
            const matches = [...html.matchAll(/src="(https:\/\/a-v2\.sndcdn\.com\/assets\/[^"]+\.js)"/g)];
            scriptUrls = scriptUrls.concat(matches.map((m) => m[1]));
            if (scriptUrls.length) break;
        }

        // 2. Fetch all asset scripts (deduped), stop once enough candidates are found
        const seen = new Set();
        for (const scriptUrl of scriptUrls) {
            if (seen.has(scriptUrl) || candidateIds.size > 10) continue;
            seen.add(scriptUrl);
            for (const scriptProxyUrl of getProxyUrls(scriptUrl)) {
                const text = await fetchText(scriptProxyUrl);
                if (!text) continue;
                collectCandidateIds(text, candidateIds);
                if (candidateIds.size > 10) break;
            }
        }

        // 3. Verify each candidate against the SoundCloud API
        for (const candidateId of candidateIds) {
            if (REVOKED_CLIENT_IDS.has(candidateId) || candidateId === this.clientId) continue;
            const apiBase = this.getApiBase();
            let testRes;
            try {
                testRes = await fetch(`${apiBase}/search/tracks?q=test&limit=1&client_id=${candidateId}`);
            } catch {}
            if (!testRes || !testRes.ok) {
                try {
                    testRes = await fetch(`${FALLBACK_SC_API_BASE}/search/tracks?q=test&limit=1&client_id=${candidateId}`);
                } catch {}
            }
            if (testRes && testRes.ok) {
                console.info('Successfully extracted and verified fresh SoundCloud client_id:', candidateId);
                this.clientId = candidateId;
                try {
                    soundcloudSettings.setClientId(candidateId);
                } catch {}
                return candidateId;
            }
        }

        console.warn('Failed to extract fresh SoundCloud client_id via proxies.');
        return null;
    }

    async fetchViaProxy(url, signal) {
        try {
            const res = await fetch(toProxyUrl(url), { method: 'GET', signal });
            if (res.ok) {
                return res;
            }
        } catch {}
        return null;
    }

    async fetchWithRetry(endpoint, options = {}, retries = 10) {
        const clientId = await this.getClientId();
        const separator = endpoint.includes('?') ? '&' : '?';
        const apiBase = this.getApiBase();
        const url = `${apiBase}${endpoint}${separator}client_id=${clientId}`;
        const fallbackUrl = `${FALLBACK_SC_API_BASE}${endpoint}${separator}client_id=${clientId}`;

        try {
            let response;
            try {
                response = await fetch(url, {
                    method: 'GET',
                    signal: options.signal,
                });
                if (response.status === 404 && apiBase.startsWith('/')) {
                    console.info(`Local proxy ${apiBase} returned 404 (not configured). Falling back to direct/proxy...`);
                    response = null;
                }
            } catch (networkErr) {
                if (networkErr.name === 'AbortError') throw networkErr;
                console.info(`Fetch to ${apiBase} failed. Attempting direct/CORS proxy...`);
                response = null;
            }

            if (!response) {
                try {
                    response = await fetch(fallbackUrl, { method: 'GET', signal: options.signal });
                } catch (err) {
                    if (err.name === 'AbortError') throw err;
                    console.info('Direct SoundCloud API fetch failed. Attempting via CORS proxy...');
                    response = await this.fetchViaProxy(fallbackUrl, options.signal);
                    if (!response) throw err;
                }
            }

            if ((response.status === 401 || response.status === 403 || response.status === 429) && retries > 0) {
                console.warn(`SoundCloud client ID ${response.status}, rotating client ID...`);
                const fresh = await this.extractFreshClientId();
                if (!fresh) {
                    this.rotateClientId();
                }
                return this.fetchWithRetry(endpoint, options, retries - 1);
            }

            if (!response.ok) {
                const proxyRes = await this.fetchViaProxy(fallbackUrl, options.signal);
                if (proxyRes && proxyRes.ok) {
                    return await proxyRes.json();
                }
                throw new Error(`SoundCloud API failed with status ${response.status}`);
            }

            return await response.json();
        } catch (error) {
            if (error.name === 'AbortError') throw error;
            
            if (retries > 0) {
                console.warn('SoundCloud network/CORS error after proxy attempts, rotating client ID and retrying...');
                if (retries === 1) {
                    await this.extractFreshClientId();
                } else {
                    this.rotateClientId();
                }
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

        // Prefer progressive HTTP stream (audio/mpeg) first, then HLS audio/mpeg, then HLS AAC/mp4, then Opus
        const sortedTranscodings = [...transcodings].sort((a, b) => {
            const score = (t) => {
                if (t?.format?.protocol === 'progressive') return 4;
                if (t?.format?.protocol === 'hls' && (t?.format?.mime_type === 'audio/mpeg' || t?.format?.mime_type?.includes('mpeg'))) return 3;
                if (t?.format?.protocol === 'hls' && t?.format?.mime_type?.includes('mp4')) return 2;
                if (t?.format?.protocol === 'hls') return 1;
                return 0;
            };
            return score(b) - score(a);
        });

        let lastError = null;
        for (let attempt = 0; attempt < 3; attempt++) {
            const clientId = await this.getClientId();

            for (const selected of sortedTranscodings) {
                if (!selected || !selected.url) continue;

                let targetStreamUrl = selected.url;
                if (targetStreamUrl.startsWith('https://api-v2.soundcloud.com')) {
                    targetStreamUrl = targetStreamUrl.replace('https://api-v2.soundcloud.com', this.getApiBase());
                } else if (targetStreamUrl.startsWith('https://api.soundcloud.com')) {
                    targetStreamUrl = targetStreamUrl.replace('https://api.soundcloud.com', this.getApiBase());
                }

                const separator = targetStreamUrl.includes('?') ? '&' : '?';
                try {
                    const streamRes = await fetch(`${targetStreamUrl}${separator}client_id=${clientId}`, {
                        signal: options.signal,
                    });

                    if (streamRes.status === 401 || streamRes.status === 403 || streamRes.status === 429) {
                        lastError = new Error(`SoundCloud auth/rate-limit (${streamRes.status}) resolving stream`);
                        break; // Break out of transcodings loop to rotate client ID and retry
                    }

                    if (!streamRes.ok) {
                        lastError = new Error(`Failed to resolve SoundCloud stream URL: ${streamRes.status}`);
                        console.warn(`[SoundCloudAPI] Transcoding (${selected.format?.protocol} ${selected.format?.mime_type}) returned ${streamRes.status}. Trying next transcoding...`);
                        continue;
                    }

                    const streamJson = await streamRes.json();
                    if (!streamJson || !streamJson.url) {
                        lastError = new Error('SoundCloud stream URL response was empty');
                        continue;
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
                } catch (err) {
                    lastError = err;
                    if (err.name === 'AbortError') throw err;
                    console.warn(`[SoundCloudAPI] Error fetching transcoding ${selected.url}:`, err);
                }
            }

            // If we broke or failed due to 401/403/404/429 authorization/rate limit, rotate/extract client ID and retry
            if (attempt < 2 && lastError && (lastError.message.includes('401') || lastError.message.includes('403') || lastError.message.includes('404') || lastError.message.includes('429'))) {
                if (attempt === 0) {
                    console.warn('[SoundCloudAPI] Rotating static clientId due to stream authorization/rate-limit/not-found error');
                    this.rotateClientId();
                } else if (attempt === 1) {
                    console.warn('[SoundCloudAPI] Attempting to extract a fresh clientId from SoundCloud via proxy due to stream error');
                    await this.extractFreshClientId();
                }
                continue;
            }
            break;
        }

        notifySoundCloudSourceMissing();
        throw lastError || new Error('Could not resolve a valid stream URL from any SoundCloud transcoding');
    }

    async getTrackRecommendations(trackId, options = {}) {
        try {
            const numericId = String(trackId).replace(/^sc_/, '');
            const data = await this.fetchWithRetry(`/tracks/${numericId}/related?limit=20`, options);
            if (!data || !data.collection) return [];
            return data.collection
                .filter((item) => item.kind === 'track' && item.streamable !== false && item.policy !== 'BLOCK')
                .map((item) => this.transformSoundCloudTrack(item));
        } catch (error) {
            console.warn('SoundCloud getTrackRecommendations failed:', error);
            return [];
        }
    }

    async getArtistById(artistId, options = {}) {
        try {
            const numericId = String(artistId).replace(/^sc_user_|^sc_/, '');
            const data = await this.fetchWithRetry(`/users/${numericId}`, options);
            if (!data) return null;

            let artwork = data.avatar_url || '';
            if (artwork && artwork.includes('-large.')) {
                artwork = artwork.replace('-large.', '-t500x500.');
            }

            return {
                id: `sc_user_${data.id}`,
                name: data.username || 'Unknown Artist',
                picture: artwork,
                description: data.description || '',
                url: data.permalink_url || '',
                albums: [],
                singles: [],
                topTracks: [],
                videos: [],
            };
        } catch (error) {
            console.warn('SoundCloud getArtistById failed:', error);
            return {
                id: artistId,
                name: 'SoundCloud Artist',
                picture: null,
                albums: [],
                singles: [],
                topTracks: [],
                videos: [],
            };
        }
    }

    async getArtistTopTracks(artistId, options = {}) {
        try {
            const numericId = String(artistId).replace(/^sc_user_|^sc_/, '');
            const data = await this.fetchWithRetry(`/users/${numericId}/tracks?limit=20`, options);
            if (!data || !data.collection) return [];
            return data.collection
                .filter((item) => item.kind === 'track' && item.streamable !== false && item.policy !== 'BLOCK')
                .map((item) => this.transformSoundCloudTrack(item));
        } catch (error) {
            console.warn('SoundCloud getArtistTopTracks failed:', error);
            return [];
        }
    }

    transformSoundCloudTrack(scTrack) {
        const id = scTrack.id ? `sc_${scTrack.id}` : `sc_${Date.now()}`;
        const title = scTrack.title || 'Unknown Title';
        const artistName = scTrack.user?.username || 'Unknown Artist';
        const artistId = scTrack.user?.id ? `sc_user_${scTrack.user.id}` : null;
        
        // Artwork URL upgrade: SoundCloud defaults to 'large' (100x100), upgrade to 't500x500' for high quality
        let artwork = scTrack.artwork_url || scTrack.user?.avatar_url || '';
        if (artwork && artwork.includes('-large.')) {
            artwork = artwork.replace('-large.', '-t500x500.');
        }

        const durationSec = Math.floor((scTrack.duration || 0) / 1000);
        const pm = scTrack.publisher_metadata || {};
        const releaseDate = (scTrack.release_date || scTrack.display_date || scTrack.created_at || '').split('T')[0] || undefined;
        const copyright = [pm.p_line, pm.c_line].filter(Boolean).join(' ') || undefined;
        const bpm = Number(scTrack.bpm) || undefined;

        return {
            id,
            title,
            artist: { id: artistId, name: artistName },
            artists: [{ id: artistId, name: artistName }],
            album: {
                id: null,
                title: pm.album_title || title, // In SoundCloud, track title often acts as single release title
                cover: artwork,
                releaseDate,
            },
            duration: durationSec,
            explicit: Boolean(pm.explicit),
            provider: 'soundcloud',
            isSoundCloud: true,
            audioQuality: 'HIGH',
            bpm,
            genres: scTrack.genre ? [scTrack.genre] : [],
            isrc: pm.isrc || scTrack.isrc || '',
            composer: pm.writer_composer || undefined,
            label: pm.publisher || scTrack.label_name || undefined,
            copyright,
            releaseDate,
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
