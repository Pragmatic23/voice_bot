class AudioHandler {
    constructor() {
        this.mediaRecorder = null;
        this.audioChunks = [];
        this.isRecording = false;
        this.stream = null;
        this.maxRetries = 3;
        this.retryDelay = 1000; // 1 second
        this.retryCount = 0;
        this.minAudioSize = 1024; // 1KB minimum audio size
        this.maxAudioSize = 10 * 1024 * 1024; // 10MB maximum audio size
        this.sampleRate = 44100;
        this.channelCount = 1;
    }

    async startRecording() {
        const startTime = performance.now();
        console.log('[AudioHandler] Initializing audio recording...');
        
        try {
            // Stop any existing streams
            console.log('[AudioHandler] Cleaning up previous recording session...');
            await this.cleanup();
            
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
            const audioTracks = this.stream.getAudioTracks();
            console.log(`[AudioHandler] Microphone access granted with ${audioTracks.length} audio tracks`);
            audioTracks.forEach(track => {
                const settings = track.getSettings();
                console.log('[AudioHandler] Track settings:', {
                    deviceId: settings.deviceId,
                    sampleRate: settings.sampleRate,
                    channelCount: settings.channelCount,
                    autoGainControl: settings.autoGainControl,
                    echoCancellation: settings.echoCancellation,
                    noiseSuppression: settings.noiseSuppression
                });
            });
            
            // Create and configure MediaRecorder with enhanced settings
            console.log('[AudioHandler] Configuring MediaRecorder with optimal settings...');
            
            // Define supported MIME types in order of preference
            const supportedMimeTypes = [
                'audio/webm;codecs=opus',
                'audio/webm',
                'audio/ogg;codecs=opus',
                'audio/ogg'
            ];
            
            // Find the first supported MIME type
            const mimeType = supportedMimeTypes.find(type => MediaRecorder.isTypeSupported(type));
            if (!mimeType) {
                throw new Error('None of the preferred audio formats are supported by your browser');
            }
            
            console.log(`[AudioHandler] Using MIME type: ${mimeType}`);
            
            const options = {
                mimeType: mimeType,
                audioBitsPerSecond: 128000, // 128kbps for good quality
                bitsPerSecond: 128000
            };
            
            // Configure audio context for proper format
            const audioContext = new (window.AudioContext || window.webkitAudioContext)();
            const source = audioContext.createMediaStreamSource(this.stream);
            const destination = audioContext.createMediaStreamDestination();
            
            // Add audio processing node for proper format
            const scriptNode = audioContext.createScriptProcessor(4096, 1, 1);
            source.connect(scriptNode);
            scriptNode.connect(destination);
            
            this.mediaRecorder = new MediaRecorder(destination.stream, options);
            this.audioChunks = [];
            
            this.mediaRecorder.ondataavailable = (event) => {
                if (event.data.size > 0) {
                    const chunkSize = event.data.size;
                    console.log(`[AudioHandler] Audio chunk received: ${chunkSize} bytes`);
                    
                    // Detailed chunk validation
                    if (chunkSize > this.maxAudioSize) {
                        console.error(`[AudioHandler] Audio chunk size (${chunkSize} bytes) exceeds maximum limit of ${this.maxAudioSize} bytes`);
                        this.cleanup();
                        throw new Error('Recording too large. Please keep your message shorter.');
                    }
                    
                    if (chunkSize < 1000) {
                        console.warn(`[AudioHandler] Small audio chunk detected: ${chunkSize} bytes`);
                    }
                    
                    const totalSize = this.audioChunks.reduce((acc, chunk) => acc + chunk.size, 0) + chunkSize;
                    console.log(`[AudioHandler] Total recording size: ${totalSize} bytes`);
                    this.audioChunks.push(event.data);
                }
            };

            this.mediaRecorder.onerror = (error) => {
                console.error('[AudioHandler] MediaRecorder error:', error);
                this.cleanup();
                throw new Error('Recording failed: ' + error.message);
            };

            // Add state change monitoring
            this.mediaRecorder.onstart = () => {
                console.log('[AudioHandler] Recording started successfully');
                this.isRecording = true;
            };

            this.mediaRecorder.onstop = () => {
                console.log('[AudioHandler] Recording stopped');
                this.isRecording = false;
            };

            this.mediaRecorder.start(1000); // Collect data in 1-second chunks
            console.log(`[AudioHandler] Recording initialized in ${(performance.now() - startTime).toFixed(2)}ms`);
            
            return true;
        } catch (error) {
            await this.cleanup();
            console.error('[AudioHandler] Error starting recording:', error);
            
            // Implement retry mechanism
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
            console.log('[AudioHandler] Attempting to stop recording...');
            try {
                if (!this.mediaRecorder || this.mediaRecorder.state === 'inactive') {
                    throw new Error('No active recording found');
                }

                // Set up event handlers with timeout
                const stopTimeout = setTimeout(() => {
                    reject(new Error('Recording stop timeout - took too long to process'));
                    this.cleanup();
                }, 5000); // 5 second timeout

                this.mediaRecorder.onstop = async () => {
                    try {
                        clearTimeout(stopTimeout);
                        
                        // Validate audio data
                        const totalSize = this.audioChunks.reduce((size, chunk) => size + chunk.size, 0);
                        console.log(`[AudioHandler] Total audio size: ${totalSize} bytes`);
                        
                        if (totalSize < this.minAudioSize) {
                            throw new Error('Recording too short or empty. Please try again.');
                        }
                        
                        if (totalSize > this.maxAudioSize) {
                            throw new Error('Recording too large. Please keep your message shorter.');
                        }

                        // Create audio blob with proper codec
                        const audioBlob = new Blob(this.audioChunks, { 
                            type: this.mediaRecorder.mimeType
                        });

                        // Verify blob was created successfully
                        if (!audioBlob || audioBlob.size === 0) {
                            throw new Error('Failed to create audio blob');
                        }

                        console.log(`[AudioHandler] Successfully created audio blob: ${audioBlob.size} bytes`);
                        await this.cleanup();
                        resolve(audioBlob);
                    } catch (error) {
                        console.error('[AudioHandler] Error in stop handler:', error);
                        reject(error);
                    }
                };

                // Add error handler specifically for stop operation
                this.mediaRecorder.onerror = (error) => {
                    clearTimeout(stopTimeout);
                    console.error('[AudioHandler] Error while stopping recording:', error);
                    reject(new Error('Failed to stop recording: ' + error.message));
                };

                console.log('[AudioHandler] Stopping MediaRecorder...');
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
            // Stop all media tracks with verification
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

            // Reset MediaRecorder with safety checks
            if (this.mediaRecorder) {
                if (this.mediaRecorder.state !== 'inactive') {
                    try {
                        console.log('[AudioHandler] Stopping active MediaRecorder...');
                        this.mediaRecorder.stop();
                    } catch (error) {
                        console.warn('[AudioHandler] Error stopping MediaRecorder:', error);
                    }
                }
                this.mediaRecorder = null;
            }

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
            // Validate audio data
            if (!audioData || typeof audioData !== 'string') {
                throw new Error('Invalid audio data received');
            }

            const audio = new Audio(audioData);
            
            // Add error handling for audio loading
            audio.onerror = (error) => {
                console.error('[AudioHandler] Error loading audio:', error);
                throw new Error('Failed to load audio response');
            };

            // Add event listeners for better monitoring
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
        
        // Enhanced error messages with more specific cases
        const errorMessages = {
            'NotAllowedError': 'Microphone access denied. Please allow microphone access in your browser settings to use this feature.',
            'NotFoundError': 'No microphone found. Please ensure your microphone is properly connected and not disabled.',
            'NotReadableError': 'Cannot access microphone. Please ensure no other application is using it and try restarting your browser.',
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
