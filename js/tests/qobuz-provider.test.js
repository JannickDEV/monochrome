import { describe, expect, test, vi, beforeEach } from 'vitest';
import { QobuzProvider } from '../services/qobuz/QobuzProvider.ts';
import { ProviderError } from '../services/types.ts';

describe('QobuzProvider', () => {
    let mockClient;
    let provider;

    beforeEach(() => {
        mockClient = {
            request: vi.fn(),
        };
        provider = new QobuzProvider(mockClient);
    });

    test('search calls client /search/ and normalizes items with q: prefix', async () => {
        mockClient.request.mockResolvedValueOnce({
            tracks: { items: [{ id: '100', title: 'Test Track', album: { id: '200' } }] },
            albums: { items: [{ id: '200', title: 'Test Album' }] },
            artists: { items: [{ id: '300', name: 'Test Artist' }] },
            playlists: { items: [] },
        });

        const res = await provider.search('test query', { limit: 10, offset: 0 });

        expect(mockClient.request).toHaveBeenCalledWith('/search/', { q: 'test query', limit: 10, offset: 0 });
        expect(res.tracks.items[0]).toEqual({
            id: 'q:100',
            title: 'Test Track',
            provider: 'qobuz',
            type: 'track',
            album: { id: 'q:200', cover: undefined, image: undefined },
        });
        expect(res.albums.items[0].id).toBe('q:200');
        expect(res.artists.items[0].id).toBe('q:300');
    });

    test('getTrack strips q: prefix before requesting client /track/', async () => {
        mockClient.request.mockResolvedValueOnce({
            id: '12345',
            title: 'Clean Track',
            duration: 210,
        });

        const res = await provider.getTrack('q:12345');

        expect(mockClient.request).toHaveBeenCalledWith('/track/', { id: '12345' });
        expect(res.id).toBe('q:12345');
        expect(res.provider).toBe('qobuz');
    });

    test('getStreamUrl maps quality tokens correctly and returns StreamInfo', async () => {
        mockClient.request.mockResolvedValueOnce({
            url: 'https://stream.qobuz.com/audio.flac',
            format_id: 27,
        });

        const res = await provider.getStreamUrl('q:999', 'HI_RES_LOSSLESS');

        expect(mockClient.request).toHaveBeenCalledWith('/trackManifests/', {
            id: '999',
            format_id: '27',
            intent: 'stream',
        });
        expect(res).toEqual({
            url: 'https://stream.qobuz.com/audio.flac',
            provider: 'qobuz',
            quality: 'HI_RES_LOSSLESS',
            rgInfo: null,
        });
    });

    test('getStreamUrl maps LOSSLESS to format_id 6', async () => {
        mockClient.request.mockResolvedValueOnce({ url: 'https://stream.qobuz.com/lossless.flac' });

        await provider.getStreamUrl('100', 'LOSSLESS');

        expect(mockClient.request).toHaveBeenCalledWith('/trackManifests/', {
            id: '100',
            format_id: '6',
            intent: 'stream',
        });
    });

    test('getTrackForDownload calls /track/getFileUrl with correct format_id', async () => {
        mockClient.request.mockResolvedValueOnce({ url: 'https://stream.qobuz.com/download.flac' });

        const res = await provider.getTrackForDownload('100', 'HI_RES');

        expect(mockClient.request).toHaveBeenCalledWith('/track/getFileUrl', {
            track_id: '100',
            id: '100',
            format_id: '7',
            intent: 'stream',
        });
        expect(res).toEqual({
            url: 'https://stream.qobuz.com/download.flac',
            provider: 'qobuz',
            quality: 'HI_RES',
            rgInfo: null,
        });
    });

    test('getCoverUrl and getCoverSrcset return correct Qobuz image URLs without q: prefix', () => {
        expect(provider.getCoverUrl('q:cover_123', '600')).toBe('https://static.qobuz.com/images/covers/cover_123_600.jpg');
        expect(provider.getCoverSrcset('q:cover_123')).toBe(
            'https://static.qobuz.com/images/covers/cover_123_300.jpg 300w, https://static.qobuz.com/images/covers/cover_123_600.jpg 600w'
        );
    });

    test('getArtistPictureUrl and getArtistPictureSrcset return correct Qobuz artist URLs without q: prefix', () => {
        expect(provider.getArtistPictureUrl('q:art_456', '600')).toBe(
            'https://static.qobuz.com/images/artists/art_456_600.jpg'
        );
        expect(provider.getArtistPictureSrcset('q:art_456')).toBe(
            'https://static.qobuz.com/images/artists/art_456_300.jpg 300w, https://static.qobuz.com/images/artists/art_456_600.jpg 600w'
        );
    });

    test('wraps client errors in ProviderError', async () => {
        mockClient.request.mockRejectedValue(new Error('Network error'));

        await expect(provider.getTrack('123')).rejects.toThrow(ProviderError);
        await expect(provider.getTrack('123')).rejects.toThrow('Network error');
    });
});
