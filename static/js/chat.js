import AudioHandler from './audio.js';

class ChatInterface {
    constructor() {
        this.audioHandler = AudioHandler;
        this.recordButton = document.getElementById('recordButton');
        this.chatWindow = document.getElementById('chatWindow');
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
        // Record button events
        this.recordButton.addEventListener('mousedown', () => {
            this.startRecording();
        });
        
        this.recordButton.addEventListener('mouseup', () => {
            this.stopRecording();
        });
        
        this.recordButton.addEventListener('mouseleave', () => {
            if (this.audioHandler.isRecording) {
                this.stopRecording();
            }
        });

        // Category card click events
        const categoryCards = document.querySelectorAll('.category-card');
        categoryCards.forEach(card => {
            card.addEventListener('click', (e) => {
                const category = e.currentTarget.dataset.category;
                this.categorySelected(category);
            });
        });

        // Back button
        this.backButton.addEventListener('click', () => {
            this.showCategorySelection();
        });

        // Reset button
        document.getElementById('resetButton').addEventListener('click', () => {
            this.resetSession();
        });

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
    }

    categorySelected(category) {
        console.log('Category selected:', category);
        this.currentCategory = category;
        
        // Update selected category display
        const categoryTitles = {
            'personality': 'Personality Development',
            'soft_skills': 'Soft Skills Improvement',
            'communication': 'Communication Techniques',
            'interview': 'Interview Preparation'
        };
        
        this.selectedCategoryText.textContent = categoryTitles[category] || category;
        
        // Show chat interface
        this.categoryGrid.classList.add('d-none');
        this.chatInterface.classList.remove('d-none');
    }

    showCategorySelection() {
        this.categoryGrid.classList.remove('d-none');
        this.chatInterface.classList.add('d-none');
        this.currentCategory = '';
    }

    async startRecording() {
        console.log('Starting audio recording...');
        try {
            await this.audioHandler.startRecording();
            this.recordButton.classList.add('recording');
            console.log('Recording started successfully');
        } catch (error) {
            console.error('Start recording error:', error);
            this.showError('Failed to start recording. Please check microphone permissions.');
        }
    }

    async stopRecording() {
        try {
            const audioBlob = await this.audioHandler.stopRecording();
            this.recordButton.classList.remove('recording');
            await this.processAudio(audioBlob);
        } catch (error) {
            console.error('Stop recording error:', error);
            this.showError('Failed to process recording. Please try again.');
        }
    }

    async processAudio(audioBlob) {
        console.log('Processing audio...');
        try {
            const formData = new FormData();
            formData.append('audio', audioBlob, 'recording.wav');
            formData.append('category', this.currentCategory);

            const response = await fetch('/process-audio', {
                method: 'POST',
                body: formData
            });

            const data = await response.json();
            
            if (!response.ok) {
                throw new Error(data.error || 'Failed to process audio');
            }

            console.log('Audio processed successfully, playing response');
            this.updateChatWindow(data.text, data.response);
            this.audioHandler.playAudio(data.audio);
            
        } catch (error) {
            console.error('Error processing audio:', error);
            this.showError('Failed to process audio. Please try again.');
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
