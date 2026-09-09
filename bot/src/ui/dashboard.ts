import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, Message, TextChannel } from 'discord.js';
import { MusicPlayer } from '../audio/musicPlayer.js';

const ICON = 'https://raw.githubusercontent.com/JannickDEV/monochrome/main/assets/512.png';

const dashboardMessages = new Map<string, Message>();
const updateChain = new Map<string, Promise<unknown>>();

function buildEmbed(player: MusicPlayer): EmbedBuilder {
    const embed = new EmbedBuilder()
        .setColor(0x000000)
        .setAuthor({ name: 'Monochrome Music Bot', iconURL: ICON });

    const t = player.currentTrack;
    if (!t && player.queue.length === 0) {
        return embed.setTitle('Nothing is playing').setDescription('Use `/play` to start a session.');
    }
    if (t) {
        embed
            .setTitle((player.isPaused ? '⏸ ' : '') + t.title)
            .setDescription(`by **${t.artist.name}**\n\nProvider: \`${t.provider.toUpperCase()}\``);
        if (t.cover) embed.setThumbnail(t.cover);
    }
    if (player.queue.length > 0) {
        const upNext = player.queue
            .slice(0, 3)
            .map((q, i) => `${i + 1}. ${q.title} — ${q.artist.name}`)
            .join('\n');
        embed.addFields({ name: `Up next (${player.queue.length})`, value: upNext });
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
            try {
                if (existing) {
                    await existing.edit(payload);
                    return;
                }
            } catch {
                // message was deleted — fall through and send a fresh one
            }
            const sent = await channel.send(payload);
            dashboardMessages.set(channel.id, sent);
        })
        .catch((e) => console.error('[dashboard] update failed:', e));

    updateChain.set(channel.id, next);
}
