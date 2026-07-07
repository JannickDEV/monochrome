import { describe, expect, test, vi, beforeEach } from 'vitest';

const { SoundCloudAPI } = await import('../soundcloud-api.js');

describe('SoundCloudAPI', () => {
    let api;

    beforeEach(() => {
        api = new SoundCloudAPI();
        localStorage.clear();
        vi.restoreAllMocks();
    });

    test('getClientId returns cached ID or falls back to known working ID', async () => {
        localStorage.setItem('sc_client_id', '12345678901234567890123456789012');
        const id = await api.getClientId();
        expect(id).toBe('12345678901234567890123456789012');
    });

    test('rotateClientId rotates to next fallback client ID and updates localStorage', async () => {
        const id1 = await api.getClientId();
        const id2 = api.rotateClientId();
        expect(id1).not.toBe(id2);
        expect(localStorage.getItem('sc_client_id')).toBe(id2);
    });

    test('transformSoundCloudTrack formats raw SoundCloud JSON into Monochrome Track structure', () => {
        const rawTrack = {
            id: 998877,
            title: 'Test Remix',
            duration: 215000,
            artwork_url: 'https://i1.sndcdn.com/artworks-large.jpg',
            user: {
                id: 5544,
                username: 'DJ Monochrome',
                avatar_url: 'https://i1.sndcdn.com/avatar.jpg',
            },
            permalink_url: 'https://soundcloud.com/dj-monochrome/test-remix',
        };

        const track = api.transformSoundCloudTrack(rawTrack);

        expect(track.id).toBe('sc_998877');
        expect(track.title).toBe('Test Remix');
        expect(track.artist.name).toBe('DJ Monochrome');
        expect(track.artists[0].name).toBe('DJ Monochrome');
        expect(track.album.title).toBe('Test Remix');
        expect(track.album.cover).toBe('https://i1.sndcdn.com/artworks-t500x500.jpg');
        expect(track.duration).toBe(215);
        expect(track.provider).toBe('soundcloud');
        expect(track.isSoundCloud).toBe(true);
    });

    test('getStreamUrl resolves progressive HTTP stream from transcodings', async () => {
        vi.spyOn(globalThis, 'fetch')
            .mockResolvedValueOnce({
                ok: true,
                json: async () => ({
                    id: 998877,
                    media: {
                        transcodings: [
                            {
                                url: 'https://api-v2.soundcloud.com/media/transcoding1',
                                format: { protocol: 'hls', mime_type: 'audio/mpeg' },
                            },
                            {
                                url: 'https://api-v2.soundcloud.com/media/transcoding2',
                                format: { protocol: 'progressive', mime_type: 'audio/mpeg' },
                            },
                        ],
                    },
                }),
            })
            .mockResolvedValueOnce({
                ok: true,
                json: async () => ({
                    url: 'https://cf-media.sndcdn.com/stream.mp3',
                }),
            });

        const res = await api.getStreamUrl('sc_998877');
        expect(res.url).toBe('https://cf-media.sndcdn.com/stream.mp3');
        expect(res.provider).toBe('soundcloud');
        expect(res.protocol).toBe('progressive');
    });
});
