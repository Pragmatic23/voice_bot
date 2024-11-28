class AudioHandler {
    constructor() {
        this.mediaRecorder = null;
        this.stream = null;
        this.chunks = [];
        this.isRecording = false;
        this.isContinuousMode = false;
        this.isProcessing = false;
        this.audioContext = null;
        this.silenceThreshold = -45;
        this.silenceDuration = 1.0;
        this.lastVoiceTime = 0;
        this.voiceDetectionInterval = null;
        this.onSpeechEnd = null;
        this.onBotResponseEnd = null;
        this.isWaitingForResponse = false;
        this.mimeType = this.getSupportedMimeType();
    }

    getSupportedMimeType() {
        // Prioritize formats that are compatible with OpenAI's transcription service
        const preferredTypes = [
            'audio/webm',
            'audio/ogg;codecs=opus',
            'audio/wav',
            'audio/mp4'
        ];

        for (const type of preferredTypes) {
            if (MediaRecorder.isTypeSupported(type)) {
                console.log(`[AudioHandler] Using MIME type: ${type}`);
                return type;
            }
        }
        throw new Error('No supported audio MIME types found');
    }

    async startRecording(continuous = false) {
        try {
            await this.cleanup();
            this.isContinuousMode = continuous;

            if (continuous) {
                this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
            }

            const constraints = {
                audio: {
                    channelCount: 1,
                    sampleRate: 48000,
                    sampleSize: 16,
                    echoCancellation: true,
                    noiseSuppression: true,
                    autoGainControl: true
                }
            };

            this.stream = await navigator.mediaDevices.getUserMedia(constraints);
            this.chunks = [];
            await this.createMediaRecorder();

            // // Create MediaRecorder with explicit settings
            // this.mediaRecorder = new MediaRecorder(this.stream, {
            //     mimeType: this.mimeType,
            //     audioBitsPerSecond: 128000
            // });

            // this.setupRecordingHandlers();

            if (continuous) {
                await this.setupVoiceDetection();
            }

            this.isRecording = true;
            this.mediaRecorder.start(1000);
            return true;
        } catch (error) {
            await this.cleanup();
            throw this.formatError(error);
        }
    }

    async createMediaRecorder() {
        if (!this.stream) {
            throw new Error('No media stream available');
        }

        this.mediaRecorder = new MediaRecorder(this.stream, {
            mimeType: this.mimeType,
            audioBitsPerSecond: 128000
        });

        this.setupRecordingHandlers();
    }

        setupRecordingHandlers() {
        this.mediaRecorder.ondataavailable = (event) => {
            if (event.data.size > 0) {
                this.chunks.push(event.data);
            }
        };

        this.mediaRecorder.onstop = async () => {
            if (this.chunks.length > 0) {
                try {
                    // Convert audio to a compatible format if needed
                    const audioBlob = await this.convertToCompatibleFormat(
                        new Blob(this.chunks, { type: this.mimeType })
                    );
                    this.chunks = [];

                    if (typeof this.onSpeechEnd === 'function' && !this.isWaitingForResponse) {
                        this.isWaitingForResponse = true;
                        await this.onSpeechEnd(audioBlob);
                    }
                } catch (error) {
                    console.error('[AudioHandler] Error processing audio chunks:', error);
                    throw error;
                }
            }
        };
    }

    async convertToCompatibleFormat(blob) {
        try {
            // Validate input blob
            if (!blob || blob.size === 0) {
                console.error('[AudioHandler] Empty audio blob received');
                throw new Error('Empty audio data received');
            }

            // Log original format details
            console.log('[AudioHandler] Converting audio - Original size:', blob.size, 'Type:', blob.type);

            const arrayBuffer = await blob.arrayBuffer();
            const audioContext = new (window.AudioContext || window.webkitAudioContext)();
            
            // Validate array buffer
            if (!arrayBuffer || arrayBuffer.byteLength === 0) {
                throw new Error('Invalid audio data buffer');
            }

            const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
            
            // Validate decoded audio buffer
            if (!audioBuffer || audioBuffer.length === 0) {
                throw new Error('Failed to decode audio data');
            }

            // Convert to WAV format with enhanced validation
            const wavBlob = await this.audioBufferToWav(audioBuffer);
            
            // Validate WAV conversion result
            if (!wavBlob || wavBlob.byteLength === 0) {
                throw new Error('WAV conversion failed');
            }

            const convertedBlob = new Blob([wavBlob], { type: 'audio/wav' });
            console.log('[AudioHandler] Conversion successful - New size:', convertedBlob.size);

            return convertedBlob;
        } catch (error) {
            console.error('[AudioHandler] Error converting audio format:', error);
            throw new Error(`Audio conversion failed: ${error.message}`);
        }
    }

    audioBufferToWav(buffer) {
        const numChannels = 1;
        const sampleRate = buffer.sampleRate;
        const format = 1; // PCM
        const bitDepth = 16;

        const writeString = (view, offset, string) => {
            for (let i = 0; i < string.length; i++) {
                view.setUint8(offset + i, string.charCodeAt(i));
            }
        };

        const floatTo16BitPCM = (output, offset, input) => {
            for (let i = 0; i < input.length; i++, offset += 2) {
                const s = Math.max(-1, Math.min(1, input[i]));
                output.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
            }
        };

        const dataSize = buffer.length * 2;
        const headerSize = 44;
        const totalSize = headerSize + dataSize;
        const arrayBuffer = new ArrayBuffer(totalSize);
        const view = new DataView(arrayBuffer);

        // RIFF header
        writeString(view, 0, 'RIFF');
        view.setUint32(4, 36 + dataSize, true);
        writeString(view, 8, 'WAVE');

        // Format chunk
        writeString(view, 12, 'fmt ');
        view.setUint32(16, 16, true);
        view.setUint16(20, format, true);
        view.setUint16(22, numChannels, true);
        view.setUint32(24, sampleRate, true);
        view.setUint32(28, sampleRate * numChannels * (bitDepth / 8), true);
        view.setUint16(32, numChannels * (bitDepth / 8), true);
        view.setUint16(34, bitDepth, true);

        // Data chunk
        writeString(view, 36, 'data');
        view.setUint32(40, dataSize, true);
        floatTo16BitPCM(view, 44, buffer.getChannelData(0));

        return arrayBuffer;
    }

    async setupVoiceDetection() {
        try {
            const source = this.audioContext.createMediaStreamSource(this.stream);
            const analyser = this.audioContext.createAnalyser();
            analyser.fftSize = 2048;
            source.connect(analyser);

            const bufferLength = analyser.frequencyBinCount;
            const dataArray = new Float32Array(bufferLength);
            
            // Minimum chunk size in bytes (1KB)
            const MIN_CHUNK_SIZE = 1024;
            let isVoiceDetected = false;
            let chunkStartTime = Date.now();

            const checkVoiceActivity = async () => {
                if (!this.isRecording || !this.isContinuousMode) return;

                try {
                    analyser.getFloatTimeDomainData(dataArray);
                    const rms = Math.sqrt(dataArray.reduce((acc, val) => acc + val * val, 0) / bufferLength);
                    const db = 20 * Math.log10(rms);

                    // Voice activity detection with hysteresis
                    if (db > this.silenceThreshold) {
                        if (!isVoiceDetected) {
                            console.log('[AudioHandler] Voice activity started');
                            isVoiceDetected = true;
                            chunkStartTime = Date.now();
                        }
                        this.lastVoiceTime = Date.now();
                    } else if (isVoiceDetected && 
                             Date.now() - this.lastVoiceTime > this.silenceDuration * 1000 && 
                             !this.isProcessing) {
                        isVoiceDetected = false;
                        this.isProcessing = true;

                        try {
                            // Validate current chunk duration
                            const chunkDuration = Date.now() - chunkStartTime;
                            if (chunkDuration < 500) { // Minimum 500ms
                                console.log('[AudioHandler] Chunk too short, skipping');
                                return;
                            }

                            // Stop current recording and get the chunk
                            if (this.mediaRecorder && this.mediaRecorder.state === 'recording') {
                                console.log('[AudioHandler] Processing voice chunk');
                                this.mediaRecorder.requestData();
                                await new Promise(resolve => {
                                    this.mediaRecorder.onstop = resolve;
                                    this.mediaRecorder.stop();
                                });

                                // Validate chunk size
                                const currentChunk = new Blob(this.chunks, { type: this.mimeType });
                                if (currentChunk.size < MIN_CHUNK_SIZE) {
                                    console.log('[AudioHandler] Chunk too small, skipping');
                                    this.chunks = [];
                                    return;
                                }

                                // Create new MediaRecorder for next chunk
                                await this.cleanup();
                                await this.createMediaRecorder();
                                this.mediaRecorder.start(1000);
                                console.log('[AudioHandler] New recording started');
                            }
                        } catch (error) {
                            console.error('[AudioHandler] Error processing voice chunk:', error);
                            await this.cleanup();
                            await this.createMediaRecorder();
                            this.mediaRecorder.start(1000);
                        } finally {
                            this.isProcessing = false;
                        }
                    }
                } catch (error) {
                    console.error('[AudioHandler] Error in voice detection:', error);
                }
            };

            this.voiceDetectionInterval = setInterval(checkVoiceActivity, 100);
            console.log('[AudioHandler] Voice detection setup completed');
        } catch (error) {
            console.error('[AudioHandler] Error setting up voice detection:', error);
            throw new Error(`Failed to initialize voice detection: ${error.message}`);
        }
    }

    async stopRecording() {
        if (!this.mediaRecorder || this.mediaRecorder.state === 'inactive') {
            return null;
        }

        try {
            this.mediaRecorder.stop();
            this.isRecording = false;

            const audioBlob = await new Promise((resolve) => {
                this.mediaRecorder.onstop = async () => {
                    const blob = await this.convertToCompatibleFormat(
                        new Blob(this.chunks, { type: this.mimeType })
                    );
                    resolve(blob);
                };
            });

            await this.cleanup();
            return audioBlob;
        } catch (error) {
            throw this.formatError(error);
        }
    }

    async cleanup() {
        if (this.voiceDetectionInterval) {
            clearInterval(this.voiceDetectionInterval);
            this.voiceDetectionInterval = null;
        }

        if (this.stream) {
            this.stream.getTracks().forEach(track => track.stop());
        }

        if (this.audioContext && this.audioContext.state !== 'closed') {
            await this.audioContext.close();
        }

        this.mediaRecorder = null;
        this.stream = null;
        this.chunks = [];
        this.isRecording = false;
        this.isWaitingForResponse = false;
    }

    async playAudio(audioDataUrl) {
        try {
            const audio = new Audio(audioDataUrl);

            await new Promise((resolve, reject) => {
                audio.oncanplay = async () => {
                    try {
                        await audio.play();
                        this.isWaitingForResponse = false;

                        if (this.isContinuousMode) {
                            await this.startRecording(true);
                        }
                    } catch (error) {
                        reject(error);
                    }
                };

                audio.onended = () => {
                    if (typeof this.onBotResponseEnd === 'function') {
                        this.onBotResponseEnd();
                    }
                    resolve();
                };

                audio.onerror = () => reject(new Error('Audio playback failed'));
            });

            return true;
        } catch (error) {
            throw this.formatError(error);
        }
    }

    setSpeechEndCallback(callback) {
        this.onSpeechEnd = callback;
    }

    setBotResponseEndCallback(callback) {
        this.onBotResponseEnd = callback;
    }

    formatError(error) {
        const errorMessages = {
            'NotAllowedError': 'Microphone access denied. Please grant microphone permissions.',
            'NotFoundError': 'No microphone found. Please check your audio input devices.',
            'NotReadableError': 'Could not access microphone. Please check if another application is using it.',
            'SecurityError': 'Security error occurred. Please ensure you\'re using HTTPS.',
            'AbortError': 'Recording was aborted. Please try again.',
        };

        return errorMessages[error.name] || `An error occurred: ${error.message}`;
    }
}

export default AudioHandler;