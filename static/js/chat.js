import AudioHandler from './audio.js';

class ChatInterface {
    constructor() {
        this.initializeElements();
        this.setupEventListeners();
    }

    initializeElements() {
        // Initialize all DOM elements with null checks
        this.elements = {
            recordButton: document.getElementById('recordButton'),
            chatWindow: document.getElementById('chatWindow'),
            categoryGrid: document.getElementById('categoryGrid'),
            chatInterface: document.getElementById('chatInterface'),
            backButton: document.getElementById('backButton'),
            selectedCategoryText: document.getElementById('selectedCategory'),
            chatSummary: document.getElementById('chatSummary'),
            summaryContent: document.getElementById('summaryContent'),
            resetButton: document.getElementById('resetButton'),
            endSessionButton: document.getElementById('endSessionButton'),
            historyButton: document.getElementById('historyButton'),
            closeSummaryButton: document.getElementById('closeSummaryButton'),
            exportButton: document.getElementById('exportButton')
        };

        // Verify all required elements exist
        Object.entries(this.elements).forEach(([key, element]) => {
            if (!element) {
                console.error(`Required element not found: ${key}`);
            }
        });

        this.audioHandler = new AudioHandler();
        this.currentCategory = '';
        this.messageHistory = [];
        this.isProcessing = false;
    }

