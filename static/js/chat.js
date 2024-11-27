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
        this.recordButton.addEventListener('mousedown', () => this.startRecording());
        this.recordButton.addEventListener('mouseup', () => this.stopRecording());
        this.resetButton.addEventListener('click', () => this.resetSession());
        this.backButton.addEventListener('click', () => this.showCategorySelection());

        // Add click handlers for category cards
        const categoryCards = document.querySelectorAll('.category-card');
        categoryCards.forEach(card => {
            card.addEventListener('click', () => this.selectCategory(card));
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
            this.recordButton.classList.add('recording');
            await audioHandler.startRecording();
        } catch (error) {
            this.showError('Error accessing microphone. Please ensure microphone permissions are granted.');
            this.recordButton.classList.remove('recording');
        }
    }

    async stopRecording() {
        try {
            this.recordButton.classList.remove('recording');
            const audioBlob = await audioHandler.stopRecording();
            await this.processAudio(audioBlob);
        } catch (error) {
            this.showError('Error stopping recording. Please try again.');
        }
    }

    async processAudio(audioBlob) {
        if (!audioBlob) {
            this.showError('No audio recorded. Please try again.');
            return;
        }

        const formData = new FormData();
        formData.append('audio', audioBlob);
        formData.append('category', this.currentCategory);

        try {
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

            this.updateChatWindow(data.text, data.response);
            audioHandler.playAudio(data.audio);
        } catch (error) {
            console.error('Error processing audio:', error);
            this.showError(error.message || 'Error processing audio. Please try again.');
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
        
        // Auto-dismiss after 5 seconds
        setTimeout(() => {
            errorDiv.remove();
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
