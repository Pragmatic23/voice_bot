// Enhanced AudioHandler class
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
        this.silenceDuration = 1.0; // 1 second of silence to trigger end
        this.lastVoiceTime = 0;
        this.voiceDetectionInterval = null;
        this.onSpeechEnd = null;
        this.onBotResponseEnd = null;
        this.isWaitingForResponse = false;
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
                    sampleRate: 44100,
                    channelCount: 1,
                    echoCancellation: true,
                    noiseSuppression: true,
                    autoGainControl: true
                }
            };

            this.stream = await navigator.mediaDevices.getUserMedia(constraints);
            this.chunks = [];

            this.mediaRecorder = new MediaRecorder(this.stream, {
                mimeType: 'audio/wav'
            });

            this.setupRecordingHandlers();

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

    setupRecordingHandlers() {
        this.mediaRecorder.ondataavailable = (event) => {
            if (event.data.size > 0) {
                this.chunks.push(event.data);
            }
        };

        this.mediaRecorder.onstop = async () => {
            if (this.chunks.length > 0) {
                const audioBlob = new Blob(this.chunks, { type: 'audio/wav' });
                this.chunks = [];

                if (typeof this.onSpeechEnd === 'function' && !this.isWaitingForResponse) {
                    this.isWaitingForResponse = true;
                    await this.onSpeechEnd(audioBlob);
                }
            }
        };
    }

    async setupVoiceDetection() {
        try {
            const source = this.audioContext.createMediaStreamSource(this.stream);
            const analyser = this.audioContext.createAnalyser();
            analyser.fftSize = 2048;
            source.connect(analyser);

            const bufferLength = analyser.frequencyBinCount;
            const dataArray = new Float32Array(bufferLength);

            const checkVoiceActivity = () => {
                if (!this.isRecording || !this.isContinuousMode) return;

                analyser.getFloatTimeDomainData(dataArray);
                const rms = Math.sqrt(dataArray.reduce((acc, val) => acc + val * val, 0) / bufferLength);
                const db = 20 * Math.log10(rms);

                if (db > this.silenceThreshold) {
                    this.lastVoiceTime = Date.now();
                } else if (Date.now() - this.lastVoiceTime > this.silenceDuration * 1000 && !this.isProcessing) {
                    this.isProcessing = true;
                    this.mediaRecorder.requestData();
                    this.mediaRecorder.stop();

                    // Start new recording session immediately
                    this.chunks = [];
                    this.mediaRecorder.start(1000);
                    this.isProcessing = false;
                }
            };

            this.voiceDetectionInterval = setInterval(checkVoiceActivity, 100);
        } catch (error) {
            console.error('Error setting up voice detection:', error);
            throw new Error('Failed to initialize voice detection');
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
                this.mediaRecorder.onstop = () => {
                    const blob = new Blob(this.chunks, { type: 'audio/webm;codecs=opus' });
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
                            // Resume recording after bot response
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