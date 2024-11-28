class AudioHandler {
    constructor() {
        this.mediaRecorder = null;
        this.audioChunks = [];
        this.isRecording = false;
        this.stream = null;
        this.socket = null;
        this.maxRetries = 3;
        this.retryDelay = 1000;
        this.retryCount = 0;
        this.minAudioSize = 1024;
        this.maxAudioSize = 10 * 1024 * 1024;
        this.sampleRate = 44100;
        this.channelCount = 1;
        this.initWebSocket();
    }

    initWebSocket() {
        try {
            // Load Socket.IO client library dynamically
            const script = document.createElement('script');
            script.src = 'https://cdn.socket.io/4.7.2/socket.io.min.js';
            script.onload = () => this.setupSocketConnection();
            script.onerror = (error) => {
                console.error('[AudioHandler] Failed to load Socket.IO:', error);
                document.dispatchEvent(new CustomEvent('audio_error', {
                    detail: 'Failed to initialize audio system. Please refresh the page.'
                }));
            };
            document.head.appendChild(script);
        } catch (error) {
            console.error('[AudioHandler] Failed to initialize WebSocket:', error);
            document.dispatchEvent(new CustomEvent('audio_error', {
                detail: 'Connection initialization failed. Please refresh the page.'
            }));
        }
    }

    setupSocketConnection() {
        try {
            this.socket = io(window.location.origin, {
                transports: ['websocket'],
                reconnectionAttempts: this.maxRetries,
                reconnectionDelay: this.retryDelay,
                timeout: 10000
            });

            this.socket.on('connect', () => {
                console.log('[AudioHandler] WebSocket connection established');
                this.retryCount = 0;
            });

            this.socket.on('connection_established', (data) => {
                console.log('[AudioHandler] Server acknowledged connection:', data);
            });

            this.socket.on('transcription', (data) => {
                console.log('[AudioHandler] Received transcription:', data);
                document.dispatchEvent(new CustomEvent('transcription', { detail: data }));
            });

            this.socket.on('audio_response', (data) => {
                if (data.audio) {
                    this.playAudio(data.audio);
                }
            });

            this.socket.on('error', (error) => {
                console.error('[AudioHandler] Server error:', error);
                document.dispatchEvent(new CustomEvent('audio_error', { 
                    detail: error.message || 'Server error occurred'
                }));
            });

            this.socket.on('disconnect', (reason) => {
                console.log(`[AudioHandler] WebSocket disconnected: ${reason}`);
                if (reason === 'io server disconnect') {
                    this.socket.connect();
                }
            });

            this.socket.on('connect_error', (error) => {
                console.error('[AudioHandler] Connection error:', error);
                if (this.retryCount < this.maxRetries) {
                    this.retryCount++;
                    console.log(`[AudioHandler] Attempting to reconnect (${this.retryCount}/${this.maxRetries})`);
                } else {
                    document.dispatchEvent(new CustomEvent('audio_error', {
                        detail: 'Failed to connect to server. Please refresh the page.'
                    }));
                }
            });
        } catch (error) {
            console.error('[AudioHandler] Socket setup error:', error);
            document.dispatchEvent(new CustomEvent('audio_error', {
                detail: 'Failed to setup connection. Please refresh the page.'
            }));
        }
    }

    async startRecording() {
        console.log('[AudioHandler] Initializing audio recording...');
        
        try {
            await this.cleanup();
            
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
            
            this.stream = await navigator.mediaDevices.getUserMedia(constraints);
            const audioTracks = this.stream.getAudioTracks();
            console.log(`[AudioHandler] Microphone access granted with ${audioTracks.length} audio tracks`);
            
            const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus') 
                ? 'audio/webm;codecs=opus' 
                : 'audio/webm';
            
            const options = {
                mimeType: mimeType,
                audioBitsPerSecond: 128000
            };
            
            this.mediaRecorder = new MediaRecorder(this.stream, options);
            this.audioChunks = [];
            
            this.mediaRecorder.ondataavailable = async (event) => {
                if (event.data.size > 0) {
                    if (this.socket && this.socket.connected) {
                        // Convert Blob to ArrayBuffer for Socket.IO
                        const arrayBuffer = await event.data.arrayBuffer();
                        this.socket.emit('audio_stream', arrayBuffer);
                    } else {
                        console.warn('[AudioHandler] Socket not connected, buffering chunk');
                        this.audioChunks.push(event.data);
                    }
                }
            };

            this.mediaRecorder.onerror = (error) => {
                console.error('[AudioHandler] MediaRecorder error:', error);
                this.cleanup();
                throw new Error('Recording failed: ' + error.message);
            };

            this.mediaRecorder.onstart = () => {
                console.log('[AudioHandler] Recording started successfully');
                this.isRecording = true;
            };

            this.mediaRecorder.onstop = () => {
                console.log('[AudioHandler] Recording stopped');
                this.isRecording = false;
            };

            this.mediaRecorder.start(100);
            return true;
        } catch (error) {
            await this.cleanup();
            console.error('[AudioHandler] Error starting recording:', error);
            
            if (this.retryCount < this.maxRetries) {
                this.retryCount++;
                console.log(`[AudioHandler] Retrying recording (Attempt ${this.retryCount}/${this.maxRetries})...`);
                await new Promise(resolve => setTimeout(resolve, this.retryDelay));
                return this.startRecording();
            }
            
            this.retryCount = 0;
            throw new Error(this.getReadableErrorMessage(error));
        }
    }

    async stopRecording() {
        return new Promise(async (resolve, reject) => {
            try {
                if (!this.mediaRecorder || this.mediaRecorder.state === 'inactive') {
                    throw new Error('No active recording found');
                }

                const stopTimeout = setTimeout(() => {
                    reject(new Error('Recording stop timeout'));
                    this.cleanup();
                }, 5000);

                this.mediaRecorder.onstop = async () => {
                    try {
                        clearTimeout(stopTimeout);
                        await this.cleanup();
                        resolve(true);
                    } catch (error) {
                        console.error('[AudioHandler] Error in stop handler:', error);
                        reject(error);
                    }
                };

                this.mediaRecorder.stop();
                this.isRecording = false;
            } catch (error) {
                console.error('[AudioHandler] Error in stopRecording:', error);
                await this.cleanup();
                reject(new Error('Failed to stop recording: ' + error.message));
            }
        });
    }

    async cleanup() {
        console.log('[AudioHandler] Starting cleanup process...');
        try {
            if (this.stream) {
                const tracks = this.stream.getTracks();
                console.log(`[AudioHandler] Stopping ${tracks.length} media tracks...`);
                
                await Promise.all(tracks.map(async (track) => {
                    try {
                        track.stop();
                        console.log(`[AudioHandler] Successfully stopped track: ${track.kind}`);
                    } catch (error) {
                        console.warn(`[AudioHandler] Error stopping track ${track.kind}:`, error);
                    }
                }));
                
                this.stream = null;
            }

            if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
                try {
                    this.mediaRecorder.stop();
                } catch (error) {
                    console.warn('[AudioHandler] Error stopping MediaRecorder:', error);
                }
            }
            this.mediaRecorder = null;
            this.audioChunks = [];
            this.isRecording = false;
            this.retryCount = 0;
            
            console.log('[AudioHandler] Cleanup completed successfully');
        } catch (error) {
            console.error('[AudioHandler] Error during cleanup:', error);
            throw new Error('Failed to cleanup recording resources: ' + error.message);
        }
    }

    async playAudio(audioData) {
        console.log('[AudioHandler] Attempting to play audio...');
        try {
            if (!audioData || typeof audioData !== 'string') {
                throw new Error('Invalid audio data received');
            }

            const audio = new Audio(audioData);
            
            audio.onerror = (error) => {
                console.error('[AudioHandler] Error loading audio:', error);
                throw new Error('Failed to load audio response');
            };

            audio.onloadstart = () => console.log('[AudioHandler] Audio loading started');
            audio.oncanplay = () => console.log('[AudioHandler] Audio ready to play');
            audio.onended = () => console.log('[AudioHandler] Audio playback completed');

            await audio.play();
            console.log('[AudioHandler] Audio playback started successfully');
        } catch (error) {
            console.error('[AudioHandler] Error playing audio:', error);
            throw new Error('Failed to play audio response: ' + this.getReadableErrorMessage(error));
        }
    }

    getReadableErrorMessage(error) {
        console.log('[AudioHandler] Formatting error message for:', error);
        
        const errorMessages = {
            'NotAllowedError': 'Microphone access denied. Please allow microphone access in your browser settings.',
            'NotFoundError': 'No microphone found. Please ensure your microphone is properly connected.',
            'NotReadableError': 'Cannot access microphone. Please ensure no other application is using it.',
            'AbortError': 'Recording was aborted. Please try again.',
            'SecurityError': 'Security error occurred. Please ensure you\'re using HTTPS.',
            'TypeError': 'Audio format not supported. Please update your browser.',
            'InvalidStateError': 'Invalid recorder state. Please refresh the page.',
            'UnknownError': 'An unexpected error occurred. Please try refreshing the page.'
        };

        const errorName = error.name || 'UnknownError';
        return errorMessages[errorName] || 'An error occurred while processing audio: ' + error.message;
    }
}

export default AudioHandler;
