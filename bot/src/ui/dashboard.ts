import {
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    DiscordAPIError,
    EmbedBuilder,
    Message,
    RESTJSONErrorCodes,
    TextChannel,
} from 'discord.js';
import { MusicPlayer } from '../audio/musicPlayer.js';
import { EMBED_LIMITS, joinWithin, requesterName, trackLine, truncate } from './format.js';

const ICON = 'https://raw.githubusercontent.com/JannickDEV/monochrome/main/assets/icon-only.png';
const UP_NEXT_SHOWN = 3;

const dashboardMessages = new Map<string, Message>();
const updateChain = new Map<string, Promise<unknown>>();

function buildEmbed(player: MusicPlayer): EmbedBuilder {
    const embed = new EmbedBuilder().setColor(0x000000).setAuthor({ name: 'Monochrome Music Bot', iconURL: ICON });

    const t = player.currentTrack;
    if (!t && player.queue.length === 0) {
        return embed.setTitle('Nothing is playing').setDescription('Use `/play` to start a session.');
    }
    if (t) {
        const requester = requesterName(t);
        embed
            .setTitle(truncate((player.isPaused ? '⏸ ' : '') + t.title, EMBED_LIMITS.title))
            .setDescription(
                `by **${truncate(t.artist.name, 256)}**\n\n` +
                    (requester ? `Added by ${requester}\n` : '') +
                    `Provider: \`${t.provider.toUpperCase()}\``
            );
        if (t.cover) embed.setThumbnail(t.cover);
    }
    if (player.queue.length > 0) {
        const lines = player.queue.slice(0, UP_NEXT_SHOWN).map((q, i) => trackLine(q, i + 1));
        const hidden = Math.max(0, player.queue.length - UP_NEXT_SHOWN);
        embed.addFields({
            name: `Up next (${player.queue.length})`,
            value: joinWithin(lines, EMBED_LIMITS.fieldValue, hidden),
        });
    }
    return embed;
}

function buildButtons(): ActionRowBuilder<ButtonBuilder> {
    return new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId('btn_playpause').setLabel('Play/Pause').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId('btn_skip').setLabel('Skip').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId('btn_shuffle').setLabel('Shuffle').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId('btn_stop').setLabel('Stop').setStyle(ButtonStyle.Danger)
    );
}

/** Edit-or-send the single control message for a channel, serialised per channel. */
export function updateDashboard(channel: TextChannel, player: MusicPlayer): void {
    const prev = updateChain.get(channel.id) ?? Promise.resolve();

    const next = prev
        .then(async () => {
            const payload = { embeds: [buildEmbed(player)], components: [buildButtons()] };
            const existing = dashboardMessages.get(channel.id);
            if (existing) {
                try {
                    await existing.edit(payload);
                    return;
                } catch (e) {
                    // Only a deleted message warrants a fresh one. Anything else
                    // (rate limit, network, validation) would leave the old
                    // dashboard in place and post a duplicate — surface it instead.
                    if (!(e instanceof DiscordAPIError && e.code === RESTJSONErrorCodes.UnknownMessage)) throw e;
                    dashboardMessages.delete(channel.id);
                }
            }
            const sent = await channel.send(payload);
            dashboardMessages.set(channel.id, sent);
        })
        .catch((e) => console.error('[dashboard] update failed:', e));

    updateChain.set(channel.id, next);
}
