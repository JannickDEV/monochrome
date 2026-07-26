import { tidalProvider, qobuzProvider } from '../bot/src/api/devMode.js';

async function test() {
    console.log("Testing Tidal Playlist...");
    try {
        const tidalRes = await tidalProvider.getPlaylist("1b88e1e7-20b8-4c91-912c-cb0b601f0980"); // Some public tidal playlist
        console.log("Tidal Keys:", Object.keys(tidalRes));
        console.log("Tidal Tracks length:", tidalRes.tracks?.items?.length || tidalRes.items?.length);
    } catch (e) {
        console.error("Tidal error:", e.message);
    }

    console.log("\nTesting Qobuz Playlist...");
    try {
        const qobuzRes = await qobuzProvider.getPlaylist("12270929"); // Some public qobuz playlist
        console.log("Qobuz Keys:", Object.keys(qobuzRes));
        console.log("Qobuz Tracks length:", qobuzRes.tracks?.items?.length || qobuzRes.tracks?.length);
    } catch (e) {
        console.error("Qobuz error:", e.message);
    }
}

test();
