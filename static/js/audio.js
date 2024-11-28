class AudioHandler {
    constructor() {
        this.mediaRecorder = null;
        this.stream = null;
        this.chunks = [];
        this.isRecording = false;
        this.maxAudioSize = 10 * 1024 * 1024; // 10MB maximum audio size
        this.sampleRate = 44100;
        this.channelCount = 1;
        this.isContinuousMode = false;
        this.audioContext = null;
        this.silenceThreshold = -50; // dB threshold for silence
        this.silenceDuration = 1.5; // seconds of silence to trigger stop
        this.lastVoiceTime = 0;
        this.voiceDetectionInterval = null;
        this.onSpeechEnd = null;
    }

    async startRecording(continuous = false) {
        const startTime = performance.now();
        console.log('[AudioHandler] Initializing audio recording...');
        this.isContinuousMode = continuous;
        
        try {
            // Stop any existing streams
            console.log('[AudioHandler] Cleaning up previous recording session...');
            await this.cleanup();
            
            // Initialize AudioContext for voice detection if in continuous mode
            if (continuous) {
                this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
            }
            
            // Request microphone access with specific constraints
            console.log('[AudioHandler] Requesting microphone access with quality settings...');
            const constraints = {
                audio: {
                    sampleRate: this.sampleRate,
                    channelCount: this.channelCount,
                    echoCancellation: true,
                    noiseSuppression: true,
                    autoGainControl: true
                }
            };
            
            console.log('[AudioHandler] Audio constraints:', JSON.stringify(constraints.audio));
            this.stream = await navigator.mediaDevices.getUserMedia(constraints);
            
            // Log track information
            const audioTracks = this.stream.getAudioTracks();
            console.log(`[AudioHandler] Microphone access granted with ${audioTracks.length} audio tracks`);
            
            if (audioTracks.length > 0) {
                const settings = audioTracks[0].getSettings();
                console.log('[AudioHandler] Track settings:', settings);
            }
            
            // Configure MediaRecorder
            console.log('[AudioHandler] Configuring MediaRecorder with optimal settings...');
            this.chunks = [];
            this.mediaRecorder = new MediaRecorder(this.stream, {
                mimeType: 'audio/webm;codecs=opus'
            });
            
            // Set up event handlers
            this.mediaRecorder.ondataavailable = (event) => {
                if (event.data.size > 0) {
                    console.log(`[AudioHandler] Audio chunk received: ${event.data.size} bytes`);
                    this.chunks.push(event.data);
                    const totalSize = this.chunks.reduce((size, chunk) => size + chunk.size, 0);
                    console.log(`[AudioHandler] Total recording size: ${totalSize} bytes`);
                    
                    if (totalSize > this.maxAudioSize) {
                        console.log('[AudioHandler] Maximum audio size exceeded, stopping recording');
                        this.stopRecording();
                    }
                }
            };
            
            // Start recording
            this.isRecording = true;
            this.mediaRecorder.start(1000); // Collect data in 1-second chunks
            console.log(`[AudioHandler] Recording initialized in ${(performance.now() - startTime).toFixed(2)}ms`);
            
            if (continuous) {
                await this.setupVoiceDetection();
            }
            
            return true;
        } catch (error) {
            await this.cleanup();
            console.error('[AudioHandler] Error starting recording:', error);
            throw this.formatError(error);
        }
    }

    async stopRecording() {
        console.log('[AudioHandler] Attempting to stop recording...');
        
        if (!this.mediaRecorder || this.mediaRecorder.state === 'inactive') {
            console.log('[AudioHandler] No active recording to stop');
            return null;
        }
        
        try {
            console.log('[AudioHandler] Stopping MediaRecorder...');
            this.mediaRecorder.stop();
            this.isRecording = false;
            
            // Wait for the final chunk and create blob
            const audioBlob = await new Promise((resolve) => {
                this.mediaRecorder.onstop = () => {
                    const totalSize = this.chunks.reduce((size, chunk) => size + chunk.size, 0);
                    console.log(`[AudioHandler] Total audio size: ${totalSize} bytes`);
                    
                    const blob = new Blob(this.chunks, { type: 'audio/webm;codecs=opus' });
                    console.log(`[AudioHandler] Successfully created audio blob: ${blob.size} bytes`);
                    resolve(blob);
                };
            });
            
            await this.cleanup();
            return audioBlob;
        } catch (error) {
            console.error('[AudioHandler] Error stopping recording:', error);
            throw this.formatError(error);
        }
    }

    async cleanup() {
        console.log('[AudioHandler] Starting cleanup process...');
        
        try {
            if (this.stream) {
                const tracks = this.stream.getTracks();
                console.log(`[AudioHandler] Stopping ${tracks.length} media tracks...`);
                
                tracks.forEach(track => {
                    track.stop();
                    console.log(`[AudioHandler] Successfully stopped track: ${track.kind}`);
                });
            }
            
            if (this.voiceDetectionInterval) {
                clearInterval(this.voiceDetectionInterval);
                this.voiceDetectionInterval = null;
            }
            
            if (this.audioContext) {
                await this.audioContext.close();
                this.audioContext = null;
            }
            
            this.mediaRecorder = null;
            this.stream = null;
            this.chunks = [];
            this.isRecording = false;
            
            console.log('[AudioHandler] Cleanup completed successfully');
        } catch (error) {
            console.error('[AudioHandler] Error during cleanup:', error);
            throw this.formatError(error);
        }
    }

    async playAudio(audioDataUrl) {
        console.log('[AudioHandler] Attempting to play audio...');
        
        try {
            const audio = new Audio(audioDataUrl);
            console.log('[AudioHandler] Audio loading started');
            
            await new Promise((resolve, reject) => {
                audio.oncanplay = () => {
                    console.log('[AudioHandler] Audio ready to play');
                    audio.play()
                        .then(() => console.log('[AudioHandler] Audio playback started successfully'))
                        .catch(reject);
                };
                
                audio.onended = () => {
                    console.log('[AudioHandler] Audio playback completed');
                    resolve();
                };
                
                audio.onerror = () => reject(new Error('Audio playback failed'));
            });
            
            return true;
        } catch (error) {
            console.error('[AudioHandler] Error playing audio:', error);
            throw this.formatError(error);
        }
    }

    async setupVoiceDetection() {
        try {
            const audioSource = this.audioContext.createMediaStreamSource(this.stream);
            const analyser = this.audioContext.createAnalyser();
            analyser.fftSize = 2048;
            audioSource.connect(analyser);

            const bufferLength = analyser.frequencyBinCount;
            const dataArray = new Float32Array(bufferLength);

            // Start monitoring voice activity
            this.voiceDetectionInterval = setInterval(() => {
                analyser.getFloatFrequencyData(dataArray);
                
                // Calculate average volume level
                const average = dataArray.reduce((sum, value) => sum + value, 0) / bufferLength;
                
                if (average > this.silenceThreshold) {
                    this.lastVoiceTime = Date.now();
                } else if (this.lastVoiceTime && Date.now() - this.lastVoiceTime > this.silenceDuration * 1000) {
                    // Stop recording if silence duration exceeded
                    if (this.isRecording && typeof this.onSpeechEnd === 'function') {
                        clearInterval(this.voiceDetectionInterval);
                        this.onSpeechEnd();
                    }
                }
            }, 100);

        } catch (error) {
            console.error('[AudioHandler] Error setting up voice detection:', error);
            throw new Error('Failed to initialize voice detection');
        }
    }

    setSpeechEndCallback(callback) {
        this.onSpeechEnd = callback;
    }

    formatError(error) {
        const errorMessages = {
            'NotAllowedError': 'Microphone access denied. Please grant microphone permissions.',
            'NotFoundError': 'No microphone found. Please check your audio input devices.',
            'NotReadableError': 'Could not access microphone. Please check if another application is using it.',
            'AbortError': 'Recording was aborted. Please try again.',
            'SecurityError': 'Security error occurred. Please ensure you\'re using HTTPS and have granted necessary permissions.',
            'TypeError': 'Audio format not supported. Please try updating your browser.',
            'InvalidStateError': 'Invalid recorder state. Please refresh the page and try again.',
            'UnknownError': 'An unexpected error occurred. Please try refreshing the page.'
        };

        const errorName = error.name || 'UnknownError';
        const customMessage = errorMessages[errorName];
        
        if (customMessage) {
            console.log(`[AudioHandler] Mapped error "${errorName}" to custom message`);
            return customMessage;
        }

        console.log('[AudioHandler] Using generic error message');
        return 'An error occurred while processing audio: ' + error.message;
    }
}

export default AudioHandler;