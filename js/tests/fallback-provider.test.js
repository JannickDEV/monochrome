import { describe, expect, test, vi, beforeEach } from 'vitest';
import { FallbackProvider } from '../services/fallback/FallbackProvider.ts';
import { ProviderError } from '../services/types.ts';

describe('FallbackProvider', () => {
    let qobuzMock;
    let tidalMock;
    let fallback;

    beforeEach(() => {
        qobuzMock = {
            id: 'qobuz',
            name: 'Qobuz',
            search: vi.fn(),
            getTrack: vi.fn(),
            getStreamUrl: vi.fn(),
            getCoverUrl: vi.fn((id, size) => `https://qobuz.img/${id}/${size}`),
        };
        tidalMock = {
            id: 'tidal',
            name: 'TIDAL',
            search: vi.fn(),
            getTrack: vi.fn(),
            getStreamUrl: vi.fn(),
            getCoverUrl: vi.fn((id, size) => `https://tidal.img/${id}/${size}`),
        };
        fallback = new FallbackProvider([qobuzMock, tidalMock]);
    });

    test('returns first successful result without calling subsequent providers', async () => {
        qobuzMock.getStreamUrl.mockResolvedValueOnce({
            url: 'https://qobuz.stream/1.flac',
            provider: 'qobuz',
            quality: 'LOSSLESS',
        });

        const res = await fallback.getStreamUrl('q:123', 'LOSSLESS');

        expect(res.url).toBe('https://qobuz.stream/1.flac');
        expect(qobuzMock.getStreamUrl).toHaveBeenCalledWith('q:123', 'LOSSLESS');
        expect(tidalMock.getStreamUrl).not.toHaveBeenCalled();
    });

    test('falls back to second provider when first provider throws an error', async () => {
        qobuzMock.getStreamUrl.mockRejectedValueOnce(new Error('Stream unavailable'));
        tidalMock.getStreamUrl.mockResolvedValueOnce({
            url: 'https://tidal.stream/1.flac',
            provider: 'tidal',
            quality: 'LOSSLESS',
        });

        const res = await fallback.getStreamUrl('123', 'LOSSLESS');

        expect(res.url).toBe('https://tidal.stream/1.flac');
        expect(qobuzMock.getStreamUrl).toHaveBeenCalledTimes(1);
        expect(tidalMock.getStreamUrl).toHaveBeenCalledTimes(1);
    });

    test('falls back to second provider when first provider returns empty search results', async () => {
        qobuzMock.search.mockResolvedValueOnce({
            tracks: { items: [] },
            albums: { items: [] },
            artists: { items: [] },
            playlists: { items: [] },
        });
        tidalMock.search.mockResolvedValueOnce({
            tracks: { items: [{ id: 't:999', title: 'Tidal Track' }] },
            albums: { items: [] },
            artists: { items: [] },
            playlists: { items: [] },
        });

        const res = await fallback.search('test query');

        expect(res.tracks.items[0].title).toBe('Tidal Track');
        expect(qobuzMock.search).toHaveBeenCalledTimes(1);
        expect(tidalMock.search).toHaveBeenCalledTimes(1);
    });

    test('throws ProviderError when all providers fail', async () => {
        qobuzMock.getTrack.mockRejectedValueOnce(new Error('Qobuz 404'));
        tidalMock.getTrack.mockRejectedValueOnce(new Error('Tidal 404'));

        await expect(fallback.getTrack('999')).rejects.toThrow(ProviderError);
        await expect(fallback.getTrack('999')).rejects.toThrow('All providers failed for getTrack');
    });

    test('getCoverUrl routes to appropriate provider based on ID prefix or pattern', () => {
        expect(fallback.getCoverUrl('q:cover_1', '600')).toBe('https://qobuz.img/q:cover_1/600');
        expect(fallback.getCoverUrl('t:cover_2', '600')).toBe('https://tidal.img/t:cover_2/600');
        expect(fallback.getCoverUrl('1234-5678-uuid', '600')).toBe('https://tidal.img/1234-5678-uuid/600');
        expect(fallback.getCoverUrl('unknown_id', '600')).toBe('https://qobuz.img/unknown_id/600');
    });
});
