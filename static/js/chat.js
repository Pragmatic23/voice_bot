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
        this.messageHistory = [];
        this.chatSummary = document.getElementById('chatSummary');
        this.summaryContent = document.getElementById('summaryContent');
        
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

        // History button
        document.getElementById('historyButton').addEventListener('click', () => {
            this.showChatSummary();
        });

        // Close summary button
        document.getElementById('closeSummaryButton').addEventListener('click', () => {
            this.hideChatSummary();
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
            console.log('Starting audio recording...');
            this.recordButton.classList.add('recording');
            await audioHandler.startRecording();
            console.log('Recording started successfully');
        } catch (error) {
            console.error('Error starting recording:', error);
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
            console.warn('No audio recorded');
            this.showError('No audio recorded. Please try again.');
            return;
        }

        console.log('Processing audio...');
        this.recordButton.classList.add('processing');
        
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
            console.log('Audio processed successfully, playing response');
            audioHandler.playAudio(data.audio);
        } catch (error) {
            console.error('Error processing audio:', error);
            this.showError(error.message || 'Error processing audio. Please try again.');
        } finally {
            this.recordButton.classList.remove('processing');
        }
    }

    updateChatWindow(userText, botResponse) {
        console.log('Updating chat window with new messages');
        
        // Store messages in history
        this.messageHistory.push({
            type: 'user',
            text: userText,
            timestamp: new Date()
        });
        this.messageHistory.push({
            type: 'bot',
            text: botResponse,
            timestamp: new Date()
        });
        
        const userMessage = `
            <div class="message user-message">
                <div class="message-content">
                    ${this.escapeHtml(userText)}
                    <i class="fas fa-file-alt message-toggle" title="Show/Hide Transcript"></i>
                </div>
                <div class="message-transcript">${this.escapeHtml(userText)}</div>
    showChatSummary() {
        console.log('Showing chat summary');
        this.summaryContent.innerHTML = '';
        
        this.messageHistory.forEach(message => {
            const timestamp = message.timestamp.toLocaleString();
            const messageHtml = `
                <div class="summary-message ${message.type}-message">
                    <div class="timestamp">${this.escapeHtml(timestamp)}</div>
                    <div class="content">${this.escapeHtml(message.text)}</div>
                </div>
            `;
            this.summaryContent.innerHTML += messageHtml;
        });
        
        this.chatSummary.classList.remove('d-none');
    }

    hideChatSummary() {
        console.log('Hiding chat summary');
        this.chatSummary.classList.add('d-none');
    }

            </div>
        `;
        const botMessage = `
            <div class="message bot-message">
                <div class="message-content">
                    ${this.escapeHtml(botResponse)}
                    <i class="fas fa-file-alt message-toggle" title="Show/Hide Transcript"></i>
                </div>
                <div class="message-transcript">${this.escapeHtml(botResponse)}</div>
            </div>
        `;
        
        this.chatWindow.innerHTML += userMessage + botMessage;
        this.chatWindow.scrollTop = this.chatWindow.scrollHeight;
        
        // Add click handlers for transcript toggles
        const toggles = this.chatWindow.querySelectorAll('.message-toggle');
        toggles.forEach(toggle => {
            toggle.addEventListener('click', (e) => {
                const transcript = e.target.closest('.message-content').nextElementSibling;
                transcript.classList.toggle('show');
            });
        });
    }

    async resetSession() {
        try {
            const response = await fetch('/reset-session', { method: 'POST' });
            const data = await response.json();
            
            if (!response.ok) {
                throw new Error(data.error || 'Failed to reset session');
            }
            
            this.chatWindow.innerHTML = '';
            this.messageHistory = [];
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
