import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, Message, TextChannel } from 'discord.js';
import { MusicPlayer } from '../audio/musicPlayer.js';

const dashboardMessages = new Map<string, Message>();

const updateChain = new Map<string, Promise<any>>();

export async function updateDashboard(channel: TextChannel, player: MusicPlayer) {
    const prev = updateChain.get(channel.id) || Promise.resolve();
    
    const next = prev.then(async () => {
        const embed = new EmbedBuilder()
            .setColor(0x000000)
            .setAuthor({ name: 'Monochrome Music Bot', iconURL: 'https://github.com/monochrome-music/monochrome/blob/main/assets/512.png?raw=true' });

        if (!player.currentTrack && player.queue.length === 0) {
            embed.setTitle('Nothing is playing right now')
                 .setDescription('Use `/play` to start a session!');
        } else if (player.currentTrack) {
            const t = player.currentTrack;
            embed.setTitle(t.title)
                 .setDescription(`by **${t.artist.name}**\n\nProvider: \`${t.provider.toUpperCase()}\``);
                 
            if (t.cover) {
                embed.setThumbnail(t.cover);
            }

            if (player.queue.length > 0) {
                const upNext = player.queue.slice(0, 3).map((q, i) => `${i + 1}. ${q.title} - ${q.artist.name}`).join('\n');
                embed.addFields({ name: `Up Next (${player.queue.length})`, value: upNext });
            }
        }

        const row = new ActionRowBuilder<ButtonBuilder>()
            .addComponents(
                new ButtonBuilder()
                    .setCustomId('btn_playpause')
                    .setLabel('Play/Pause')
                    .setStyle(ButtonStyle.Primary),
                new ButtonBuilder()
                    .setCustomId('btn_skip')
                    .setLabel('Skip')
                    .setStyle(ButtonStyle.Secondary),
                new ButtonBuilder()
                    .setCustomId('btn_stop')
                    .setLabel('Stop')
                    .setStyle(ButtonStyle.Danger)
            );

        const existingMessage = dashboardMessages.get(channel.id);
        
        try {
            if (existingMessage) {
                await existingMessage.edit({ embeds: [embed], components: [row] });
            } else {
                const newMessage = await channel.send({ embeds: [embed], components: [row] });
                dashboardMessages.set(channel.id, newMessage);
            }
        } catch (e) {
            // If message was deleted by a user, send a new one
            const newMessage = await channel.send({ embeds: [embed], components: [row] });
            dashboardMessages.set(channel.id, newMessage);
        }
    }).catch(e => console.error('[Dashboard Update Error]', e));

    updateChain.set(channel.id, next);
}
