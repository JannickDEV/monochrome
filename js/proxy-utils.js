const AUDIO_PROXY_BASE_URL = 'https://audio.bitperfect.dedyn.io/proxy-audio/?url=';

export const isTidalAudioUrl = (url) => {
    if (!url || typeof url !== 'string') return false;
    if (url.startsWith(AUDIO_PROXY_BASE_URL)) return false;
    if (url.startsWith('blob:') || url.startsWith('data:')) return false;

    try {
        const parsed = new URL(url);
        const hostname = parsed.hostname.toLowerCase();
        if (hostname !== 'tidal.com' && !hostname.endsWith('.tidal.com')) return false;
        if (hostname === 'api.tidal.com' || hostname === 'openapi.tidal.com' || hostname === 'resources.tidal.com') {
            return false;
        }

        return hostname.includes('audio') || /\.(aac|flac|m4a|m4s|mp4|mpd|m3u8)(?:$|[?#])/i.test(parsed.pathname);
    } catch {
        return false;
    }
};

export const getProxyUrl = (url) => {
    if (!url) return url;
    if (url.includes('/api/decrypt-stream')) return url;

    if (isTidalAudioUrl(url)) {
        return `${AUDIO_PROXY_BASE_URL}${encodeURIComponent(url)}`;
    }

    return url;
};

export const wrapTidalUrl = (url) => {
    if (!url || typeof url !== 'string') return url;
    return url
        .replace('openapi.tidal.com', 'lol.samidy.workers.dev/openapi')
        .replace('api.tidal.com', 'lol.samidy.workers.dev/api')
        .replace('https://tidal.com', 'https://lol.samidy.workers.dev/tidal');
};
