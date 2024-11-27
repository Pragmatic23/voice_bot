class AudioHandler {
    constructor() {
        this.mediaRecorder = null;
        this.audioChunks = [];
        this.isRecording = false;
        this.stream = null;
        this.maxRetries = 3;
        this.retryDelay = 1000; // 1 second
    }

    async startRecording() {
        try {
            // Stop any existing streams
            await this.cleanup();
            
            // Request microphone access
            this.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            
            // Create and configure MediaRecorder
            this.mediaRecorder = new MediaRecorder(this.stream, {
                mimeType: 'audio/webm;codecs=opus'
            });

            this.audioChunks = [];
            
            this.mediaRecorder.ondataavailable = (event) => {
                if (event.data.size > 0) {
                    this.audioChunks.push(event.data);
                }
            };

            this.mediaRecorder.onerror = (error) => {
                console.error('MediaRecorder error:', error);
                this.cleanup();
                throw new Error('Recording failed: ' + error.message);
            };

            this.mediaRecorder.start();
            this.isRecording = true;
            
            return true;
        } catch (error) {
            await this.cleanup();
            console.error('Error starting recording:', error);
            throw new Error(this.getReadableErrorMessage(error));
        }
    }

    async stopRecording() {
        return new Promise(async (resolve, reject) => {
            try {
                if (!this.mediaRecorder || this.mediaRecorder.state === 'inactive') {
                    throw new Error('No active recording found');
                }

                // Set up event handlers
                this.mediaRecorder.onstop = async () => {
                    try {
                        const audioBlob = new Blob(this.audioChunks, { type: 'audio/webm;codecs=opus' });
                        await this.cleanup();
                        resolve(audioBlob);
                    } catch (error) {
                        reject(error);
                    }
                };

                this.mediaRecorder.stop();
                this.isRecording = false;
            } catch (error) {
                await this.cleanup();
                reject(new Error('Failed to stop recording: ' + error.message));
            }
        });
    }

    async cleanup() {
        // Stop all media tracks
        if (this.stream) {
            this.stream.getTracks().forEach(track => track.stop());
            this.stream = null;
        }

        // Reset MediaRecorder
        if (this.mediaRecorder) {
            if (this.mediaRecorder.state !== 'inactive') {
                try {
                    this.mediaRecorder.stop();
                } catch (error) {
                    console.warn('Error stopping MediaRecorder:', error);
                }
            }
            this.mediaRecorder = null;
        }

        this.audioChunks = [];
        this.isRecording = false;
    }

    async playAudio(audioData) {
        try {
            const audio = new Audio(audioData);
            await audio.play();
        } catch (error) {
            console.error('Error playing audio:', error);
            throw new Error('Failed to play audio response');
        }
    }

    getReadableErrorMessage(error) {
        if (error.name === 'NotAllowedError') {
            return 'Microphone access denied. Please allow microphone access to use this feature.';
        } else if (error.name === 'NotFoundError') {
            return 'No microphone found. Please ensure your microphone is properly connected.';
        } else if (error.name === 'NotReadableError') {
            return 'Cannot access microphone. Please ensure no other application is using it.';
        }
        return 'An error occurred while accessing the microphone: ' + error.message;
    }
}

export default new AudioHandler();
