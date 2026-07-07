import { devModeSettings } from '../../storage.js';

class RequestQueue {
    private queue: Array<() => void> = [];
    private active = 0;
    private maxConcurrency: number;

    constructor(maxConcurrency = 2) {
        this.maxConcurrency = maxConcurrency;
    }

    async add<T>(fn: () => Promise<T>): Promise<T> {
        return new Promise<T>((resolve, reject) => {
            const task = async () => {
                try {
                    this.active++;
                    const res = await fn();
                    resolve(res);
                } catch (err) {
                    reject(err);
                } finally {
                    this.active--;
                    this.next();
                }
            };

            if (this.active < this.maxConcurrency) {
                task();
            } else {
                this.queue.push(task);
            }
        });
    }

    private next() {
        if (this.active < this.maxConcurrency && this.queue.length > 0) {
            const task = this.queue.shift();
            task?.();
        }
    }
}

export class QobuzClient {
    private queue: RequestQueue;
    private customUrl?: string;
    private customAppId?: string;
    private customToken?: string;
    private customUserId?: string;

    constructor(options: { url?: string; appId?: string; token?: string; userId?: string; maxConcurrency?: number } = {}) {
        this.queue = new RequestQueue(options.maxConcurrency ?? 2);
        this.customUrl = options.url;
        this.customAppId = options.appId;
        this.customToken = options.token;
        this.customUserId = options.userId;
    }

    getBaseUrl(): string {
        if (this.customUrl) return this.customUrl.replace(/\/+$/, '');
        if (typeof devModeSettings !== 'undefined' && typeof devModeSettings.getQobuzUrl === 'function') {
            return devModeSettings.getQobuzUrl().replace(/\/+$/, '');
        }
        return 'https://qz-api.bitperfect.dedyn.io';
    }

    getAppId(): string {
        if (this.customAppId) return this.customAppId;
        if (typeof devModeSettings !== 'undefined' && typeof devModeSettings.getQobuzAppId === 'function') {
            return devModeSettings.getQobuzAppId() || '';
        }
        return '';
    }

    getToken(): string {
        if (this.customToken !== undefined) return this.customToken;
        if (typeof devModeSettings !== 'undefined' && typeof devModeSettings.getQobuzToken === 'function') {
            return devModeSettings.getQobuzToken() || '';
        }
        return '';
    }

    getUserId(): string {
        if (this.customUserId !== undefined) return this.customUserId;
        if (typeof devModeSettings !== 'undefined' && typeof devModeSettings.getQobuzUserId === 'function') {
            return devModeSettings.getQobuzUserId() || '2759740';
        }
        return '2759740';
    }

    async fetchWithRetry(url: string, options: any = {}, maxRetries = 3): Promise<Response> {
        let delay = 500;
        for (let i = 0; i <= maxRetries; i++) {
            const response = await fetch(url, options);
            if (response.status === 429 || response.status >= 500) {
                if (i === maxRetries) return response;
                await new Promise((resolve) => setTimeout(resolve, delay));
                delay *= 2;
                continue;
            }
            return response;
        }
        throw new Error('Max retries exceeded');
    }

    async request(endpoint: string, params: Record<string, any> = {}): Promise<any> {
        return this.queue.add(async () => {
            const baseUrl = this.getBaseUrl();
            const appId = this.getAppId();
            const token = this.getToken();
            const userId = this.getUserId();

            const searchParams = new URLSearchParams();
            for (const [key, val] of Object.entries(params)) {
                if (val !== undefined && val !== null) {
                    searchParams.append(key, String(val));
                }
            }

            const queryString = searchParams.toString();
            const path = endpoint.startsWith('/') ? endpoint : '/' + endpoint;
            const url = `${baseUrl}${path}${queryString ? '?' + queryString : ''}`;

            const headers: Record<string, string> = {
                'Accept': 'application/json',
            };
            if (appId) headers['X-App-Id'] = appId;
            if (token) headers['X-User-Auth-Token'] = token;
            if (userId) headers['X-User-Id'] = userId;

            const response = await this.fetchWithRetry(url, { headers });
            const data = await response.json().catch(() => null);

            if (!response.ok) {
                const errMsg = data && (data.error || data.message || JSON.stringify(data));
                throw new Error(`Qobuz API Error (${response.status}): ${errMsg || response.statusText}`);
            }

            return data;
        });
    }
}
