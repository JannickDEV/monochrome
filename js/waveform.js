// js/waveform.js

import { getProxyUrl } from './proxy-utils.js';

export class WaveformGenerator {
    constructor() {
        this.cache = new Map();
        this.sampleCache = new Map();
        this.pendingAudioWaveforms = new Map();
        this.failedAudioWaveforms = new Set();
    }

    generateWaveformPngFromSamples(samples, targetWidth = 1000, targetHeight = 32) {
        if (!Array.isArray(samples) || samples.length === 0) return null;
        if (typeof document === 'undefined') return null;

        try {
            const canvas = document.createElement('canvas');
            canvas.width = targetWidth;
            canvas.height = targetHeight;
            const ctx = canvas.getContext('2d');
            if (!ctx) return null;

            ctx.clearRect(0, 0, targetWidth, targetHeight);
            ctx.fillStyle = '#000000';

            const sampleCount = samples.length;
            const halfHeight = targetHeight / 2;
            const amp = (i) => {
                const sampleVal = typeof samples[i] === 'number' ? samples[i] : 100;
                return Math.max(3, (sampleVal / 255) * (targetHeight - 4));
            };
            const xAt = (i) => (sampleCount === 1 ? 0 : (i / (sampleCount - 1)) * targetWidth);

            // Smooth closed envelope (top then bottom) via mid-point curves.
            ctx.beginPath();
            ctx.moveTo(xAt(0), halfHeight - amp(0) / 2);
            for (let i = 0; i < sampleCount - 1; i++) {
                const x0 = xAt(i);
                const x1 = xAt(i + 1);
                const y0 = halfHeight - amp(i) / 2;
                const y1 = halfHeight - amp(i + 1) / 2;
                ctx.quadraticCurveTo(x0, y0, (x0 + x1) / 2, (y0 + y1) / 2);
            }
            const lastTopY = halfHeight - amp(sampleCount - 1) / 2;
            ctx.lineTo(xAt(sampleCount - 1), lastTopY);
            ctx.lineTo(xAt(sampleCount - 1), halfHeight + amp(sampleCount - 1) / 2);
            for (let i = sampleCount - 1; i > 0; i--) {
                const x0 = xAt(i);
                const x1 = xAt(i - 1);
                const y0 = halfHeight + amp(i) / 2;
                const y1 = halfHeight + amp(i - 1) / 2;
                ctx.quadraticCurveTo(x0, y0, (x0 + x1) / 2, (y0 + y1) / 2);
            }
            ctx.lineTo(xAt(0), halfHeight + amp(0) / 2);
            ctx.closePath();
            ctx.fill();

            return this.createMaskImageUrl(canvas);
        } catch (e) {
            console.warn('Unable to generate PNG from samples:', e);
            return null;
        }
    }

    generateFallbackWaveform(trackId) {
        if (!trackId) return null;
        const seedString = String(trackId);
        let hash = 0;
        for (let i = 0; i < seedString.length; i++) {
            hash = (hash << 5) - hash + seedString.charCodeAt(i);
            hash |= 0;
        }

        const lcg = () => {
            hash = (Math.imul(hash, 1664525) + 1013904223) | 0;
            return ((hash >>> 0) % 10000) / 10000;
        };

        const sampleCount = 240;
        const samples = new Array(sampleCount);

        for (let i = 0; i < sampleCount; i++) {
            const pos = i / sampleCount;
            const envelope = Math.sin(pos * Math.PI);
            const var1 = Math.sin(pos * 18 + lcg() * 2);
            const var2 = Math.cos(pos * 42);
            const rawAmp = 0.35 + 0.35 * var1 + 0.3 * var2;
            const noise = 0.4 + 0.6 * lcg();
            const val = Math.floor(Math.max(12, Math.min(255, rawAmp * noise * envelope * 230 + 20)));
            samples[i] = val;
        }

        const pngUrl = this.generateWaveformPngFromSamples(samples);
        return {
            pngUrl,
            jsonUrl: null,
            samples,
            durationSeconds: null,
            isFallback: true,
        };
    }

