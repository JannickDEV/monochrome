import { escapeMarkdown } from 'discord.js';
import type { Track } from '../audio/musicPlayer.js';

/** Discord embed length limits — exceeding any of these makes EmbedBuilder throw. */
export const EMBED_LIMITS = { title: 256, description: 4096, fieldValue: 1024 } as const;

/** Per-part caps for one list line, so a single long title can't crowd out the rest. */
const LINE_TITLE_MAX = 100;
const LINE_ARTIST_MAX = 60;

export function truncate(s: string, max: number): string {
    return s.length <= max ? s : s.slice(0, Math.max(0, max - 1)) + '…';
}

/**
 * The requester's display name as plain, markdown-escaped text — deliberately
 * not a `<@id>` mention: embed mentions only resolve for users the viewer has
 * cached (otherwise they show as raw ids / "@unknown-user"), and a mention in
 * message content would ping. Display names can still contain text like
 * "@everyone", so message content using this must still pass
 * `allowedMentions: { parse: [] }`.
 */
export function requesterName(track: Track): string | null {
    return track.requestedBy ? escapeMarkdown(track.requestedBy.name) : null;
}

/** " · added by Name", or "" when the track has no recorded requester. */
export function requesterSuffix(track: Track): string {
    const name = requesterName(track);
    return name ? ` · added by ${name}` : '';
}

/** "1. Title — Artist · added by Name", with title and artist length-capped. */
export function trackLine(track: Track, position?: number): string {
    const prefix = position != null ? `${position}. ` : '';
    return (
        prefix +
        `${truncate(track.title, LINE_TITLE_MAX)} — ${truncate(track.artist.name, LINE_ARTIST_MAX)}` +
        requesterSuffix(track)
    );
}

/**
 * Joins `lines` with newlines, dropping whole lines from the end so the result
 * fits in `max` characters. Dropped lines plus `hiddenAfter` (items that were
 * never turned into lines) are summarised as "…and N more".
 */
export function joinWithin(lines: string[], max: number, hiddenAfter = 0): string {
    const moreNote = (n: number) => (n > 0 ? `\n*…and ${n} more*` : '');
    for (let keep = lines.length; keep >= 0; keep--) {
        const out = lines.slice(0, keep).join('\n') + moreNote(lines.length - keep + hiddenAfter);
        if (out.length <= max) return out;
    }
    // Not even the note fits (only possible with a tiny `max`) — plain text, so
    // truncation can't leave an unclosed italic marker.
    return truncate(`…and ${lines.length + hiddenAfter} more`, max);
}