    setupEventListeners() {
        // Record button events with loading states
        if (this.elements.recordButton) {
            this.elements.recordButton.addEventListener('mousedown', async () => {
                if (!this.isProcessing) {
                    await this.startRecording();
                }
            });
            
            this.elements.recordButton.addEventListener('mouseup', async () => {
                if (this.audioHandler.isRecording) {
                    await this.stopRecording();
                }
            });
            
            this.elements.recordButton.addEventListener('mouseleave', async () => {
                if (this.audioHandler.isRecording) {
                    await this.stopRecording();
                }
            });
        }

        // Category card click events with improved event handling
        const categoryCards = document.querySelectorAll('.category-card');
        categoryCards.forEach(card => {
            card.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                const category = e.currentTarget.dataset.category;
                if (category) {
                    this.categorySelected(category);
                }
            }, { passive: false });
            
            // Add touch event handling for mobile devices
            card.addEventListener('touchstart', (e) => {
                e.preventDefault();
                const category = e.currentTarget.dataset.category;
                if (category) {
                    this.categorySelected(category);
                }
            }, { passive: false });
        });

        // Setup other button listeners with null checks
        this.setupButtonListeners();
    }

    setupButtonListeners() {
        const { backButton, resetButton, endSessionButton, historyButton, closeSummaryButton } = this.elements;

        if (backButton) {
            backButton.addEventListener('click', () => this.showCategorySelection());
        }

        if (resetButton) {
            resetButton.addEventListener('click', () => this.resetSession());
        }

        if (endSessionButton) {
            endSessionButton.addEventListener('click', () => {
                this.resetSession();
                this.showCategorySelection();
            });
        }

        if (historyButton) {
            historyButton.addEventListener('click', () => this.showChatSummary());
        }

        if (closeSummaryButton) {
            closeSummaryButton.addEventListener('click', () => this.hideChatSummary());
        }

        if (this.elements.exportButton) {
            this.elements.exportButton.addEventListener('click', () => this.exportChat());
        }
    }

    async startRecording() {
        try {
            this.setLoadingState(true, 'recording');
            await this.audioHandler.startRecording();
            this.elements.recordButton.classList.add('recording');
        } catch (error) {
            this.showError(error.message);
        }
    }

    async stopRecording() {
        try {
            const audioBlob = await this.audioHandler.stopRecording();
            this.elements.recordButton.classList.remove('recording');
            await this.processAudio(audioBlob);
        } catch (error) {
            this.showError(error.message);
        } finally {
            this.setLoadingState(false, 'recording');
        }
    }

    async processAudio(audioBlob) {
        if (!audioBlob) {
            this.showError('No audio data available to process');
            return;
        }

        this.setLoadingState(true, 'processing');
        
        try {
            const formData = new FormData();
            formData.append('audio', audioBlob, 'recording.wav');
            formData.append('category', this.currentCategory);
            const voiceModel = document.getElementById('voiceModel').value;
            formData.append('voice_model', voiceModel);

            const response = await fetch('/process-audio', {
                method: 'POST',
                body: formData
            });

            const data = await response.json();
            
            if (!response.ok) {
                throw new Error(data.error || 'Failed to process audio');
            }

            this.updateChatWindow(data.text, data.response);
            await this.audioHandler.playAudio(data.audio);
            
        } catch (error) {
            this.showError(error.message);
        } finally {
            this.setLoadingState(false, 'processing');
        }
    }

    setLoadingState(isLoading, state = 'processing') {
        this.isProcessing = isLoading;
        
        if (this.elements.recordButton) {
            this.elements.recordButton.disabled = isLoading;
            
            // Update button text/icon based on state
            const icon = this.elements.recordButton.querySelector('i');
            if (icon) {
                if (isLoading) {
                    // Add pulsing effect for recording state
                    if (state === 'recording') {
                        icon.className = 'fas fa-microphone-slash fa-beat';
                        this.elements.recordButton.classList.add('btn-danger');
                    } else {
                        // Add spinning loader for processing state
                        icon.className = 'fas fa-spinner fa-spin-pulse fa-spin';
                        this.elements.recordButton.classList.add('btn-warning');
                    }
                } else {
                    icon.className = 'fas fa-microphone';
                    this.elements.recordButton.classList.remove('btn-danger', 'btn-warning');
                }
            }
            
            // Add loading indicator text
            const loadingText = state === 'recording' ? 'Recording...' : 'Processing...';
            this.updateLoadingStatus(isLoading ? loadingText : '');
        }

        // Add visual feedback for processing state
        if (this.elements.chatInterface) {
            this.elements.chatInterface.classList.toggle('processing', isLoading);
        }
    }

    categorySelected(category) {
        if (!category) return;
        
        this.currentCategory = category;
        
        const categoryTitles = {
            'personality': 'Personality Development',
            'soft_skills': 'Soft Skills Improvement',
            'communication': 'Communication Techniques',
            'interview': 'Interview Preparation'
        };
        
        if (this.elements.selectedCategoryText) {
            this.elements.selectedCategoryText.textContent = categoryTitles[category] || category;
        }
        
        // Hide category header and show chat interface
        const categoryHeader = document.getElementById('categoryHeader');
        if (categoryHeader) {
            categoryHeader.classList.add('d-none');
        }
        
        if (this.elements.categoryGrid && this.elements.chatInterface) {
            this.elements.categoryGrid.classList.add('d-none');
            this.elements.chatInterface.classList.remove('d-none');
        }
    }

    showCategorySelection() {
        // Show category header when returning to selection
        const categoryHeader = document.getElementById('categoryHeader');
        if (categoryHeader) {
            categoryHeader.classList.remove('d-none');
        }

        if (this.elements.categoryGrid && this.elements.chatInterface) {
            this.elements.categoryGrid.classList.remove('d-none');
            this.elements.chatInterface.classList.add('d-none');
        }
        this.currentCategory = '';
    }

    updateChatWindow(userText, botResponse) {
        if (!this.elements.chatWindow) return;

        const timestamp = new Date().toLocaleString();
        
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

        const messageHtml = this.createMessageHTML(userText, botResponse, timestamp);
        this.elements.chatWindow.insertAdjacentHTML('beforeend', messageHtml);
        this.elements.chatWindow.scrollTop = this.elements.chatWindow.scrollHeight;
        
        this.setupMessageToggles();
    }

    createMessageHTML(userText, botResponse, timestamp) {
        return `
            <div class="message user-message">
                <div class="message-content">
                    <span class="timestamp">${this.escapeHtml(timestamp)}</span>
                    ${this.escapeHtml(userText)}
                    <i class="fas fa-file-alt message-toggle" title="Show/Hide Transcript"></i>
                </div>
                <div class="message-transcript">${this.escapeHtml(userText)}</div>
            </div>
            <div class="message bot-message">
                <div class="message-content">
                    <span class="timestamp">${this.escapeHtml(timestamp)}</span>
                    ${this.escapeHtml(botResponse)}
                    <i class="fas fa-file-alt message-toggle" title="Show/Hide Transcript"></i>
                </div>
                <div class="message-transcript">${this.escapeHtml(botResponse)}</div>
            </div>
        `;
    }

    setupMessageToggles() {
        const toggles = this.elements.chatWindow.querySelectorAll('.message-toggle');
        toggles.forEach(toggle => {
            toggle.addEventListener('click', (e) => {
                const transcript = e.target.closest('.message-content').nextElementSibling;
                transcript.classList.toggle('show');
            });
        });
    }

    showChatSummary() {
        if (!this.elements.summaryContent || !this.elements.chatSummary) return;

        this.elements.summaryContent.innerHTML = '';
        
        this.messageHistory.forEach(message => {
            const timestamp = message.timestamp.toLocaleString();
            const messageHtml = `
                <div class="summary-message ${message.type}-message">
                    <div class="timestamp">${this.escapeHtml(timestamp)}</div>
                    <div class="content">${this.escapeHtml(message.text)}</div>
                </div>
            `;
            this.elements.summaryContent.innerHTML += messageHtml;
        });
        
        this.elements.chatSummary.classList.remove('d-none');
    }

    hideChatSummary() {
        if (this.elements.chatSummary) {
            this.elements.chatSummary.classList.add('d-none');
        }
    }

    async resetSession() {
        try {
            const response = await fetch('/reset-session', { method: 'POST' });
            const data = await response.json();
            
            if (!response.ok) {
                throw new Error(data.error || 'Failed to reset session');
            }
            
            if (this.elements.chatWindow) {
                this.elements.chatWindow.innerHTML = '';
            }
            this.messageHistory = [];
        } catch (error) {
            this.showError(error.message);
        }
    }

    async exportChat() {
        if (this.messageHistory.length === 0) {
            this.showError('No conversation to export');
            return;
        }

        try {
            // Format the chat history
            const exportData = {
                category: this.currentCategory,
                timestamp: new Date().toISOString(),
                messages: this.messageHistory.map(msg => ({
                    type: msg.type,
                    text: msg.text,
                    timestamp: msg.timestamp.toISOString()
                }))
            };

            // Create text version
            let textContent = `Chat Export - ${exportData.category}\n`;
            textContent += `Generated: ${new Date().toLocaleString()}\n\n`;
            exportData.messages.forEach(msg => {
                textContent += `[${new Date(msg.timestamp).toLocaleString()}] ${msg.type.toUpperCase()}: ${msg.text}\n`;
            });

            // Create Blob with text content
            const blob = new Blob([textContent], { type: 'text/plain' });
            const url = window.URL.createObjectURL(blob);
            
            // Create download link
            const a = document.createElement('a');
            const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
            a.href = url;
            a.download = `chat-export-${timestamp}.txt`;
            document.body.appendChild(a);
            a.click();
            
            // Cleanup
            window.URL.revokeObjectURL(url);
            document.body.removeChild(a);
        } catch (error) {
            this.showError('Failed to export chat: ' + error.message);
        }
    }

    showError(message) {
        if (!this.elements.chatWindow) return;

        const errorDiv = document.createElement('div');
        errorDiv.className = 'alert alert-danger alert-dismissible fade show';
        errorDiv.innerHTML = `
            ${this.escapeHtml(message)}
            <button type="button" class="btn-close" data-bs-dismiss="alert" aria-label="Close"></button>
        `;
        this.elements.chatWindow.appendChild(errorDiv);
        
        // Auto-dismiss after 5 seconds
        setTimeout(() => {
            if (errorDiv.parentNode === this.elements.chatWindow) {
                errorDiv.remove();
            }
        }, 5000);
    }

    updateLoadingStatus(message) {
        let statusElement = document.getElementById('processingStatus');
        if (!statusElement) {
            statusElement = document.createElement('div');
            statusElement.id = 'processingStatus';
            statusElement.className = 'text-center mt-2 text-muted';
            this.elements.recordButton.parentNode.appendChild(statusElement);
        }
        statusElement.textContent = message;
    }

    escapeHtml(unsafe) {
        if (!unsafe) return '';
        return unsafe
            .toString()
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#039;");
    }
}

// Initialize the chat interface when the DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    new ChatInterface();
});