    async loadWaveformData(waveformObj, trackId) {
        if (trackId && this.sampleCache.has(trackId)) {
            return this.sampleCache.get(trackId);
        }

        let samples = Array.isArray(waveformObj?.samples) ? waveformObj.samples : null;
        let pngUrl = waveformObj?.png_url || waveformObj?.pngUrl || null;
        let jsonUrl = waveformObj?.json_url || waveformObj?.jsonUrl || null;
        let durationMs = Number(waveformObj?.duration_ms ?? waveformObj?.durationMs) || null;

        if (!samples && jsonUrl) {
            try {
                const response = await fetch(jsonUrl);
                if (response.ok) {
                    const json = await response.json();
                    if (Array.isArray(json.samples)) {
                        samples = json.samples;
                    }
                    durationMs = Number(json.duration_ms ?? json.durationMs) || durationMs;
                }
            } catch (e) {
                console.warn('Failed to load waveform JSON:', e);
            }
        }

        if (samples && !pngUrl) {
            pngUrl = this.generateWaveformPngFromSamples(samples);
        }

        if (!pngUrl && !samples && trackId) {
            const fallback = this.generateFallbackWaveform(trackId);
            if (fallback) {
                this.sampleCache.set(trackId, fallback);
                return fallback;
            }
        }

        const result = {
            pngUrl,
            jsonUrl,
            samples,
            durationSeconds: durationMs && durationMs > 0 ? durationMs / 1000 : null,
        };
        if (trackId) {
            this.sampleCache.set(trackId, result);
        }
        return result;
    }

    invertWaveformMaskAlpha(data) {
        if (!data) return data;
        for (let i = 0; i < data.length; i += 4) {
            data[i] = 0;
            data[i + 1] = 0;
            data[i + 2] = 0;
            data[i + 3] = 255 - data[i + 3];
        }
        return data;
    }

    async decodeImage(blob) {
        if (typeof createImageBitmap === 'function') {
            try {
                return await createImageBitmap(blob);
            } catch {
                // Fall back for Safari versions with partial ImageBitmap PNG support.
            }
        }

        const objectUrl = URL.createObjectURL(blob);
        try {
            return await new Promise((resolve, reject) => {
                const image = new Image();
                image.onload = () => resolve(image);
                image.onerror = () => reject(new Error('Unable to decode waveform image'));
                image.src = objectUrl;
            });
        } finally {
            URL.revokeObjectURL(objectUrl);
        }
    }

    async loadWaveformPngAsAlphaMask(pngUrl, targetWidth = 1000, targetHeight = 28) {
        if (!pngUrl) return null;
        let image = null;

        try {
            const response = await fetch(pngUrl);
            if (!response.ok) return null;
            image = await this.decodeImage(await response.blob());

            const canvas = document.createElement('canvas');
            canvas.width = targetWidth;
            canvas.height = targetHeight;
            const context = canvas.getContext('2d');
            if (!context) return null;

            context.drawImage(image, 0, 0, targetWidth, targetHeight);
            const imageData = context.getImageData(0, 0, targetWidth, targetHeight);
            this.invertWaveformMaskAlpha(imageData.data);
            context.putImageData(imageData, 0, 0);
            return this.createMaskImageUrl(canvas);
        } catch (error) {
            console.warn('Unable to convert SoundCloud waveform mask:', error);
            return null;
        } finally {
            if (typeof image?.close === 'function') image.close();
        }
    }

    async loadWaveformPngSamples(pngUrl, targetWidth = 500, targetHeight = 140) {
        if (!pngUrl) return null;
        let image = null;

        try {
            const response = await fetch(pngUrl);
            if (!response.ok) return null;
            image = await this.decodeImage(await response.blob());

            const canvas = document.createElement('canvas');
            canvas.width = targetWidth;
            canvas.height = targetHeight;
            const context = canvas.getContext('2d');
            if (!context) return null;

            context.drawImage(image, 0, 0, targetWidth, targetHeight);
            const pixels = context.getImageData(0, 0, targetWidth, targetHeight).data;
            const samples = new Array(targetWidth).fill(0);
            for (let x = 0; x < targetWidth; x++) {
                let transparentPixels = 0;
                for (let y = 0; y < targetHeight; y++) {
                    if (pixels[(y * targetWidth + x) * 4 + 3] < 128) transparentPixels++;
                }
                samples[x] = Math.round((transparentPixels / targetHeight) * 255);
            }
            return samples;
        } catch (error) {
            console.warn('Unable to extract SoundCloud waveform samples:', error);
            return null;
        } finally {
            if (typeof image?.close === 'function') image.close();
        }
    }

