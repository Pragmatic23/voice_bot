import audioHandler from './audio.js';

class ChatInterface {
    constructor() {
        this.recordButton = document.getElementById('recordButton');
        this.chatWindow = document.getElementById('chatWindow');
        this.resetButton = document.getElementById('resetButton');
        this.categoryGrid = document.getElementById('categoryGrid');
        this.chatInterface = document.getElementById('chatInterface');
        this.backButton = document.getElementById('backButton');
        this.selectedCategoryText = document.getElementById('selectedCategory');
        this.currentCategory = '';
        
        this.setupEventListeners();
    }

    setupEventListeners() {
        // Record button events for both mouse and touch
        ['mousedown', 'touchstart'].forEach(event => {
            this.recordButton.addEventListener(event, (e) => {
                e.preventDefault();
                this.startRecording();
            });
        });

        ['mouseup', 'touchend'].forEach(event => {
            this.recordButton.addEventListener(event, (e) => {
                e.preventDefault();
                this.stopRecording();
            });
        });

        // Other button events
        this.resetButton.addEventListener('click', () => this.resetSession());
        this.backButton.addEventListener('click', () => this.showCategorySelection());
        
        // End session button
        document.getElementById('endSessionButton').addEventListener('click', () => {
            this.resetSession();
            this.showCategorySelection();
        });

        // Add click and touch handlers for category cards
        const categoryCards = document.querySelectorAll('.category-card');
        categoryCards.forEach(card => {
            ['click', 'touchend'].forEach(event => {
                card.addEventListener(event, (e) => {
                    e.preventDefault();
                    this.selectCategory(card);
                });
            });
        });
    }

    selectCategory(card) {
        this.currentCategory = card.dataset.category;
        this.selectedCategoryText.textContent = card.querySelector('h3').textContent;
        this.categoryGrid.classList.add('d-none');
        this.chatInterface.classList.remove('d-none');
    }

    showCategorySelection() {
        this.categoryGrid.classList.remove('d-none');
        this.chatInterface.classList.add('d-none');
        this.resetSession();
    }

    async startRecording() {
        try {
            // Check if browser supports audio recording
            if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
                throw new Error('Your browser does not support audio recording');
            }

            this.recordButton.classList.add('recording');
            await audioHandler.startRecording();
        } catch (error) {
            const errorMessage = error.name === 'NotAllowedError' 
                ? 'Microphone access denied. Please grant microphone permissions to use this feature.'
                : error.message || 'Error accessing microphone';
            
            this.showError(errorMessage);
            this.recordButton.classList.remove('recording');
            console.error('Recording error:', error);
        }
    }

    async stopRecording() {
        try {
            if (!audioHandler.isRecording) {
                throw new Error('No active recording session');
            }

            this.recordButton.classList.remove('recording');
            const audioBlob = await audioHandler.stopRecording();
            
            if (!audioBlob || audioBlob.size === 0) {
                throw new Error('No audio data recorded');
            }

            await this.processAudio(audioBlob);
        } catch (error) {
            this.showError(error.message || 'Error stopping recording');
            console.error('Stop recording error:', error);
        }
    }

    async processAudio(audioBlob) {
        if (!audioBlob) {
            this.showError('No audio recorded. Please try again.');
            return;
        }

        // Validate audio size
        const maxSize = 25 * 1024 * 1024; // 25MB
        if (audioBlob.size > maxSize) {
            this.showError('Audio recording is too long. Please keep it under 1 minute.');
            return;
        }

        const formData = new FormData();
        formData.append('audio', audioBlob);
        formData.append('category', this.currentCategory);

        try {
            this.showProcessingMessage();
            const response = await fetch('/process-audio', {
                method: 'POST',
                body: formData
            });

            const data = await response.json();
            
            if (!response.ok) {
                throw new Error(data.error || 'An error occurred while processing the audio');
            }

            if (!data.text || !data.response || !data.audio) {
                throw new Error('Invalid response format from server');
            }

            this.removeProcessingMessage();
            this.updateChatWindow(data.text, data.response);
            await this.playAudioResponse(data.audio);
        } catch (error) {
            this.removeProcessingMessage();
            console.error('Error processing audio:', error);
            this.showError(this.formatErrorMessage(error.message));
        }
    }

    formatErrorMessage(message) {
        const errorMap = {
            'No audio file provided': 'Please record some audio before submitting.',
            'Audio file size exceeds': 'The recording is too long. Please keep it shorter.',
            'Unsupported audio format': 'This audio format is not supported. Please try again.',
            'Failed to transcribe': 'Could not understand the audio. Please speak clearly and try again.',
            'Failed to generate response': 'Could not generate a response. Please try again.',
            'Failed to convert text to speech': 'Could not generate audio response. Please try again.'
        };

        for (const [key, value] of Object.entries(errorMap)) {
            if (message.includes(key)) return value;
        }
        return 'An error occurred. Please try again.';
    }

    showProcessingMessage() {
        const processingDiv = document.createElement('div');
        processingDiv.id = 'processingMessage';
        processingDiv.className = 'alert alert-info';
        processingDiv.innerHTML = `
            <div class="d-flex align-items-center">
                <div class="spinner-border spinner-border-sm me-2" role="status"></div>
                <span>Processing your message...</span>
            </div>
        `;
        this.chatWindow.appendChild(processingDiv);
        this.chatWindow.scrollTop = this.chatWindow.scrollHeight;
    }

    removeProcessingMessage() {
        const processingDiv = document.getElementById('processingMessage');
        if (processingDiv) {
            processingDiv.remove();
        }
    }

    async playAudioResponse(audioData) {
        try {
            await audioHandler.playAudio(audioData);
        } catch (error) {
            console.error('Error playing audio response:', error);
            this.showError('Could not play the audio response');
        }
    }

    updateChatWindow(userText, botResponse) {
        const userMessage = `
            <div class="message user-message">
                <div class="message-content">${this.escapeHtml(userText)}</div>
            </div>
        `;
        const botMessage = `
            <div class="message bot-message">
                <div class="message-content">${this.escapeHtml(botResponse)}</div>
            </div>
        `;
        
        this.chatWindow.innerHTML += userMessage + botMessage;
        this.chatWindow.scrollTop = this.chatWindow.scrollHeight;
    }

    async resetSession() {
        try {
            const response = await fetch('/reset-session', { method: 'POST' });
            const data = await response.json();
            
            if (!response.ok) {
                throw new Error(data.error || 'Failed to reset session');
            }
            
            this.chatWindow.innerHTML = '';
        } catch (error) {
            console.error('Error resetting session:', error);
            this.showError('Failed to reset chat session. Please try again.');
        }
    }

    showError(message) {
        const errorDiv = document.createElement('div');
        errorDiv.className = 'alert alert-danger alert-dismissible fade show';
        errorDiv.innerHTML = `
            ${this.escapeHtml(message)}
            <button type="button" class="btn-close" data-bs-dismiss="alert" aria-label="Close"></button>
        `;
        this.chatWindow.appendChild(errorDiv);
        this.chatWindow.scrollTop = this.chatWindow.scrollHeight;
        
        // Auto-dismiss after 5 seconds
        setTimeout(() => {
            if (errorDiv.parentNode) {
                errorDiv.remove();
            }
        }, 5000);
    }

    escapeHtml(unsafe) {
        return unsafe
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#039;");
    }
}

document.addEventListener('DOMContentLoaded', () => {
    new ChatInterface();
});
