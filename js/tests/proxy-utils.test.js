import { describe, expect, test } from 'vitest';
import { getProxyUrl, isTidalAudioUrl, shouldProxy, toProxyUrl, wrapTidalUrl, PROXY_BASE_URL } from '../proxy-utils.js';

const proxied = (url) => `${PROXY_BASE_URL}${encodeURIComponent(url)}`;

describe('proxy-utils', () => {
    test('routes third-party URLs through the VPS proxy', () => {
        const audio = 'https://sp-pr-fa.audio.tidal.com/mediatracks/abc/1.mp4?token=a/b+c==';
        expect(getProxyUrl(audio)).toBe(proxied(audio));

        expect(getProxyUrl('https://api.tidal.com/v1/tracks/1')).toBe(proxied('https://api.tidal.com/v1/tracks/1'));
        expect(getProxyUrl('https://resources.tidal.com/images/cover.jpg')).toBe(
            proxied('https://resources.tidal.com/images/cover.jpg')
        );
        expect(getProxyUrl('https://cdn.example.com/audio/1.mp4')).toBe(proxied('https://cdn.example.com/audio/1.mp4'));
        expect(getProxyUrl('https://lol.samidy.workers.dev/api/v1/tracks/1')).toBe(
            proxied('https://lol.samidy.workers.dev/api/v1/tracks/1')
        );
    });

    test('leaves our own infrastructure direct', () => {
        for (const url of [
            'https://hf-core.bitperfect.dedyn.io/track/1',
            'https://qz-api.bitperfect.dedyn.io/get-music',
            'https://audio.bitperfect.dedyn.io/proxy-audio/?url=x',
            'https://audio.bitperfect.dedyn.io/proxy/?url=x',
            'https://pb-data.bitperfect.dedyn.io/api/collections/users/records',
        ]) {
            expect(shouldProxy(url)).toBe(false);
            expect(getProxyUrl(url)).toBe(url);
        }
    });

    test('leaves relative, blob/data, and exempt hosts direct', () => {
        expect(getProxyUrl('/sc-api/search')).toBe('/sc-api/search');
        expect(getProxyUrl('blob:https://example.com/uuid')).toBe('blob:https://example.com/uuid');
        expect(getProxyUrl('data:audio/mp4;base64,AAAA')).toBe('data:audio/mp4;base64,AAAA');
        expect(getProxyUrl('https://challenges.cloudflare.com/turnstile/v0/api.js')).toBe(
            'https://challenges.cloudflare.com/turnstile/v0/api.js'
        );
        expect(shouldProxy('https://o123.ingest.sentry.io/api/456/envelope/')).toBe(false);
    });

    test('leaves Qobuz signed stream URLs direct', () => {
        const q = 'https://streaming-qobuz-std.akamaized.net/file?eid=1&fmt=27&hierarchy=1&sig=abc&t=123';
        expect(shouldProxy(q)).toBe(false);
        expect(getProxyUrl(q)).toBe(q);
        expect(shouldProxy('https://streaming-qobuz-web.akamaized.net/x')).toBe(false);
        // a non-Qobuz akamaized host is still proxied
        expect(shouldProxy('https://example.akamaized.net/x')).toBe(true);
    });

    test('does not double-wrap an already-proxied URL', () => {
        const once = toProxyUrl('https://cdn.example.com/a.mp4');
        expect(toProxyUrl(once)).toBe(once);
    });

    test('isTidalAudioUrl still recognises TIDAL hosts', () => {
        expect(isTidalAudioUrl('https://sp-pr-fa.audio.tidal.com/x/1.mp4')).toBe(true);
        expect(isTidalAudioUrl('https://cdn.example.com/x/1.mp4')).toBe(false);
    });

    test('routes TIDAL API and web requests through the Samidy worker', () => {
        expect(wrapTidalUrl('https://openapi.tidal.com/v2/albums/1')).toBe(
            'https://lol.samidy.workers.dev/openapi/v2/albums/1'
        );
        expect(wrapTidalUrl('https://api.tidal.com/v1/tracks/1')).toBe('https://lol.samidy.workers.dev/api/v1/tracks/1');
        expect(wrapTidalUrl('https://tidal.com/browse/mix/1')).toBe('https://lol.samidy.workers.dev/tidal/browse/mix/1');
    });
});
