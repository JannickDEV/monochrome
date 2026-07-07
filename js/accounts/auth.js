// js/accounts/auth.js
import { pb, AUTH_BASE_URL } from './config.js';

const LEGACY_AUTH_TOKEN_KEY = 'monochrome-auth-token';
let authToken = localStorage.getItem(LEGACY_AUTH_TOKEN_KEY) || pb.authStore.token || '';

function normalizeUser(user) {
    if (!user) return null;
    return { ...user, $id: user.id || user.$id };
}

export function getAuthToken() {
    return pb.authStore.token || authToken;
}

function storeAuthToken(token) {
    authToken = token || '';
    if (authToken) localStorage.setItem(LEGACY_AUTH_TOKEN_KEY, authToken);
    else localStorage.removeItem(LEGACY_AUTH_TOKEN_KEY);
}

function clearAuthToken() {
    authToken = '';
    localStorage.removeItem(LEGACY_AUTH_TOKEN_KEY);
}

export class AuthManager {
    constructor() {
        this.user = normalizeUser(pb.authStore.record);
        this.authListeners = [];
        
        pb.authStore.onChange((token, record) => {
            storeAuthToken(token);
            this.user = normalizeUser(record);
            this.updateUI(this.user);
            this.authListeners.forEach((listener) => listener(this.user));
        });

        this.init().catch(console.error);
    }

    async init() {
        await this.refreshAuthState();
    }

    setUser(user) {
        this.user = normalizeUser(user);
        this.updateUI(this.user);
        this.authListeners.forEach((listener) => listener(this.user));
    }

    async refreshAuthState() {
        if (!pb.authStore.isValid) {
            this.setUser(null);
            return;
        }
        try {
            const authData = await pb.collection('users').authRefresh();
            this.setUser(authData.record);
        } catch (error) {
            console.warn('[PocketBase Auth] Token refresh failed:', error);
            pb.authStore.clear();
            this.setUser(null);
        }
    }

    onAuthStateChanged(callback) {
        this.authListeners.push(callback);
        if (this.user !== null) {
            callback(this.user);
        }
    }

    async _signInSocial(provider) {
        try {
            const authData = await pb.collection('users').authWithOAuth2({ provider });
            this.setUser(authData.record);
            return this.user;
        } catch (error) {
            console.error(`[PocketBase Auth] ${provider} login failed:`, error);
            if (!error?.isAbort) {
                alert(`Login failed: ${error.message || error}`);
            }
        }
    }

    async signInWithGoogle() {
        return this._signInSocial('google');
    }
    async signInWithGitHub() {
        return this._signInSocial('github');
    }
    async signInWithDiscord() {
        return this._signInSocial('discord');
    }

    async signInWithEmail(email, password) {
        try {
            const authData = await pb.collection('users').authWithPassword(email, password);
            this.setUser(authData.record);
            return this.user;
        } catch (error) {
            console.error('[PocketBase Auth] Email login failed:', error);
            alert(`Login failed: ${error.message || 'Invalid email or password'}`);
            throw error;
        }
    }

    async signUpWithEmail(email, password) {
        try {
            const name = email.split('@')[0];
            await pb.collection('users').create({
                email,
                password,
                passwordConfirm: password,
                name,
            });
            return await this.signInWithEmail(email, password);
        } catch (error) {
            console.error('[PocketBase Auth] Sign up failed:', error);
            alert(`Sign Up failed: ${error.message || 'Error creating account'}`);
            throw error;
        }
    }

    async sendPasswordReset(email) {
        try {
            await pb.collection('users').requestPasswordReset(email);
            alert(`Password reset email sent to ${email}`);
        } catch (error) {
            console.error('[PocketBase Auth] Password reset request failed:', error);
            alert(`Failed to send reset email: ${error.message || error}`);
            throw error;
        }
    }

