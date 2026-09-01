// js/proxy-utils.js
//
// Routes outbound traffic to third-party hosts through the self-hosted NGINX
// proxy on the VPS. Anything on our own infrastructure (the *.bitperfect.dedyn.io
// range, which includes the API, Qobuz, audio and PocketBase hosts),
// same-origin/relative URLs, and blob:/data: URLs are left untouched.
//
// Coverage: string URLs passed to getProxyUrl() (media-element src, Shaka
// player.load, HLS/DASH downloaders) and every GET/HEAD request that goes
// through window.fetch or XMLHttpRequest once installGlobalProxy() has run.
// Not covered: non-GET requests (a ?url= proxy can't relay method + body
// faithfully) and plain <img>/<script> tag loads.

// Legacy Tidal-audio proxy, kept so already-wrapped URLs are recognised.
const AUDIO_PROXY_BASE_URL = 'https://audio.bitperfect.dedyn.io/proxy-audio/?url=';

// General-purpose pass-through proxy. Expects an NGINX `location /proxy/` that
// reverse-proxies to the (url-encoded) `url` query argument. See nginx.conf.
export const PROXY_BASE_URL = 'https://audio.bitperfect.dedyn.io/proxy/?url=';

// Never proxied: our own infrastructure + widgets/telemetry that break when wrapped.
const DIRECT_HOST_SUFFIXES = [
    '.bitperfect.dedyn.io', // hf-core, qz-api, audio, pb-data, ...
    '.ingest.sentry.io', // error telemetry (DSN-scoped)
    '.localhost',
];
const DIRECT_HOSTS = new Set([
    'bitperfect.dedyn.io',
    'sentry.io',
    'challenges.cloudflare.com', // Cloudflare Turnstile widget
    'localhost',
    '127.0.0.1',
    '::1',
    '[::1]',
    '0.0.0.0',
]);

const getLocationHref = () => (typeof location !== 'undefined' ? location.href : undefined);
const getLocationOrigin = () => (typeof location !== 'undefined' ? location.origin : undefined);

/**
 * True when `url` points at a third-party host that should be routed through the
 * VPS proxy. Relative URLs, same-origin URLs, our own infra, blob:/data:, and
 * URLs already pointing at the proxy all return false.
 * @param {string} url
 * @returns {boolean}
 */
export const shouldProxy = (url) => {
    if (!url || typeof url !== 'string') return false;

    const lower = url.toLowerCase();
    if (lower.startsWith('blob:') || lower.startsWith('data:') || lower.startsWith('about:')) return false;
    if (url.startsWith(PROXY_BASE_URL) || url.startsWith(AUDIO_PROXY_BASE_URL)) return false;
    if (url.includes('/api/decrypt-stream')) return false;

    let parsed;
    try {
        parsed = new URL(url, getLocationHref());
    } catch {
        return false; // unparseable / relative without a base -> leave alone
    }

    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;
    if (parsed.origin && parsed.origin === getLocationOrigin()) return false;

    const host = parsed.hostname.toLowerCase();
    if (DIRECT_HOSTS.has(host)) return false;
    if (DIRECT_HOST_SUFFIXES.some((suffix) => host.endsWith(suffix))) return false;

    return true;
};

/**
 * Returns `url` rewritten to go through the VPS proxy, or `url` unchanged when
 * shouldProxy() says it should stay direct.
 * @param {string} url
 * @returns {string}
 */
export const toProxyUrl = (url) => (shouldProxy(url) ? `${PROXY_BASE_URL}${encodeURIComponent(url)}` : url);

// Kept for back-compat with callers/tests; audio segments are now handled by the
// generic path above.
export const isTidalAudioUrl = (url) => {
    if (!url || typeof url !== 'string') return false;
    try {
        const host = new URL(url).hostname.toLowerCase();
        return host === 'tidal.com' || host.endsWith('.tidal.com');
    } catch {
        return false;
    }
};

export const getProxyUrl = (url) => {
    if (!url) return url;
    return toProxyUrl(url);
};

export const wrapTidalUrl = (url) => {
    if (!url || typeof url !== 'string') return url;
    return url
        .replace('openapi.tidal.com', 'lol.samidy.workers.dev/openapi')
        .replace('api.tidal.com', 'lol.samidy.workers.dev/api')
        .replace('https://tidal.com', 'https://lol.samidy.workers.dev/tidal');
};

const readMethod = (input, init) => {
    const raw = init?.method || (input && typeof input === 'object' && 'method' in input ? input.method : null) || 'GET';
    return String(raw).toUpperCase();
};
const isRelayableMethod = (method) => method === 'GET' || method === 'HEAD';

let installed = false;

/**
 * Monkey-patches window.fetch and XMLHttpRequest.prototype.open so that GET/HEAD
 * requests to third-party hosts are transparently routed through the VPS proxy.
 * Safe to call more than once. No-op outside a browser.
 */
export function installGlobalProxy() {
    if (installed || typeof window === 'undefined') return;
    installed = true;

    const originalFetch = typeof window.fetch === 'function' ? window.fetch.bind(window) : null;
    if (originalFetch) {
        window.fetch = (input, init) => {
            try {
                if (isRelayableMethod(readMethod(input, init))) {
                    if (typeof input === 'string') {
                        if (shouldProxy(input)) return originalFetch(toProxyUrl(input), init);
                    } else if (typeof URL !== 'undefined' && input instanceof URL) {
                        if (shouldProxy(input.href)) return originalFetch(toProxyUrl(input.href), init);
                    } else if (typeof Request !== 'undefined' && input instanceof Request) {
                        if (shouldProxy(input.url)) return originalFetch(new Request(toProxyUrl(input.url), input), init);
                    }
                }
            } catch (error) {
                console.warn('[proxy] fetch rewrite skipped:', error);
            }
            return originalFetch(input, init);
        };
        window.fetch.__monoProxyWrapped = true;
    }

    const XHR = window.XMLHttpRequest;
    if (XHR && XHR.prototype && !XHR.prototype.__monoProxyOpen) {
        // eslint-disable-next-line @typescript-eslint/unbound-method
        const originalOpen = XHR.prototype.open;
        XHR.prototype.__monoProxyOpen = originalOpen;
        XHR.prototype.open = function open(method, url, ...rest) {
            try {
                if (isRelayableMethod(String(method || 'GET').toUpperCase()) && typeof url === 'string' && shouldProxy(url)) {
                    return originalOpen.call(this, method, toProxyUrl(url), ...rest);
                }
            } catch (error) {
                console.warn('[proxy] XHR rewrite skipped:', error);
            }
            return originalOpen.call(this, method, url, ...rest);
        };
    }
}
