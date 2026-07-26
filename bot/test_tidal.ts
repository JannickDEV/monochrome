import { tidalProvider, qobuzProvider } from './src/api/devMode.js';

async function test() {
    console.log("Testing Tidal Playlist...");
    try {
        const tidalRes = await tidalProvider.getPlaylist("1b88e1e7-20b8-4c91-912c-cb0b601f0980");
        console.log("Tidal Keys:", Object.keys(tidalRes));
        console.log("Tidal Tracks length:", tidalRes.tracks?.items?.length || tidalRes.items?.length);
        const firstTrack = tidalRes.tracks?.items?.[0] || tidalRes.items?.[0];
        console.log("First track:", firstTrack?.title, "-", firstTrack?.artist?.name);
    } catch (e) {
        console.error("Tidal error:", e.message);
    }
}

test();
