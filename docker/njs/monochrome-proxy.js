// monochrome-proxy.js — njs handler for the Monochrome web app's general
// pass-through proxy (js/proxy-utils.js -> PROXY_BASE_URL).
//
// Request shape:  GET /proxy/?url=<percent-encoded absolute http(s) URL>
//
// nginx wiring:
//   js_content proxy.handle;                 on  location = /proxy/
//   js_set     $proxy_target proxy.target;   on  the internal @upstream location
//
// handle() answers CORS preflight itself and internal-redirects real GET/HEAD
// requests to the upstream location. No `if` blocks in nginx -> no "if is evil".

function validTarget(raw) {
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

// js_set target -> $proxy_target, consumed by `proxy_pass $proxy_target;`
function target(r) {
    return validTarget(r.variables.arg_url);
}

// js_content on `location = /proxy/`
function handle(r) {
    if (r.method === 'OPTIONS') {
        r.headersOut['Access-Control-Allow-Origin'] = '*';
        r.headersOut['Access-Control-Allow-Methods'] = 'GET, HEAD, OPTIONS';
        r.headersOut['Access-Control-Allow-Headers'] =
            r.headersIn['Access-Control-Request-Headers'] || 'Range, Content-Type, Authorization';
        r.headersOut['Access-Control-Max-Age'] = '86400';
        r.headersOut['Content-Length'] = '0';
        r.return(204);
        return;
    }

    if (r.method !== 'GET' && r.method !== 'HEAD') {
        r.return(405, 'method not allowed\n');
        return;
    }

    if (!validTarget(r.variables.arg_url)) {
        r.return(400, 'bad or missing url\n');
        return;
    }

    r.internalRedirect('@monochrome_proxy_upstream');
}

export default { target, handle };
