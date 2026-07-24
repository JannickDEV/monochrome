import { ChatInputCommandInteraction, GuildMember, SlashCommandBuilder, MessageFlags } from 'discord.js';
import { getPlayer } from '../audio/musicPlayer.js';

export const data = new SlashCommandBuilder()
    .setName('shuffle')
    .setDescription('Shuffle the current queue');

export async function execute(interaction: ChatInputCommandInteraction) {
    const member = interaction.member as GuildMember;
    
    if (!member.voice.channel) {
        return interaction.reply({ content: 'You must be in a voice channel!', flags: MessageFlags.Ephemeral });
    }

    const player = getPlayer(interaction.guildId!);
    if (!player.connection) {
        return interaction.reply({ content: 'I am not playing anything right now.', flags: MessageFlags.Ephemeral });
    }

    if (player.queue.length === 0) {
        return interaction.reply({ content: 'The queue is currently empty.', flags: MessageFlags.Ephemeral });
    }

    player.shuffle();
    return interaction.reply({ content: 'Shuffled the queue! 🔀', flags: MessageFlags.Ephemeral });
}