    createMaskImageUrl(canvas) {
        if (!canvas || typeof canvas.toDataURL !== 'function') return null;
        const dataUrl = canvas.toDataURL('image/png');
        if (!dataUrl?.startsWith('data:image/png') || dataUrl.length <= 100) return null;
        return dataUrl;
    }

    getSilenceBoundaries(samples, duration, threshold = 5, crossfadeDurationSeconds = 3) {
        if (!Array.isArray(samples) || samples.length === 0 || !duration || duration <= 0) {
            return {
                leadingSilenceSeconds: 0,
                trailingSilenceStartTime: duration || 0,
                crossfadeStartTime: duration || 0,
                crossfadeDurationSeconds: 0,
                hasTrailingSilence: false,
            };
        }

        // Leading silence: find first sample >= threshold
        let firstActiveIndex = 0;
        while (firstActiveIndex < samples.length && samples[firstActiveIndex] < threshold) {
            firstActiveIndex++;
        }

        // Trailing silence: find last sample >= threshold
        let lastActiveIndex = samples.length - 1;
        while (lastActiveIndex >= 0 && samples[lastActiveIndex] < threshold) {
            lastActiveIndex--;
        }

        // If no active sample reached threshold, do not trim whole track
        if (lastActiveIndex < 0 || firstActiveIndex >= samples.length) {
            return {
                leadingSilenceSeconds: 0,
                trailingSilenceStartTime: duration,
                crossfadeStartTime: duration,
                crossfadeDurationSeconds: 0,
                hasTrailingSilence: false,
            };
        }

        const leadingSilenceSeconds = (firstActiveIndex / samples.length) * duration;
        const trailingSilenceStartTime = ((lastActiveIndex + 1) / samples.length) * duration;
        const hasTrailingSilence = duration - trailingSilenceStartTime > 0.5;
        const transitionEndTime = hasTrailingSilence ? trailingSilenceStartTime : duration;
        const availableCrossfadeSeconds = Math.max(
            0,
            Math.min(crossfadeDurationSeconds, transitionEndTime - leadingSilenceSeconds)
        );
        const crossfadeStartTime = transitionEndTime - availableCrossfadeSeconds;

        return {
            leadingSilenceSeconds,
            trailingSilenceStartTime,
            crossfadeStartTime,
            crossfadeDurationSeconds: availableCrossfadeSeconds,
            hasTrailingSilence,
        };
    }

