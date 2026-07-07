# Qobuz Wrapper Audit Report

We evaluated five open-source Qobuz API wrappers to determine the optimal foundation for our self-hosted Qobuz HTTP service (`qobuz-api`) running alongside `hifi-api` in Dev Mode.

---

## 1. `@kud/qobuz` (`https://github.com/kud/qobuz`)
- **Language / Runtime**: Node.js (>= 20), ESM, TypeScript. Zero runtime dependencies.
- **Last Commit Date**: June 2026 (Active/Current).
- **License**: MIT (Permissive, ideal for self-hosting and embedding).
- **Auth Model**: `user_auth_token` (Token auth extracted from browser/web player). Completely avoids captcha walls and 2FA challenges.
- **Endpoint Coverage**:
  - `search` (tracks, albums, artists, playlists): ✔
  - `track/get`: ✔ | `track/getFileUrl`: ✘ (Not natively exposed in resource helpers)
  - `album/get`, `artist/get`, `playlist/get` + `getTracks`: ✔
  - `favorites` (`getUserFavorites`, create, delete): ✔
  - `userLibrary/getAlbums`: ✘
- **Streaming-URL Support**: ✘ The library focuses on catalog metadata, deep linking, and library analysis rather than streaming; it does not implement `/track/getFileUrl`.
- **Shape**: Library (Consumable in-process or wrapped by Express/Fastify).
- **CORS Posture**: Excellent. Makes direct server-side requests to `api.json` with `X-App-Id` and `X-User-Auth-Token` headers, avoiding Turnstile and browser CORS preflight rejections.
- **Verdict**: **ADOPT (with extension)**. It is the cleanest TypeScript/Node.js library with zero dependencies, robust typing, and an ideal token-auth model. Since it lacks `getFileUrl`, we will adopt its types, authentication pattern, and catalog structure, while implementing a direct helper for `/track/getFileUrl` in our service.

---

## 2. `api-evangelist/qobuz` (`https://github.com/api-evangelist/qobuz`)
- **Language / Runtime**: OpenAPI 3.0 / YAML / JSON Schemas (Documentation & API definitions).
- **Last Commit Date**: June 2026.
- **License**: CC-BY-4.0 / MIT.
- **Auth Model**: Documented specification for `X-App-Id` and `X-User-Auth-Token`.
- **Endpoint Coverage**:
  - `search`: ✔ | `track/get`: ✔ | `track/getFileUrl`: ✔
  - `album/get`, `artist/get`, `playlist/get`: ✔ | `favorites`: ✔ | `userLibrary`: ✔ (Schema definitions)
- **Streaming-URL Support**: ✔ Defines exact parameter schemas and response formats for `/track/getFileUrl` (e.g., format IDs 5, 6, 7, 27).
- **Shape**: Reference / Schema repository.
- **CORS Posture**: N/A (Non-executable documentation).
- **Verdict**: **REJECT (as runtime engine)**. This is not an executable library, but we adopt it as our definitive OpenAPI contract and JSON schema reference for endpoint parameters.

---

## 3. `bbye98/minim` (`https://github.com/bbye98/minim`)
- **Language / Runtime**: Python 3.
- **Last Commit Date**: April 2026.
- **License**: MIT.
- **Auth Model**: Email/Password with MD5 hashing, pre-issued token auth, and optional Playwright integration for captcha resolution.
- **Endpoint Coverage**:
  - `search`: ✔ | `track/get`: ✔ | `track/getFileUrl`: ✔
  - `album/get`, `artist/get`, `playlist/get`: ✔ | `favorites`: ✔ | `userLibrary`: ✔
- **Streaming-URL Support**: ✔ Fully implements `get_file_url` with MD5 signature generation (`request_sig`) and quality tier mapping.
- **Shape**: Python Library.
- **CORS Posture**: Direct HTTP requests bypass browser CORS, but requires a Python runtime environment if hosted as a service.
- **Verdict**: **FALLBACK / REJECT (for Node.js stack)**. Introducing a Python runtime alongside the existing Node/Express `hifi-api` service adds unnecessary architectural friction, but `minim` serves as an excellent reference for MD5 signature generation and complete endpoint coverage.

---

## 4. `markhc/gobuz` (`https://github.com/markhc/gobuz`)
- **Language / Runtime**: Go.
- **Last Commit Date**: September 2025.
- **License**: MIT.
- **Auth Model**: `app_id` + `app_secret` signature auth and `user_auth_token`.
- **Endpoint Coverage**:
  - `search`: ✔ | `track/get`: ✔ | `track/getFileUrl`: ✔
  - `album/get`, `artist/get`, `playlist/get`: ✔ | `favorites`: ✔ | `userLibrary`: ✘
- **Streaming-URL Support**: ✔ Implements `GetTrackFileUrl` with MD5 signature generation (`trackgetFileUrlformat_id...`).
- **Shape**: Go Library.
- **CORS Posture**: N/A (Go HTTP client).
- **Verdict**: **REJECT (for Node.js stack)**. Rejected due to language mismatch with our Node.js/TypeScript frontend and proxy architecture, though highly valuable as an algorithmic reference for MD5 request signing.

---

## 5. `loxoron218/qobuz-api` (`https://github.com/loxoron218/qobuz-api`)
- **Language / Runtime**: Rust (Tokio / Reqwest).
- **Last Commit Date**: May 2026.
- **License**: MIT.
- **Auth Model**: Token auth and MD5 request signing.
- **Endpoint Coverage**:
  - `search`: ✔ | `track/get`: ✔ | `track/getFileUrl`: ✔
  - `album/get`, `artist/get`, `playlist/get`: ✔ | `favorites`: ✔ | `userLibrary`: ✔
- **Streaming-URL Support**: ✔ Comprehensive implementation in `sign_track_file_url` with retry logic and quality fallbacks.
- **Shape**: Rust Library / CLI.
- **CORS Posture**: N/A (Rust HTTP client).
- **Verdict**: **REJECT (as runtime engine)**. Requires a Rust toolchain/runtime, but provides the gold standard reference for rate-limiting backoff algorithms, error classification, and quality tier fallbacks.

---

## Audit Decision Summary
We **DECIDE** to build our self-hosted HTTP service (`qobuz-api`) using Node.js/Express (mirroring the REST URL structure and query parameter conventions of the user's Python/FastAPI `hifi-api` service), adopting **`@kud/qobuz`** as our primary reference for types, domain mapping, and token authentication. Because `@kud/qobuz` does not natively implement `/track/getFileUrl`, we will implement a direct REST call to `https://www.qobuz.com/api.json/0.2/track/getFileUrl` within our Node service, utilizing the parameter schemas from **`api-evangelist/qobuz`** and the MD5 signature logic from **`minim`** / **`gobuz`**.
