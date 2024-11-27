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
        this.recordButton.classList.add('recording');
        await audioHandler.startRecording();
    }

    async stopRecording() {
        this.recordButton.classList.remove('recording');
        const audioBlob = await audioHandler.stopRecording();
        await this.processAudio(audioBlob);
    }

    async processAudio(audioBlob) {
        const formData = new FormData();
        formData.append('audio', audioBlob);
        formData.append('category', this.currentCategory);

        try {
            const response = await fetch('/process-audio', {
                method: 'POST',
                body: formData
            });

            const data = await response.json();
            this.updateChatWindow(data.text, data.response);
            audioHandler.playAudio(data.audio);
        } catch (error) {
            console.error('Error processing audio:', error);
            this.showError('Error processing audio. Please try again.');
        }
    }

    updateChatWindow(userText, botResponse) {
        const userMessage = `
            <div class="message user-message">
                <div class="message-content">${userText}</div>
            </div>
        `;
        const botMessage = `
            <div class="message bot-message">
                <div class="message-content">${botResponse}</div>
            </div>
        `;
        
        this.chatWindow.innerHTML += userMessage + botMessage;
        this.chatWindow.scrollTop = this.chatWindow.scrollHeight;
    }

    async resetSession() {
        try {
            await fetch('/reset-session', { method: 'POST' });
            this.chatWindow.innerHTML = '';
        } catch (error) {
            console.error('Error resetting session:', error);
        }
    }

    showError(message) {
        const errorDiv = document.createElement('div');
        errorDiv.className = 'alert alert-danger';
        errorDiv.textContent = message;
        this.chatWindow.appendChild(errorDiv);
    }
}

document.addEventListener('DOMContentLoaded', () => {
    new ChatInterface();
});
