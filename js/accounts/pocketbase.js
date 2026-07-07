// js/accounts/pocketbase.js
import { pb } from './config.js';
import { db } from '../db.js';
import { authManager } from './auth.js';

const syncManager = {
    pb: pb,
    _userRecordCache: null,
    _getUserRecordPromise: null,
    _isSyncing: false,

    async _getUserRecord(uid) {
        if (!pb.authStore.record) return null;
        const authRecord = pb.authStore.record;
        try {
            const profile = await pb.collection('profiles').getFirstListItem(`user="${authRecord.id}"`);
            return {
                id: authRecord.id,
                email: authRecord.email,
                username: profile.username || authRecord.email?.split('@')[0],
                display_name: profile.display_name || authRecord.name || '',
                avatar_url: profile.avatar_url || authRecord.avatar || ''
            };
        } catch (e) {
            return {
                id: authRecord.id,
                email: authRecord.email,
                username: authRecord.email?.split('@')[0] || `user_${authRecord.id.slice(0, 8)}`,
                display_name: authRecord.name || '',
                avatar_url: authRecord.avatar || ''
            };
        }
    },

    async getUserData() {
        const uid = authManager.user?.id || authManager.user?.$id || pb.authStore.record?.id;
        if (!uid) return null;

        try {
            // 1. Fetch profile
            let profileRecord = null;
            try {
                profileRecord = await pb.collection('profiles').getFirstListItem(`user="${uid}"`);
            } catch (err) {
                if (err?.status === 404 || err?.response?.status === 404) {
                    profileRecord = await pb.collection('profiles').create({
                        user: uid,
                        username: authManager.user?.email?.split('@')[0] || `user_${uid.slice(0, 8)}`,
                        display_name: authManager.user?.name || '',
                        privacy_playlists: true,
                        privacy_lastfm: true,
                    });
                }
            }

            const profile = profileRecord ? {
                username: profileRecord.username,
                display_name: profileRecord.display_name,
                avatar_url: profileRecord.avatar_url,
                banner: profileRecord.banner_url,
                status: profileRecord.status,
                about: profileRecord.about,
                website: profileRecord.website,
                privacy: {
                    playlists: profileRecord.privacy_playlists ? 'public' : 'private',
                    lastfm: profileRecord.privacy_lastfm ? 'public' : 'private',
                },
                lastfm_username: profileRecord.lastfm_username,
                favorite_albums: [],
            } : null;

            // 2. Fetch library items
            const libraryItems = await pb.collection('library_items').getFullList({ filter: `owner="${uid}"` });
            const library = { tracks: {}, albums: {}, artists: {}, playlists: {}, mixes: {} };
            for (const item of libraryItems) {
                const type = item.item_type;
                const pluralType = type === 'mix' ? 'mixes' : `${type}s`;
                if (library[pluralType] && item.metadata) {
                    library[pluralType][item.item_id] = item.metadata;
                }
            }

            // 3. Fetch history items
            const historyItems = await pb.collection('history_items').getFullList({ filter: `owner="${uid}"`, sort: '-played_at', limit: 100 });
            const history = historyItems.map(h => h.metadata || {});

            // 4. Fetch playlists & tracks
            const playlists = await pb.collection('playlists').getFullList({ filter: `owner="${uid}"` });
            const userPlaylists = {};
            for (const pl of playlists) {
                let tracks = [];
                try {
                    tracks = await pb.collection('playlist_tracks').getFullList({ filter: `playlist="${pl.id}"`, sort: 'position' });
                } catch (e) { /* ignore */ }
                userPlaylists[pl.client_id || pl.id] = {
                    id: pl.client_id || pl.id,
                    serverId: pl.id,
                    name: pl.name,
                    description: pl.description || '',
                    cover: pl.cover_url || null,
                    isPublic: pl.is_public || false,
                    tracks: tracks.map(t => t.metadata || {}),
                    createdAt: Date.parse(pl.created) || Date.now(),
                    updatedAt: Date.parse(pl.updated) || Date.now(),
                    numberOfTracks: tracks.length,
                };
            }

            // 5. Fetch folders & folder playlists
            const folders = await pb.collection('folders').getFullList({ filter: `owner="${uid}"` });
            const userFolders = {};
            for (const f of folders) {
                let fpList = [];
                try {
                    fpList = await pb.collection('folder_playlists').getFullList({ filter: `folder="${f.id}"`, sort: 'position', expand: 'playlist' });
                } catch (e) { /* ignore */ }
                const plIds = fpList.map(fp => fp.expand?.playlist?.client_id || fp.expand?.playlist?.id).filter(Boolean);
                userFolders[f.client_id || f.id] = {
                    id: f.client_id || f.id,
                    name: f.name,
                    cover: f.cover_url || null,
                    playlists: plIds,
                    createdAt: Date.parse(f.created) || Date.now(),
                    updatedAt: Date.parse(f.updated) || Date.now(),
                };
            }

            return { library, history, userPlaylists, userFolders, profile };
        } catch (error) {
            console.error('[PocketBase Sync] getUserData failed:', error);
            return null;
        }
    },

    safeParseInternal(str, _fieldName, fallback) {
        if (!str) return fallback;
        if (typeof str !== 'string') return str;
        try {
            return JSON.parse(str);
        } catch {
            return fallback;
        }
    },

    _recordTimestamp(value) {
        const parsed = Number(value || 0);
        if (Number.isFinite(parsed) && parsed > 0) return parsed;
        const date = Date.parse(value || '');
        return Number.isFinite(date) ? date : 0;
    },

    _dedupeRecordMap(records, _type) {
        const source = records && typeof records === 'object' && !Array.isArray(records) ? records : {};
        const byIdentity = new Map();

        for (const [key, value] of Object.entries(source)) {
            if (!value || typeof value !== 'object') continue;
            const record = { ...value, id: value.id || key };
            const identity = record.canonicalId ? `canonical:${record.canonicalId}` : `id:${record.id}`;
            const existing = byIdentity.get(identity);
            const recordTime = this._recordTimestamp(
                record.updatedAt || record.updated || record.createdAt || record.created
            );
            const existingTime = existing
                ? this._recordTimestamp(
                      existing.updatedAt || existing.updated || existing.createdAt || existing.created
                  )
                : -1;
            if (!existing || recordTime >= existingTime) {
                byIdentity.set(identity, record);
            }
        }

        const deduped = {};
        for (const record of byIdentity.values()) {
            if (record.id) deduped[record.id] = record;
        }
        return deduped;
    },

    async syncLibraryItem(type, item, added) {
        const uid = authManager.user?.id || authManager.user?.$id || pb.authStore.record?.id;
        if (!uid || !item) return;

        const metadata = this._minifyItem(type, item);
        const item_id = String(type === 'playlist' ? (item.uuid || item.id) : item.id);

        if (added) {
            try {
                const existing = await pb.collection('library_items').getFirstListItem(`owner="${uid}" && item_type="${type}" && item_id="${item_id}"`);
                await pb.collection('library_items').update(existing.id, { metadata });
            } catch (err) {
                if (err?.status === 404 || err?.response?.status === 404) {
                    try {
                        await pb.collection('library_items').create({
                            owner: uid,
                            item_type: type,
                            item_id: item_id,
                            metadata: metadata,
                            added_at: new Date().toISOString(),
                        });
                    } catch (createErr) {
                        console.warn('[PocketBase Sync] Failed to create library item:', createErr);
                    }
                }
            }
        } else {
            try {
                const existing = await pb.collection('library_items').getFirstListItem(`owner="${uid}" && item_type="${type}" && item_id="${item_id}"`);
                await pb.collection('library_items').delete(existing.id);
            } catch (err) {
                // Not found or already deleted
            }
        }
    },

    _minifyItem(type, item) {
        if (!item) return item;
        const base = {
            id: item.id,
            addedAt: item.addedAt || Date.now(),
        };

        if (type === 'track') {
            return {
                ...base,
                title: item.title || null,
                duration: item.duration || null,
                explicit: item.explicit || false,
                artist: item.artist || (item.artists && item.artists.length > 0 ? item.artists[0] : null) || null,
                artists: item.artists?.map((a) => ({ id: a.id, name: a.name || null })) || [],
                album: item.album
                    ? {
                          id: item.album.id,
                          title: item.album.title || null,
                          cover: item.album.cover || null,
                          releaseDate: item.album.releaseDate || null,
                          vibrantColor: item.album.vibrantColor || null,
                          artist: item.album.artist || null,
                          numberOfTracks: item.album.numberOfTracks || null,
                      }
                    : null,
            };
        }
        if (type === 'video') {
            return {
                ...base,
                type: 'video',
                title: item.title || null,
                duration: item.duration || null,
                image: item.image || item.cover || null,
                artist: item.artist || (item.artists && item.artists.length > 0 ? item.artists[0] : null) || null,
                artists: item.artists?.map((a) => ({ id: a.id, name: a.name || null })) || [],
                album: item.album || { title: 'Video', cover: item.image || item.cover },
            };
        }
        if (type === 'album') {
            return {
                ...base,
                title: item.title || null,
                cover: item.cover || null,
                releaseDate: item.releaseDate || null,
                explicit: item.explicit || false,
                artist: item.artist
                    ? { name: item.artist.name || null, id: item.artist.id }
                    : item.artists?.[0]
                      ? { name: item.artists[0].name || null, id: item.artists[0].id }
                      : null,
            };
        }
        if (type === 'artist') {
            return {
                ...base,
                name: item.name || null,
                picture: item.picture || item.image || null,
            };
        }
        if (type === 'playlist') {
            return {
                uuid: item.uuid || item.id,
                addedAt: item.addedAt || Date.now(),
                title: item.title || item.name || null,
                image: item.image || item.squareImage || item.cover || null,
                numberOfTracks: item.numberOfTracks || (item.tracks ? item.tracks.length : 0),
            };
        }
        return item;
    },

    async syncHistoryItem(historyEntry) {
        const uid = authManager.user?.id || authManager.user?.$id || pb.authStore.record?.id;
        if (!uid || !historyEntry) return;

        const item_id = String(historyEntry.id || '');
        try {
            await pb.collection('history_items').create({
                owner: uid,
                item_type: historyEntry.type || 'track',
                item_id: item_id,
                metadata: historyEntry,
                played_at: new Date(historyEntry.timestamp || Date.now()).toISOString(),
            });
        } catch (err) {
            console.error('[PocketBase Sync] Failed to sync history item:', err);
        }
    },

    async clearHistory() {
        const uid = authManager.user?.id || authManager.user?.$id || pb.authStore.record?.id;
        if (!uid) return;

        try {
            const items = await pb.collection('history_items').getFullList({ filter: `owner="${uid}"` });
            for (const item of items) {
                await pb.collection('history_items').delete(item.id);
            }
        } catch (err) {
            console.error('[PocketBase Sync] Failed to clear history:', err);
        }
    },

    async syncUserPlaylist(playlist, action) {
        const uid = authManager.user?.id || authManager.user?.$id || pb.authStore.record?.id;
        if (!uid || !playlist?.id) return;

        if (action === 'delete') {
            try {
                const existing = await pb.collection('playlists').getFirstListItem(`owner="${uid}" && client_id="${playlist.id}"`);
                await pb.collection('playlists').delete(existing.id);
            } catch (err) { /* ignore */ }
            return;
        }

        let playlistRecord = null;
        try {
            playlistRecord = await pb.collection('playlists').getFirstListItem(`owner="${uid}" && client_id="${playlist.id}"`);
            playlistRecord = await pb.collection('playlists').update(playlistRecord.id, {
                name: playlist.name || 'Untitled Playlist',
                description: playlist.description || '',
                cover_url: playlist.cover || '',
                is_public: playlist.isPublic || false,
            });
        } catch (err) {
            if (err?.status === 404 || err?.response?.status === 404) {
                try {
                    playlistRecord = await pb.collection('playlists').create({
                        owner: uid,
                        client_id: playlist.id,
                        name: playlist.name || 'Untitled Playlist',
                        description: playlist.description || '',
                        cover_url: playlist.cover || '',
                        is_public: playlist.isPublic || false,
                    });
                } catch (createErr) {
                    console.warn('[PocketBase Sync] Playlist create failed:', createErr);
                }
            }
        }

        if (playlistRecord && Array.isArray(playlist.tracks)) {
            try {
                const existingTracks = await pb.collection('playlist_tracks').getFullList({ filter: `playlist="${playlistRecord.id}"` });
                for (const tr of existingTracks) {
                    await pb.collection('playlist_tracks').delete(tr.id);
                }
            } catch (e) { /* ignore */ }

            for (let i = 0; i < playlist.tracks.length; i++) {
                const tr = playlist.tracks[i];
                const minified = this._minifyItem(tr.type || 'track', tr);
                try {
                    await pb.collection('playlist_tracks').create({
                        playlist: playlistRecord.id,
                        item_type: tr.type || 'track',
                        item_id: String(tr.id || ''),
                        metadata: minified,
                        position: i,
                    });
                } catch (e) {
                    console.warn('[PocketBase Sync] Playlist track add failed:', e);
                }
            }
        }
    },

    async syncUserFolder(folder, action) {
        const uid = authManager.user?.id || authManager.user?.$id || pb.authStore.record?.id;
        if (!uid || !folder?.id) return;

        if (action === 'delete') {
            try {
                const existing = await pb.collection('folders').getFirstListItem(`owner="${uid}" && client_id="${folder.id}"`);
                await pb.collection('folders').delete(existing.id);
            } catch (err) { /* ignore */ }
            return;
        }

        let folderRecord = null;
        try {
            folderRecord = await pb.collection('folders').getFirstListItem(`owner="${uid}" && client_id="${folder.id}"`);
            folderRecord = await pb.collection('folders').update(folderRecord.id, {
                name: folder.name || 'Untitled Folder',
                cover_url: folder.cover || '',
            });
        } catch (err) {
            if (err?.status === 404 || err?.response?.status === 404) {
                try {
                    folderRecord = await pb.collection('folders').create({
                        owner: uid,
                        client_id: folder.id,
                        name: folder.name || 'Untitled Folder',
                        cover_url: folder.cover || '',
                    });
                } catch (createErr) {
                    console.warn('[PocketBase Sync] Folder create failed:', createErr);
                }
            }
        }

        if (folderRecord && Array.isArray(folder.playlists)) {
            try {
                const existingFP = await pb.collection('folder_playlists').getFullList({ filter: `folder="${folderRecord.id}"` });
                for (const fp of existingFP) {
                    await pb.collection('folder_playlists').delete(fp.id);
                }
            } catch (e) { /* ignore */ }

            for (let i = 0; i < folder.playlists.length; i++) {
                const plId = folder.playlists[i];
                try {
                    const plRecord = await pb.collection('playlists').getFirstListItem(`owner="${uid}" && client_id="${plId}"`);
                    await pb.collection('folder_playlists').create({
                        folder: folderRecord.id,
                        playlist: plRecord.id,
                        position: i,
                    });
                } catch (e) {
                    console.warn('[PocketBase Sync] Folder playlist link failed:', e);
                }
            }
        }
    },

    async getPublicPlaylist(uuid) {
        try {
            let record = null;
            try {
                record = await pb.collection('playlists').getFirstListItem(`(client_id="${uuid}" || id="${uuid}") && is_public=true`);
            } catch (e) {
                if (e?.status === 404 || e?.response?.status === 404) return null;
                throw e;
            }
            if (!record) return null;

            const tracks = await pb.collection('playlist_tracks').getFullList({ filter: `playlist="${record.id}"`, sort: 'position' });
            const mappedTracks = tracks.map(t => t.metadata || {});
            const finalCover = record.cover_url || '';
            let images = [];

            if (!finalCover && mappedTracks.length > 0) {
                const uniqueCovers = [];
                const seenCovers = new Set();
                for (const tr of mappedTracks) {
                    const c = tr.album?.cover;
                    if (c && !seenCovers.has(c)) {
                        seenCovers.add(c);
                        uniqueCovers.push(c);
                        if (uniqueCovers.length >= 4) break;
                    }
                }
                images = uniqueCovers;
            }

            let profileName = 'Community User';
            try {
                const profile = await pb.collection('profiles').getFirstListItem(`user="${record.owner}"`);
                if (profile?.display_name || profile?.username) {
                    profileName = profile.display_name || profile.username;
                }
            } catch (e) { /* ignore */ }

            return {
                id: record.client_id || record.id,
                serverId: record.id,
                name: record.name || 'Untitled Playlist',
                title: record.name || 'Untitled Playlist',
                description: record.description || '',
                cover: finalCover,
                image: finalCover,
                tracks: mappedTracks,
                images: images,
                numberOfTracks: mappedTracks.length,
                type: 'user-playlist',
                isPublic: true,
                user: { name: profileName },
            };
        } catch (error) {
            console.error('Failed to fetch public playlist:', error);
            return null;
        }
    },

    async publishPlaylist(playlist) {
        if (!playlist || !playlist.id) return;
        await this.syncUserPlaylist({ ...playlist, isPublic: true });
    },

    async unpublishPlaylist(uuid) {
        const uid = authManager.user?.id || authManager.user?.$id || pb.authStore.record?.id;
        if (!uid || !uuid) return;
        try {
            const record = await pb.collection('playlists').getFirstListItem(`owner="${uid}" && client_id="${uuid}"`);
            await pb.collection('playlists').update(record.id, { is_public: false });
        } catch (e) { /* ignore */ }
    },

    async getProfile(username) {
        try {
            const record = await pb.collection('profiles').getFirstListItem(`username="${username}"`);
            return {
                ...record,
                banner: record.banner_url,
                privacy: {
                    playlists: record.privacy_playlists ? 'public' : 'private',
                    lastfm: record.privacy_lastfm ? 'public' : 'private',
                },
                user_playlists: {},
                favorite_albums: [],
            };
        } catch {
            return null;
        }
    },

    async updateProfile(data) {
        const uid = authManager.user?.id || authManager.user?.$id || pb.authStore.record?.id;
        if (!uid) return;
        try {
            const record = await pb.collection('profiles').getFirstListItem(`user="${uid}"`);
            const updateData = {};
            if ('display_name' in data) updateData.display_name = data.display_name;
            if ('username' in data) updateData.username = data.username;
            if ('avatar_url' in data) updateData.avatar_url = data.avatar_url;
            if ('banner' in data || 'banner_url' in data) updateData.banner_url = data.banner || data.banner_url;
            if ('status' in data) updateData.status = data.status;
            if ('about' in data) updateData.about = data.about;
            if ('website' in data) updateData.website = data.website;
            if ('lastfm_username' in data) updateData.lastfm_username = data.lastfm_username;
            if ('privacy' in data) {
                updateData.privacy_playlists = data.privacy.playlists === 'public' || data.privacy.playlists === true;
                updateData.privacy_lastfm = data.privacy.lastfm === 'public' || data.privacy.lastfm === true;
            }
            await pb.collection('profiles').update(record.id, updateData);
        } catch (err) {
            console.error('[PocketBase Sync] updateProfile failed:', err);
        }
    },

    async isUsernameTaken(username) {
        try {
            await pb.collection('profiles').getFirstListItem(`username="${username}"`);
            return true;
        } catch (error) {
            if (error?.status === 404 || error?.response?.status === 404) return false;
            throw error;
        }
    },

    async clearCloudData() {
        const uid = authManager.user?.id || authManager.user?.$id || pb.authStore.record?.id;
        if (!uid) return;

        try {
            const libItems = await pb.collection('library_items').getFullList({ filter: `owner="${uid}"` });
            for (const item of libItems) await pb.collection('library_items').delete(item.id);

            const histItems = await pb.collection('history_items').getFullList({ filter: `owner="${uid}"` });
            for (const item of histItems) await pb.collection('history_items').delete(item.id);

            const plItems = await pb.collection('playlists').getFullList({ filter: `owner="${uid}"` });
            for (const item of plItems) await pb.collection('playlists').delete(item.id);

            const foldItems = await pb.collection('folders').getFullList({ filter: `owner="${uid}"` });
            for (const item of foldItems) await pb.collection('folders').delete(item.id);

            alert('Cloud data cleared successfully.');
        } catch (error) {
            console.error('Failed to clear cloud data!', error);
            alert('Failed to clear cloud data! :( Check console for details.');
        }
    },

    async onAuthStateChanged(user) {
        if (user) {
            if (this._isSyncing) return;
            this._isSyncing = true;

            try {
                const cloudData = await this.getUserData();

                if (cloudData) {
                    let database = db;

                    const localData = {
                        tracks: (await database.getAll('favorites_tracks')) || [],
                        albums: (await database.getAll('favorites_albums')) || [],
                        artists: (await database.getAll('favorites_artists')) || [],
                        playlists: (await database.getAll('favorites_playlists')) || [],
                        mixes: (await database.getAll('favorites_mixes')) || [],
                        history: (await database.getAll('history_tracks')) || [],
                        userPlaylists: (await database.getAll('user_playlists')) || [],
                        userFolders: (await database.getAll('user_folders')) || [],
                    };

                    let { library, history, userPlaylists, userFolders } = cloudData;
                    let needsUpdate = false;

                    if (!library) library = {};
                    if (!library.tracks) library.tracks = {};
                    if (!library.albums) library.albums = {};
                    if (!library.artists) library.artists = {};
                    if (!library.playlists) library.playlists = {};
                    if (!library.mixes) library.mixes = {};
                    if (!userPlaylists) userPlaylists = {};
                    if (!userFolders) userFolders = {};
                    if (!history) history = [];
                    userPlaylists = this._dedupeRecordMap(userPlaylists, 'playlist');
                    userFolders = this._dedupeRecordMap(userFolders, 'folder');

                    const mergeItem = async (collection, item, type) => {
                        const id = type === 'playlist' ? item.uuid || item.id : item.id;
                        if (!collection[id]) {
                            collection[id] = this._minifyItem(type, item);
                            await this.syncLibraryItem(type, item, true);
                        }
                    };

                    for (const item of localData.tracks) await mergeItem(library.tracks, item, 'track');
                    for (const item of localData.albums) await mergeItem(library.albums, item, 'album');
                    for (const item of localData.artists) await mergeItem(library.artists, item, 'artist');
                    for (const item of localData.playlists) await mergeItem(library.playlists, item, 'playlist');
                    for (const item of localData.mixes) await mergeItem(library.mixes, item, 'mix');

                    for (const playlist of localData.userPlaylists) {
                        if (!userPlaylists[playlist.id]) {
                            await this.syncUserPlaylist(playlist, 'create');
                        }
                    }

                    for (const folder of localData.userFolders) {
                        if (!userFolders[folder.id]) {
                            await this.syncUserFolder(folder, 'create');
                        }
                    }

                    const convertedData = {
                        favorites_tracks: Object.values(library.tracks).filter((t) => t && typeof t === 'object'),
                        favorites_albums: Object.values(library.albums).filter((a) => a && typeof a === 'object'),
                        favorites_artists: Object.values(library.artists).filter((a) => a && typeof a === 'object'),
                        favorites_playlists: Object.values(library.playlists).filter((p) => p && typeof p === 'object'),
                        favorites_mixes: Object.values(library.mixes).filter((m) => m && typeof m === 'object'),
                        history_tracks: history,
                        user_playlists: Object.values(userPlaylists).filter((p) => p && typeof p === 'object'),
                        user_folders: Object.values(userFolders).filter((f) => f && typeof f === 'object'),
                    };

                    const hadLocalData =
                        localData.tracks.length > 0 ||
                        localData.albums.length > 0 ||
                        localData.artists.length > 0 ||
                        localData.playlists.length > 0 ||
                        localData.mixes.length > 0 ||
                        localData.history.length > 0 ||
                        localData.userPlaylists.length > 0 ||
                        localData.userFolders.length > 0;

                    const isConvertedEmpty =
                        convertedData.favorites_tracks.length === 0 &&
                        convertedData.favorites_albums.length === 0 &&
                        convertedData.favorites_artists.length === 0 &&
                        convertedData.favorites_playlists.length === 0 &&
                        convertedData.favorites_mixes.length === 0 &&
                        convertedData.history_tracks.length === 0 &&
                        convertedData.user_playlists.length === 0 &&
                        convertedData.user_folders.length === 0;

                    if (hadLocalData && isConvertedEmpty) {
                        console.warn(
                            '[PocketBase] Sync aborted: local data exists but merged result is empty. Preserving local data to prevent accidental wipe.'
                        );
                    } else {
                        await database.importData(convertedData, true);
                    }
                    await new Promise((resolve) => setTimeout(resolve, 300));

                    window.dispatchEvent(new CustomEvent('library-changed'));
                    window.dispatchEvent(new CustomEvent('history-changed'));
                    window.dispatchEvent(new HashChangeEvent('hashchange'));

                    console.log('[PocketBase] ✓ Relational sync completed');
                }
            } catch (error) {
                console.error('[PocketBase] Sync error:', error);
            } finally {
                this._isSyncing = false;
            }
        } else {
            this._userRecordCache = null;
            this._isSyncing = false;
        }
    },
};

if (pb) {
    authManager.onAuthStateChanged(syncManager.onAuthStateChanged.bind(syncManager));
}

export { pb, syncManager };
