async function test() {
    const urls = [
        "https://hf-core.bitperfect.dedyn.io/playlist/1b88e1e7-20b8-4c91-912c-cb0b601f0980",
        "https://hf-core.bitperfect.dedyn.io/playlist?id=1b88e1e7-20b8-4c91-912c-cb0b601f0980",
        "https://hf-core.bitperfect.dedyn.io/playlists/1b88e1e7-20b8-4c91-912c-cb0b601f0980",
        "https://qz-api.bitperfect.dedyn.io/playlist/get?playlist_id=12270929",
        "https://qz-api.bitperfect.dedyn.io/playlist/12270929"
    ];

    for (const url of urls) {
        console.log("Fetching:", url);
        try {
            const res = await fetch(url);
            if (res.ok) {
                const data = await res.json();
                console.log("SUCCESS!", url);
                console.log("Data keys:", Object.keys(data));
                if (data.tracks) console.log("Tracks length:", data.tracks.items?.length);
            } else {
                console.log("FAIL:", res.status);
            }
        } catch (e) {
            console.log("ERROR:", e.message);
        }
    }
}
test();
