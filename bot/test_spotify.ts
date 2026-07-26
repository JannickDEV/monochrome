import spotifyUrlInfo from 'spotify-url-info';
const { getTracks } = spotifyUrlInfo(fetch);

async function test() {
    console.log("Fetching spotify playlist...");
    try {
        const tracks = await getTracks("https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M");
        console.log("Spotify tracks:", tracks.length);
        console.log("First track:", tracks[0]?.name, "-", tracks[0]?.artists?.[0]?.name);
    } catch (e) {
        console.error("Error:", e.message);
    }
}

test();