    async getWaveform(url, trackId) {
        const cacheKey = trackId ? `${trackId}_${url}` : url;
        if (this.cache.has(cacheKey)) {
            return this.cache.get(cacheKey);
        }
        if (trackId && this.failedAudioWaveforms.has(trackId)) {
            return null;
        }

        try {
            const audioContext = new (window.OfflineAudioContext || window.webkitOfflineAudioContext)(1, 1, 44100);
            const response = await fetch(getProxyUrl(url));
            if (!response.ok) {
                throw new Error(`Waveform fetch failed: HTTP ${response.status}`);
            }
            const arrayBuffer = await response.arrayBuffer();
            const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);

            const peaks = this.extractPeaks(audioBuffer);
            const result = { peaks, duration: audioBuffer.duration };
            this.cache.set(cacheKey, result);
            return result;
        } catch (error) {
            if (trackId) {
                this.failedAudioWaveforms.add(trackId);
            }
            console.warn('Waveform generation failed:', error);
            return null;
        }
    }

    async generateWaveformFromAudioUrl(url, trackId, targetWidth = 1000, targetHeight = 32) {
        if (!url) return null;
        if (trackId && this.pendingAudioWaveforms.has(trackId)) {
            return this.pendingAudioWaveforms.get(trackId);
        }

        const pending = (async () => {
            try {
                const decoded = await this.getWaveform(url, trackId);
                if (!decoded?.peaks) return null;

                const samples = new Array(decoded.peaks.length);
                for (let i = 0; i < decoded.peaks.length; i++) {
                    samples[i] = Math.max(3, Math.round(decoded.peaks[i] * 255));
                }
                const pngUrl = this.generateWaveformPngFromSamples(samples, targetWidth, targetHeight);
                const result = {
                    pngUrl,
                    jsonUrl: null,
                    samples,
                    durationSeconds: decoded.duration || null,
                    isFallback: false,
                };
                if (trackId) {
                    this.sampleCache.set(trackId, result);
                }
                return result;
            } catch (error) {
                console.warn('Failed to generate waveform from audio:', error);
                return null;
            } finally {
                if (trackId) {
                    this.pendingAudioWaveforms.delete(trackId);
                }
            }
        })();

        if (trackId) {
            this.pendingAudioWaveforms.set(trackId, pending);
        }
        return pending;
    }

    extractPeaks(audioBuffer) {
        const { length, duration } = audioBuffer;
        const numPeaks = Math.min(Math.floor(4 * duration), 1000);
        const peaks = new Float32Array(numPeaks);
        const chanData = audioBuffer.getChannelData(0);
        const step = Math.floor(length / numPeaks);
        const stride = 8;

        for (let i = 0; i < numPeaks; i++) {
            let max = 0;
            const start = i * step;
            const end = start + step;
            for (let j = start; j < end; j += stride) {
                const datum = chanData[j];
                if (datum > max) {
                    max = datum;
                } else if (-datum > max) {
                    max = -datum;
                }
            }
            peaks[i] = max;
        }

        let maxPeak = 0;
        for (let i = 0; i < numPeaks; i++) {
            if (peaks[i] > maxPeak) maxPeak = peaks[i];
        }
        if (maxPeak > 0) {
            for (let i = 0; i < numPeaks; i++) {
                peaks[i] /= maxPeak;
            }
        }

        return peaks;
    }

    drawWaveformFromSamples(canvas, samples) {
        if (!canvas || !Array.isArray(samples) || samples.length === 0) return;

        let maxVal = 0;
        for (let i = 0; i < samples.length; i++) {
            if (samples[i] > maxVal) maxVal = samples[i];
        }
        const normFactor = maxVal > 0 ? maxVal : 140;

        const peaks = new Float32Array(samples.length);
        for (let i = 0; i < samples.length; i++) {
            peaks[i] = samples[i] / normFactor;
        }

        this.drawWaveform(canvas, peaks);
    }

    drawWaveform(canvas, peaks) {
        if (!canvas || !peaks || peaks.length === 0) return;

        const ctx = canvas.getContext('2d');
        const width = canvas.width;
        const height = canvas.height;

        ctx.clearRect(0, 0, width, height);

        const numBars = Math.min(peaks.length, Math.floor(width / 3));
        const samplesPerBar = Math.max(1, Math.floor(peaks.length / numBars));
        const barWidth = Math.max(1.5, (width / numBars) * 0.65);
        const gap = (width / numBars) * 0.35;
        const centerY = height / 2;

        ctx.fillStyle = '#000';

        for (let i = 0; i < numBars; i++) {
            let maxPeak = 0;
            const startIdx = i * samplesPerBar;
            const endIdx = Math.min(startIdx + samplesPerBar, peaks.length);
            for (let j = startIdx; j < endIdx; j++) {
                if (peaks[j] > maxPeak) maxPeak = peaks[j];
            }

            const barHeight = Math.max(2, maxPeak * height * 0.85);
            const x = i * (barWidth + gap);
            const y = centerY - barHeight / 2;
            const radius = Math.min(barWidth / 2, barHeight / 2);

            ctx.beginPath();
            if (typeof ctx.roundRect === 'function') {
                ctx.roundRect(x, y, barWidth, barHeight, radius);
            } else {
                ctx.rect(x, y, barWidth, barHeight);
            }
            ctx.fill();
        }
    }
}

export const waveformGenerator = new WaveformGenerator();
