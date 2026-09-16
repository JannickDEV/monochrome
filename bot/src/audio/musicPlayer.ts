import { spawn, type ChildProcess } from 'child_process';
import {
    AudioPlayer,
    AudioPlayerStatus,
    createAudioPlayer,
    createAudioResource,
    joinVoiceChannel,
    StreamType,
    VoiceConnection,
    VoiceConnectionStatus,
} from '@discordjs/voice';
import { GuildMember, TextChannel } from 'discord.js';
import ffmpegStatic from 'ffmpeg-static';
import { fallbackProvider } from '../api/devMode.js';
import { SoundCloudProvider } from '../api/soundcloud.js';
import { updateDashboard } from '../ui/dashboard.js';
import { config } from '../config.js';

// ffmpeg-static's default export is a path string at runtime, but its type
// resolves to a namespace, so coerce it.
const FFMPEG_BIN: string = config.ffmpegPath || (ffmpegStatic as unknown as string) || 'ffmpeg';

export interface Track {
    id: string;
    title: string;
    artist: { name: string; id?: string };
    provider: string;
    url?: string; // Resolved stream URL
    quality?: string;
    cover?: string | null;
}

const FFMPEG_ARGS = (url: string) => [
    '-reconnect', '1',
    '-reconnect_streamed', '1',
    '-reconnect_delay_max', '5',
    '-user_agent',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    '-i', url,
    '-vn',
    '-c:a', 'libopus',
    '-b:a', '128k',
    '-vbr', 'on',
    '-ar', '48000',
    '-ac', '2',
    '-f', 'webm',
    'pipe:1',
];

export class MusicPlayer {
    public player: AudioPlayer;
    public connection: VoiceConnection | null = null;
    public queue: Track[] = [];
    public currentTrack: Track | null = null;
    public dashboardChannel: TextChannel | null = null;

    private readonly soundCloudProvider = new SoundCloudProvider();

    /** Bumped on every skip/stop/track-change; a resolve in flight for a stale
     *  token is discarded instead of being played. */
    private playToken = 0;
    private currentFfmpeg: ChildProcess | null = null;
    private pumping = false;
    private idleTimer: NodeJS.Timeout | null = null;

    constructor() {
        this.player = createAudioPlayer();

        this.player.on(AudioPlayerStatus.Idle, () => {
            if (this.currentTrack) {
                console.log(`[MusicPlayer] player went idle while playing "${this.currentTrack.title}"`);
            }
            this.currentTrack = null;
            this.killFfmpeg();
            this.schedulePump();
        });

        this.player.on('error', (error) => {
            console.error('[MusicPlayer] Audio player error:', error.message);
            this.currentTrack = null;
            this.killFfmpeg();
            this.schedulePump();
        });
    }

    get isPaused(): boolean {
        return (
            this.player.state.status === AudioPlayerStatus.Paused ||
            this.player.state.status === AudioPlayerStatus.AutoPaused
        );
    }

    public async join(member: GuildMember, channel: TextChannel): Promise<void> {
        if (!member.voice.channel) throw new Error('You must be in a voice channel first!');

        this.connection = joinVoiceChannel({
            channelId: member.voice.channel.id,
            guildId: member.guild.id,
            adapterCreator: member.guild.voiceAdapterCreator,
        });
        this.dashboardChannel = channel;

        this.connection.on('stateChange', (oldState, newState) => {
            console.log(`[VoiceConnection] ${oldState.status} -> ${newState.status}`);
        });
        this.connection.on(VoiceConnectionStatus.Destroyed, () => {
            this.connection = null;
        });
        this.connection.on(VoiceConnectionStatus.Disconnected, () => {
            this.stop();
        });

        this.connection.subscribe(this.player);
    }

    public addTrack(track: Track): void {
        this.queue.push(track);
        this.schedulePump();
    }

    public addTracks(tracks: Track[]): void {
        this.queue.push(...tracks);
        this.schedulePump();
    }

    public pause(): void {
        this.player.pause();
        this.refreshDashboard();
    }

    public resume(): void {
        this.player.unpause();
        this.refreshDashboard();
    }

    public skip(): void {
        this.playToken++;
        this.killFfmpeg();
        this.player.stop(); // -> Idle -> schedulePump
    }

    public shuffle(): void {
        for (let i = this.queue.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [this.queue[i], this.queue[j]] = [this.queue[j], this.queue[i]];
        }
        this.refreshDashboard();
    }

    /** Clears the upcoming queue but leaves the current track playing. */
    public clearUpcoming(): number {
        const n = this.queue.length;
        this.queue = [];
        this.refreshDashboard();
        return n;
    }

    /** Full teardown: empties the queue, stops playback and leaves the channel. */
    public stop(): void {
        this.playToken++;
        this.clearIdleTimer();
        this.queue = [];
        this.currentTrack = null;
        this.killFfmpeg();
        this.player.stop();
        if (this.connection) {
            try {
                this.connection.destroy();
            } catch {
                /* already destroyed */
            }
            this.connection = null;
        }
        this.refreshDashboard();
    }

