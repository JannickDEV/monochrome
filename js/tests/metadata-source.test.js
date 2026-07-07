import { describe, expect, test, vi, beforeEach } from 'vitest';

const addMetadataWithTagLibMock = vi.fn(async (blob, data) => {
    return { blob, data };
});

const getMetadataWithTagLibMock = vi.fn();

vi.mock('../taglib.ts', () => ({
    addMetadataWithTagLib: (...args) => addMetadataWithTagLibMock(...args),
    getMetadataWithTagLib: (...args) => getMetadataWithTagLibMock(...args),
}));

vi.mock('../utils.js', () => ({
    getCoverBlob: vi.fn(),
    getTrackTitle: vi.fn((t) => t.title || 'Test Title'),
    getFullArtistString: vi.fn(() => 'Test Artist'),
    getFullArtistArray: vi.fn(() => ['Test Artist']),
    getMimeType: vi.fn(() => 'audio/flac'),
    getTrackCoverId: vi.fn(),
}));

vi.mock('../lyrics.js', () => ({
    LyricsManager: { instance: { fetchLyrics: vi.fn() } },
}));

vi.mock('../ModernSettings.js', () => ({
    modernSettings: { get: vi.fn(() => true) },
}));

const { addMetadataToAudio, readTrackMetadata } = await import('../metadata.js');

describe('Metadata Source Markers and Cleaning', () => {
    beforeEach(() => {
        addMetadataWithTagLibMock.mockClear();
        getMetadataWithTagLibMock.mockClear();
    });

    test('adds Qobuz marker to extra tags and omits raw TIDAL_DATA when provider is Qobuz', async () => {
        const fakeBlob = new Blob(['fake audio'], { type: 'audio/flac' });
        const track = {
            id: 12345,
            title: 'Test Song',
            provider: 'qobuz',
            album: { id: 67890, title: 'Test Album' },
        };

        await addMetadataToAudio(fakeBlob, track, {}, 'LOSSLESS');

        expect(addMetadataWithTagLibMock).toHaveBeenCalledTimes(1);
        const passedData = addMetadataWithTagLibMock.mock.calls[0][1];

        expect(passedData.extra.SOURCE).toBe('Qobuz');
        expect(passedData.extra.PROVIDER).toBe('Qobuz');
        expect(passedData.extra.TIDAL_DATA).toBeUndefined();
    });

    test('adds TIDAL marker to extra tags when provider is TIDAL or default', async () => {
        const fakeBlob = new Blob(['fake audio'], { type: 'audio/flac' });
        const track = {
            id: 12345,
            title: 'Test Song',
            provider: 'tidal',
        };

        await addMetadataToAudio(fakeBlob, track, {}, 'LOSSLESS');

        const passedData = addMetadataWithTagLibMock.mock.calls[0][1];
        expect(passedData.extra.SOURCE).toBe('TIDAL');
        expect(passedData.extra.PROVIDER).toBe('TIDAL');
        expect(passedData.extra.TIDAL_DATA).toBeUndefined();
    });

    test('adds SoundCloud marker to extra tags when provider is soundcloud', async () => {
        const fakeBlob = new Blob(['fake audio'], { type: 'audio/mpeg' });
        const track = {
            id: 'sc_998877',
            title: 'SoundCloud Remix',
            provider: 'soundcloud',
        };

        await addMetadataToAudio(fakeBlob, track, {}, 'HIGH');

        const passedData = addMetadataWithTagLibMock.mock.calls[addMetadataWithTagLibMock.mock.calls.length - 1][1];
        expect(passedData.extra.SOURCE).toBe('SoundCloud');
        expect(passedData.extra.PROVIDER).toBe('SoundCloud');
    });

    test('readTrackMetadata extracts SOURCE and PROVIDER into metadata object', async () => {
        const fakeBlob = new Blob(['fake audio'], { type: 'audio/flac' });
        getMetadataWithTagLibMock.mockResolvedValue({
            title: 'Test Song',
            artist: 'Test Artist',
            album: 'Test Album',
            duration: 180,
            extra: {
                SOURCE: 'Qobuz',
                PROVIDER: 'Qobuz',
            },
        });

        const metadata = await readTrackMetadata(fakeBlob);
        expect(metadata.source).toBe('Qobuz');
        expect(metadata.provider).toBe('Qobuz');
    });
});
