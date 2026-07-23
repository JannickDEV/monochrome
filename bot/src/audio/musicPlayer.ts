import {
    AudioPlayer,
    AudioPlayerStatus,
    createAudioPlayer,
    createAudioResource,
    demuxProbe,
    joinVoiceChannel,
    VoiceConnection,
    VoiceConnectionStatus
} from '@discordjs/voice';
import { GuildMember, TextChannel } from 'discord.js';
import { fallbackProvider } from '../api/devMode.js';
import { SoundCloudProvider } from '../api/soundcloud.js';
import { updateDashboard } from '../ui/dashboard.js';


export interface Track {
    id: string;
    title: string;
    artist: { name: string; id?: string };
    provider: string;
    url?: string; // Resolved stream URL
    quality?: string;
    cover?: string | null;
}

export class MusicPlayer {
    public player: AudioPlayer;
    public connection: VoiceConnection | null = null;
    public queue: Track[] = [];
    public currentTrack: Track | null = null;
    public dashboardChannel: TextChannel | null = null;
    
    private soundCloudProvider = new SoundCloudProvider();

    constructor() {
        this.player = createAudioPlayer();

        this.player.on(AudioPlayerStatus.Idle, () => {
            this.currentTrack = null;
            this.playNext();
        });

        this.player.on('error', error => {
            console.error('[MusicPlayer] Audio Player Error:', error.message);
            this.currentTrack = null;
            this.playNext();
        });
    }

    public async join(member: GuildMember, channel: TextChannel) {
        if (!member.voice.channel) throw new Error('You must be in a voice channel first!');
        
        this.connection = joinVoiceChannel({
            channelId: member.voice.channel.id,
            guildId: member.guild.id,
            adapterCreator: member.guild.voiceAdapterCreator,
        });
        
        this.dashboardChannel = channel;

        this.connection.on(VoiceConnectionStatus.Disconnected, () => {
            this.stop();
        });

        this.connection.subscribe(this.player);
    }

    public async addTrack(track: Track) {
        this.queue.push(track);
        if (this.player.state.status === AudioPlayerStatus.Idle) {
            this.playNext();
        } else {
            this.refreshDashboard();
        }
    }

    public async playNext() {
        if (this.queue.length === 0) {
            this.refreshDashboard();
            return;
        }

        const track = this.queue.shift()!;
        this.currentTrack = track;

        try {
            console.log(`[MusicPlayer] Resolving stream for ${track.id} (${track.provider})`);
            let streamInfo;
            
            if (track.provider === 'soundcloud') {
                streamInfo = await this.soundCloudProvider.getStreamUrl(track.id);
            } else {
                // Uses FallbackProvider (Qobuz priority, Tidal fallback with ISRC translation)
                streamInfo = await fallbackProvider.getStreamUrl(track.id);
            }

            if (!streamInfo || !streamInfo.url) {
                throw new Error('Stream URL not found');
            }

            this.currentTrack.provider = streamInfo.provider || this.currentTrack.provider;

            console.log(`[MusicPlayer] Playing stream URL: ${streamInfo.url.substring(0, 50)}...`);

            const { spawn } = await import('child_process');
            const { StreamType } = await import('@discordjs/voice');
            
            const args = [
                '-reconnect', '1',
                '-reconnect_streamed', '1',
                '-reconnect_delay_max', '5',
                '-user_agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                '-i', streamInfo.url,
                '-c:a', 'libopus',
                '-b:a', '128k',
                '-vbr', 'on',
                '-compression_level', '10',
                '-frame_duration', '20',
                '-application', 'audio',
                '-f', 'opus',
                'pipe:1'
            ];

            const ffmpegProcess = spawn(process.env.FFMPEG_PATH || 'ffmpeg', args);
            
            ffmpegProcess.stderr.on('data', (data) => {
                const msg = data.toString();
                if (msg.includes('Error') || msg.includes('403') || msg.includes('404')) {
                    console.error(`[FFmpeg] ${msg.trim()}`);
                }
            });
            
            ffmpegProcess.on('error', (err) => {
                console.error('[MusicPlayer] FFmpeg spawn error:', err);
            });

            const resource = createAudioResource(ffmpegProcess.stdout, {
                inputType: StreamType.OggOpus,
            });

            resource.playStream.on('error', (err: any) => {
                console.error('[MusicPlayer] Stream Error (FFmpeg):', err);
            });

            this.player.play(resource);
            this.refreshDashboard();
        } catch (error) {
            console.error('[MusicPlayer] Failed to play track:', error);
            this.currentTrack = null;
            if (this.dashboardChannel) {
                this.dashboardChannel.send(`❌ Failed to play **${track.title}**: ${error instanceof Error ? error.message : 'Unknown error'}`);
            }
            this.playNext();
        }
    }

    public pause() {
        this.player.pause();
        this.refreshDashboard();
    }

    public resume() {
        this.player.unpause();
        this.refreshDashboard();
    }

    public skip() {
        this.player.stop(); // triggers Idle event -> playNext()
    }

    public stop() {
        this.queue = [];
        this.currentTrack = null;
        this.player.stop();
        if (this.connection) {
            this.connection.destroy();
            this.connection = null;
        }
        this.refreshDashboard();
    }

    public refreshDashboard() {
        if (this.dashboardChannel) {
            updateDashboard(this.dashboardChannel, this);
        }
    }
}

// Global music player instances per guild
export const guildPlayers = new Map<string, MusicPlayer>();

export function getPlayer(guildId: string): MusicPlayer {
    if (!guildPlayers.has(guildId)) {
        guildPlayers.set(guildId, new MusicPlayer());
    }
    return guildPlayers.get(guildId)!;
}
