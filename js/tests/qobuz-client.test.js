import { describe, expect, test, vi, beforeEach, afterEach } from 'vitest';
import { QobuzClient } from '../services/qobuz/QobuzClient.ts';

vi.mock('../storage.js', () => ({
    devModeSettings: {
        getQobuzUrl: vi.fn(() => 'https://mock-qobuz.example.com'),
        getQobuzAppId: vi.fn(() => 'mock-app-id'),
        getQobuzToken: vi.fn(() => 'mock-token'),
        getQobuzUserId: vi.fn(() => 'mock-user-id'),
    },
}));

describe('QobuzClient', () => {
    let client;
    let fetchMock;

    beforeEach(() => {
        client = new QobuzClient();
        fetchMock = vi.fn();
        vi.stubGlobal('fetch', fetchMock);
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    test('getBaseUrl, getAppId, getToken, and getUserId use devModeSettings when not overridden', () => {
        expect(client.getBaseUrl()).toBe('https://mock-qobuz.example.com');
        expect(client.getAppId()).toBe('mock-app-id');
        expect(client.getToken()).toBe('mock-token');
        expect(client.getUserId()).toBe('mock-user-id');
    });

    test('custom options override devModeSettings', () => {
        const customClient = new QobuzClient({
            url: 'https://custom.example.com/',
            appId: 'custom-app',
            token: 'custom-token',
            userId: 'custom-user',
        });

        expect(customClient.getBaseUrl()).toBe('https://custom.example.com');
        expect(customClient.getAppId()).toBe('custom-app');
        expect(customClient.getToken()).toBe('custom-token');
        expect(customClient.getUserId()).toBe('custom-user');
    });

    test('request constructs correct URL and headers', async () => {
        fetchMock.mockResolvedValueOnce({
            ok: true,
            status: 200,
            json: async () => ({ success: true, data: 'test' }),
        });

        const res = await client.request('/track/get', { id: 123, extra: 'foo' });

        expect(res).toEqual({ success: true, data: 'test' });
        expect(fetchMock).toHaveBeenCalledTimes(1);
        const [url, options] = fetchMock.mock.calls[0];
        expect(url).toBe('https://mock-qobuz.example.com/track/get?id=123&extra=foo');
        expect(options.headers).toEqual({
            'Accept': 'application/json',
            'X-App-Id': 'mock-app-id',
            'X-User-Auth-Token': 'mock-token',
            'X-User-Id': 'mock-user-id',
        });
    });

    test('fetchWithRetry retries on 429 and 500 errors', async () => {
        fetchMock
            .mockResolvedValueOnce({ status: 429, ok: false })
            .mockResolvedValueOnce({ status: 500, ok: false })
            .mockResolvedValueOnce({
                ok: true,
                status: 200,
                json: async () => ({ retried: true }),
            });

        const res = await client.request('/test');
        expect(res).toEqual({ retried: true });
        expect(fetchMock).toHaveBeenCalledTimes(3);
    });

    test('request throws formatted error when response is not ok', async () => {
        fetchMock.mockResolvedValueOnce({
            ok: false,
            status: 404,
            statusText: 'Not Found',
            json: async () => ({ error: 'Track not found on Qobuz' }),
        });

        await expect(client.request('/track/get', { id: 999 })).rejects.toThrow(
            'Qobuz API Error (404): Track not found on Qobuz'
        );
    });

    test('RequestQueue limits concurrency', async () => {
        const queueClient = new QobuzClient({ maxConcurrency: 1 });
        let activeCalls = 0;
        let maxActive = 0;

        fetchMock.mockImplementation(async () => {
            activeCalls++;
            if (activeCalls > maxActive) maxActive = activeCalls;
            await new Promise((resolve) => setTimeout(resolve, 50));
            activeCalls--;
            return {
                ok: true,
                status: 200,
                json: async () => ({ done: true }),
            };
        });

        await Promise.all([
            queueClient.request('/req1'),
            queueClient.request('/req2'),
            queueClient.request('/req3'),
        ]);

        expect(maxActive).toBe(1);
        expect(fetchMock).toHaveBeenCalledTimes(3);
    });
});
