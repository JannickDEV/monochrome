/**
 * Turns internal errors into short, plain-language reasons for Discord.
 * The full error should always be logged separately — these strings are for
 * listeners, not for debugging.
 */

/** The service is down/slow/rate-limiting us — worth retrying later. */
const NETWORK =
    /fetch failed|econn(refused|reset)|etimedout|enotfound|eai_again|socket hang up|network|timed? ?out|\(5\d\d\)|\b(429|500|502|503|504)\b|rate.?limit|too many requests|service unavailable|bad gateway/i;

/** The track itself couldn't be found or matched on any provider. */
const UNAVAILABLE =
    /not found|\b404\b|no match|cannot translate|no stream url|valid stream url|unavailable|refusing|rejecting|empty/i;

/**
 * Why a track couldn't be streamed, phrased to follow "Couldn't play X — ".
 * Understands FallbackProvider's aggregated "All providers failed for op: a; b"
 * messages: only when *every* provider failed for network reasons is it
 * reported as an outage.
 */
export function describeStreamError(err: unknown): string {
    const text = err instanceof Error ? err.message : String(err ?? '');
    const parts = text
        .replace(/^All providers failed for \w+:\s*/i, '')
        .split(';')
        .map((s) => s.trim())
        .filter(Boolean);

    if (parts.length && parts.every((p) => NETWORK.test(p))) {
        return "the music services aren't responding right now. Try again in a moment";
    }
    if (parts.some((p) => UNAVAILABLE.test(p))) {
        return "it isn't available on any of the streaming services right now";
    }
    return 'something went wrong while loading it';
}
