async function test() {
    console.log("Testing Qobuz Proxy Playlist:");
    try {
        const qzRes = await fetch("https://qz-api.bitperfect.dedyn.io/playlist/?playlist_id=12270929");
        if (qzRes.ok) {
            const data = await qzRes.json();
            console.log("SUCCESS!", Object.keys(data));
        } else {
            console.log("FAIL:", qzRes.status);
        }
    } catch(e) { console.log(e.message); }

    console.log("\nTesting Tidal Proxy Playlist (Albums):");
    try {
        const tidalRes = await fetch("https://hf-core.bitperfect.dedyn.io/album/?id=144371273");
        if (tidalRes.ok) {
            const data = await tidalRes.json();
            console.log("SUCCESS!", Object.keys(data));
        } else {
            console.log("FAIL:", tidalRes.status);
        }
    } catch(e) { console.log(e.message); }
}
test();
