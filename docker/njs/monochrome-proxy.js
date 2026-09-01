// monochrome-proxy.js — njs handler for the Monochrome web app's general
// pass-through proxy (js/proxy-utils.js -> PROXY_BASE_URL).
//
// Request shape:  GET /proxy/?url=<percent-encoded absolute http(s) URL>
// js_set $proxy_target proxy.target;  ->  used as `proxy_pass $proxy_target;`
//
// Returns "" for anything that must not be proxied (missing/invalid url,
// non-http(s) scheme, or a host that looks internal). nginx then returns 400.

function target(r) {
    var raw = r.variables.arg_url;
    if (!raw) {
        return '';
    }

    var url;
    try {
        url = decodeURIComponent(raw);
    } catch (e) {
        return '';
    }

    if (!/^https?:\/\/[^/\s]/i.test(url)) {
        return '';
    }

    var host = url.replace(/^https?:\/\//i, '').split(/[/:?#]/)[0].toLowerCase();
    if (!host) {
        return '';
    }

    // Basic SSRF guard: refuse obviously-internal targets.
    if (
        host === 'localhost' ||
        host === '::1' ||
        host[0] === '[' ||
        /\.(local|internal|lan|home|corp|localdomain)$/.test(host) ||
        /^(0\.|127\.|10\.|169\.254\.|192\.168\.)/.test(host) ||
        /^172\.(1[6-9]|2[0-9]|3[01])\./.test(host) ||
        /^100\.(6[4-9]|[7-9][0-9]|1[01][0-9]|12[0-7])\./.test(host)
    ) {
        return '';
    }

    return url;
}

export default { target };