    async resetPassword(token, password, confirmPassword) {
        if (password !== confirmPassword) {
            throw new Error('Passwords do not match');
        }
        try {
            await pb.collection('users').confirmPasswordReset(token, password, confirmPassword);
        } catch (error) {
            console.error('[PocketBase Auth] Password reset confirmation failed:', error);
            throw error;
        }
    }

    async signOut() {
        try {
            pb.authStore.clear();
        } catch (error) {
            console.error('[PocketBase Auth] Sign out error:', error);
        } finally {
            clearAuthToken();
            this.user = null;
            this.updateUI(null);
            this.authListeners.forEach((listener) => listener(null));

            if (window.__AUTH_GATE__) {
                window.location.href = '/login';
            } else {
                window.location.reload();
            }
        }
    }

    updateUI(user) {
        const connectBtn = document.getElementById('auth-connect-btn');
        const clearDataBtn = document.getElementById('auth-clear-cloud-btn');
        const statusText = document.getElementById('auth-status');
        const emailContainer = document.getElementById('email-auth-container');
        const emailToggleBtn = document.getElementById('toggle-email-auth-btn');
        const githubBtn = document.getElementById('auth-github-btn');
        const discordBtn = document.getElementById('auth-discord-btn');

        if (!connectBtn) return;

        if (window.__AUTH_GATE__) {
            connectBtn.textContent = 'Sign Out';
            connectBtn.classList.add('danger');
            connectBtn.onclick = () => this.signOut();
            if (clearDataBtn) clearDataBtn.style.display = 'none';
            if (emailContainer) emailContainer.style.display = 'none';
            if (emailToggleBtn) emailToggleBtn.style.display = 'none';
            if (githubBtn) githubBtn.style.display = 'none';
            if (discordBtn) discordBtn.style.display = 'none';
            if (statusText) statusText.textContent = user ? `Signed in as ${user.email}` : 'Signed in';

            const accountPage = document.getElementById('page-account');
            if (accountPage) {
                const title = accountPage.querySelector('.section-title');
                if (title) title.textContent = 'Account';
                accountPage.querySelectorAll('.account-content > p, .account-content > div').forEach((el) => {
                    if (el.id !== 'auth-status' && el.id !== 'auth-buttons-container') {
                        el.style.display = 'none';
                    }
                });
            }

            const customDbBtn = document.getElementById('custom-db-btn');
            if (customDbBtn) {
                const pbFromEnv = !!window.__POCKETBASE_URL__;
                if (pbFromEnv) {
                    const settingItem = customDbBtn.closest('.setting-item');
                    if (settingItem) settingItem.style.display = 'none';
                }
            }

            return;
        }

        if (user) {
            connectBtn.textContent = 'Sign Out';
            connectBtn.classList.add('danger');
            connectBtn.onclick = () => this.signOut();

            if (clearDataBtn) clearDataBtn.style.display = 'block';
            if (emailContainer) emailContainer.style.display = 'none';
            if (emailToggleBtn) emailToggleBtn.style.display = 'none';
            if (githubBtn) githubBtn.style.display = 'none';
            if (discordBtn) discordBtn.style.display = 'none';
            if (statusText) statusText.textContent = `Signed in as ${user.email}`;
        } else {
            connectBtn.textContent = 'Connect with Google';
            connectBtn.classList.remove('danger');
            connectBtn.onclick = () => this.signInWithGoogle();

            if (clearDataBtn) clearDataBtn.style.display = 'none';
            if (emailToggleBtn) emailToggleBtn.style.display = 'inline-block';
            if (githubBtn) {
                githubBtn.style.display = 'inline-block';
                githubBtn.onclick = () => this.signInWithGitHub();
            }
            if (discordBtn) {
                discordBtn.style.display = 'inline-block';
                discordBtn.onclick = () => this.signInWithDiscord();
            }
            if (statusText) statusText.textContent = 'Sync your library across devices';
        }
    }
}

export const authManager = new AuthManager();
