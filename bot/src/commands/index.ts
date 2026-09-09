import type {
    ChatInputCommandInteraction,
    SlashCommandBuilder,
    SlashCommandOptionsOnlyBuilder,
} from 'discord.js';
import * as play from './play.js';
import * as queue from './queue.js';
import * as clear from './clear.js';
import * as shuffle from './shuffle.js';
import * as skip from './skip.js';
import * as pause from './pause.js';
import * as resume from './resume.js';
import * as stop from './stop.js';
import * as nowplaying from './nowplaying.js';

export interface BotCommand {
    data: SlashCommandBuilder | SlashCommandOptionsOnlyBuilder;
    execute: (interaction: ChatInputCommandInteraction) => Promise<unknown>;
}

export const commands: BotCommand[] = [
    { data: play.data, execute: play.execute },
    { data: queue.data, execute: queue.execute },
    { data: clear.data, execute: clear.execute },
    { data: shuffle.data, execute: shuffle.execute },
    { data: skip.data, execute: skip.execute },
    { data: pause.data, execute: pause.execute },
    { data: resume.data, execute: resume.execute },
    { data: stop.data, execute: stop.execute },
    { data: nowplaying.data, execute: nowplaying.execute },
];

export const commandMap = new Map<string, BotCommand>(commands.map((c) => [c.data.name, c]));
