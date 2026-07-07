// js/accounts/config.js
import PocketBase from 'pocketbase';

const DEFAULT_POCKETBASE_URL = 'https://pb.bitperfect.remotewire.net';

const getBaseURL = () => {
    return (
        window.__POCKETBASE_URL__ ||
        localStorage.getItem('monochrome-pocketbase-url') ||
        localStorage.getItem('monochrome-auth-url') ||
        DEFAULT_POCKETBASE_URL
    );
};

export const AUTH_BASE_URL = getBaseURL();
export const POCKETBASE_URL = AUTH_BASE_URL;

console.log('[PocketBase Config] Using URL:', POCKETBASE_URL);

export const pb = new PocketBase(POCKETBASE_URL);
pb.autoCancellation(false);