    public refreshDashboard(): void {
        if (this.dashboardChannel) {
            updateDashboard(this.dashboardChannel, this);
        }
    }

    // --- internals -------------------------------------------------------------

    private killFfmpeg(): void {
        if (this.currentFfmpeg) {
            this.currentFfmpeg.removeAllListeners();
            this.currentFfmpeg.stderr?.removeAllListeners();
            try {
                this.currentFfmpeg.kill('SIGKILL');
            } catch {
                /* already gone */
            }
            this.currentFfmpeg = null;
        }
    }

    private clearIdleTimer(): void {
        if (this.idleTimer) {
            clearTimeout(this.idleTimer);
            this.idleTimer = null;
        }
    }

    private armIdleTimer(): void {
        this.clearIdleTimer();
        if (!this.connection) return;
        this.idleTimer = setTimeout(() => {
            if (this.currentTrack || this.queue.length > 0) return;
            this.dashboardChannel?.send('Left the voice channel after being idle.').catch(() => {});
            this.stop();
        }, config.idleDisconnectMs);
    }

    private schedulePump(): void {
        if (this.pumping) return;
        this.pump().catch((e) => console.error('[MusicPlayer] pump crashed:', e));
    }

    /** Starts the next queued track if, and only if, the player is currently idle. */
    private async pump(): Promise<void> {
        if (this.pumping) return;
        this.pumping = true;
        try {
            if (this.player.state.status !== AudioPlayerStatus.Idle) {
                this.refreshDashboard();
                return;
            }
            if (this.queue.length === 0) {
                this.refreshDashboard();
                this.armIdleTimer();
                return;
            }

            this.clearIdleTimer();
            const token = ++this.playToken;
            const track = this.queue.shift()!;
            this.currentTrack = track;
            this.refreshDashboard();

            try {
                const streamInfo =
                    track.provider === 'soundcloud'
                        ? await this.soundCloudProvider.getStreamUrl(track.id)
                        : await fallbackProvider.getStreamUrl(track.id);

                if (token !== this.playToken) return; // skipped/stopped while resolving
                if (!streamInfo?.url) throw new Error('No stream URL for this track');

                track.provider = streamInfo.provider || track.provider;
                track.url = streamInfo.url;

                const streamHost = (() => {
                    try {
                        return new URL(streamInfo.url).hostname;
                    } catch {
                        return '(unparseable URL)';
                    }
                })();
                console.log(`[MusicPlayer] streaming "${track.title}" from ${streamHost} via ${track.provider}`);

                const ffmpeg = spawn(FFMPEG_BIN, FFMPEG_ARGS(streamInfo.url));
                const startedAt = Date.now();

                if (token !== this.playToken) {
                    try {
                        ffmpeg.kill('SIGKILL');
                    } catch {
                        /* noop */
                    }
                    return;
                }

                this.killFfmpeg();
                this.currentFfmpeg = ffmpeg;

                ffmpeg.stderr.on('data', (d: Buffer) => console.log(`[ffmpeg] ${d.toString().trim()}`));
                ffmpeg.on('error', (err: Error) => console.error('[MusicPlayer] ffmpeg spawn error:', err));
                ffmpeg.on('exit', (code, signal) => {
                    console.log(
                        `[MusicPlayer] ffmpeg exited (code=${code}, signal=${signal}) after ${Date.now() - startedAt}ms`
                    );
                });

                const resource = createAudioResource(ffmpeg.stdout, { inputType: StreamType.WebmOpus });
                resource.playStream.on('error', (err: Error) => console.error('[MusicPlayer] stream error:', err));
                resource.playStream.on('close', () =>
                    console.log(`[MusicPlayer] ffmpeg stdout closed after ${Date.now() - startedAt}ms`)
                );

                this.player.play(resource);
                this.refreshDashboard();
            } catch (error) {
                if (token !== this.playToken) return;
                console.error('[MusicPlayer] Failed to play track:', error);
                this.currentTrack = null;
                const msg = error instanceof Error ? error.message : 'Unknown error';
                this.dashboardChannel?.send(`Failed to play **${track.title}** — ${msg}`).catch(() => {});
            }
        } finally {
            this.pumping = false;
            // If we ended up idle with tracks still queued (e.g. a resolve
            // failed), try the next one.
            if (this.player.state.status === AudioPlayerStatus.Idle && this.queue.length > 0) {
                this.schedulePump();
            }
        }
    }
}

// One player per guild.
const guildPlayers = new Map<string, MusicPlayer>();

export function getPlayer(guildId: string): MusicPlayer {
    let player = guildPlayers.get(guildId);
    if (!player) {
        player = new MusicPlayer();
        guildPlayers.set(guildId, player);
    }
    return player;
}
