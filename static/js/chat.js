import AudioHandler from './audio.js';

class ChatInterface {
    constructor() {
        this.initializeElements();
        this.initializeAudioHandler();
        this.setupEventListeners();
    }

    initializeElements() {
        // Define all required elements
        this.elements = {
            categoryGrid: document.getElementById('categoryGrid'),
            chatInterface: document.getElementById('chatInterface'),
            categoryHeader: document.getElementById('categoryHeader'),
            selectedCategory: document.getElementById('selectedCategory'),
            chatWindow: document.getElementById('chatWindow'),
            recordButton: document.getElementById('recordButton'),
            backButton: document.getElementById('backButton'),
            voiceModel: document.getElementById('voiceModel'),
            historyButton: document.getElementById('historyButton'),
            resetButton: document.getElementById('resetButton'),
            exportButton: document.getElementById('exportButton'),
            endSessionButton: document.getElementById('endSessionButton'),
            chatSummary: document.getElementById('chatSummary'),
            closeSummaryButton: document.getElementById('closeSummaryButton'),
            summaryContent: document.getElementById('summaryContent')
        };

        // Validate required elements
        Object.entries(this.elements).forEach(([key, element]) => {
            if (!element) {
                console.error(`Required element not found: ${key}`);
                throw new Error(`Critical UI element missing: ${key}`);
            }
        });

        this.currentCategory = '';
        this.messageHistory = [];
        this.isProcessing = false;
        this.processingStages = {
            recording: false,
            transcribing: false,
            processing: false,
            responding: false
        };
    }

    async initializeAudioHandler() {
        try {
            console.log('[ChatInterface] Initializing AudioHandler...');
            this.audioHandler = new AudioHandler();
            console.log('[ChatInterface] AudioHandler initialized successfully');
        } catch (error) {
            console.error('[ChatInterface] Failed to initialize AudioHandler:', error);
            this.showError('Failed to initialize audio system. Please refresh the page.');
            throw error;
        }
    }

    setupEventListeners() {
        try {
            // Category card click handlers with error handling
            const categoryCards = document.querySelectorAll('.category-card');
            categoryCards.forEach(card => {
                card.addEventListener('click', (e) => {
                    try {
                        const category = card.dataset.category;
                        this.selectCategory(category);
                    } catch (error) {
                        console.error('[ChatInterface] Error handling category selection:', error);
                        this.showError('Failed to select category. Please try again.');
                    }
                });
            });

            // Record button handler with enhanced error handling
            this.elements.recordButton.addEventListener('click', async () => {
                try {
                    if (this.isProcessing) {
                        console.log('[ChatInterface] Processing in progress, ignoring click');
                        return;
                    }

                    if (this.audioHandler.isRecording) {
                        await this.stopRecording();
                    } else {
                        await this.startRecording();
                    }
                } catch (error) {
                    console.error('[ChatInterface] Error handling record button click:', error);
                    this.showError('Recording failed. Please check your microphone and try again.');
                }
            });

            // Navigation button handlers
            this.elements.backButton.addEventListener('click', () => {
                try {
                    this.resetChat();
                    this.showCategorySelection();
                } catch (error) {
                    console.error('[ChatInterface] Error handling back button:', error);
                    this.showError('Failed to return to categories. Please refresh the page.');
                }
            });

            // History button handler
            this.elements.historyButton.addEventListener('click', () => {
                try {
                    this.toggleChatSummary();
                } catch (error) {
                    console.error('[ChatInterface] Error toggling chat summary:', error);
                    this.showError('Failed to show chat history. Please try again.');
                }
            });

            // Reset button handler
            this.elements.resetButton.addEventListener('click', async () => {
                try {
                    await this.resetChat(true);
                } catch (error) {
                    console.error('[ChatInterface] Error resetting chat:', error);
                    this.showError('Failed to reset chat. Please try again.');
                }
            });

            // Export button handler
            this.elements.exportButton.addEventListener('click', () => {
                try {
                    this.exportChat();
                } catch (error) {
                    console.error('[ChatInterface] Error exporting chat:', error);
                    this.showError('Failed to export chat. Please try again.');
                }
            });

            // Close summary button handler
            this.elements.closeSummaryButton.addEventListener('click', () => {
                try {
                    this.elements.chatSummary.classList.add('d-none');
                } catch (error) {
                    console.error('[ChatInterface] Error closing summary:', error);
                    this.showError('Failed to close summary. Please try again.');
                }
            });

            // End session button handler
            this.elements.endSessionButton.addEventListener('click', () => {
                try {
                    this.endSession();
                } catch (error) {
                    console.error('[ChatInterface] Error ending session:', error);
                    this.showError('Failed to end session. Please try again.');
                }
            });

        } catch (error) {
            console.error('[ChatInterface] Error setting up event listeners:', error);
            this.showError('Failed to initialize interface. Please refresh the page.');
            throw error;
        }
    }

    selectCategory(category) {
        this.currentCategory = category;
        this.elements.selectedCategory.textContent = this.getCategoryTitle(category);
        this.elements.categoryHeader.classList.add('d-none');
        this.elements.categoryGrid.classList.add('d-none');
        this.elements.chatInterface.classList.remove('d-none');
    }

    getCategoryTitle(category) {
        const titles = {
            'personality': 'Personality Development',
            'soft_skills': 'Soft Skills Improvement',
            'communication': 'Communication Techniques',
            'interview': 'Interview Preparation'
        };
        return titles[category] || 'Chat';
    }

    showCategorySelection() {
        this.elements.categoryHeader.classList.remove('d-none');
        this.elements.categoryGrid.classList.remove('d-none');
        this.elements.chatInterface.classList.add('d-none');
        this.elements.chatSummary.classList.add('d-none');
    }

    async startRecording() {
        try {
            this.updateStageProgress('recording');
            const continuousMode = document.getElementById('continuousMode').checked;
            console.log(`[ChatInterface] Starting recording in ${continuousMode ? 'continuous' : 'single'} mode`);

            if (continuousMode) {
                // Set up speech end callback for continuous mode
                this.audioHandler.setSpeechEndCallback(async (audioBlob) => {
                    try {
                        console.log('[ChatInterface] Speech chunk detected, processing audio...');

                        if (audioBlob && audioBlob.size > 0) {
                            // Process audio without stopping recording
                            await this.processAudio(audioBlob, true);
                        }
                    } catch (error) {
                        console.error('[ChatInterface] Error in continuous mode callback:', error);
                        this.showError('Error processing voice input. Attempting to continue...');
                    }
                });

                // Set up bot response end callback
                this.audioHandler.setBotResponseEndCallback(() => {
                    console.log('[ChatInterface] Bot response ended, ready for next input');
                    this.setLoadingState(false);
                    this.updateStageProgress('recording');
                });
            }

            await this.audioHandler.startRecording(continuousMode);
            this.elements.recordButton.classList.add('recording');
            this.elements.recordButton.querySelector('i').className = 'fas fa-stop';

            if (continuousMode) {
                this.showInfo('Continuous mode active. Speaking will be automatically detected.');
            }
        } catch (error) {
            console.error('[ChatInterface] Failed to start recording:', error);
            this.showError(error.message || 'Failed to start recording. Please try again.');
            document.getElementById('continuousMode').checked = false;
            this.setLoadingState(false);
        }
    }
    async stopRecording() {
        try {
            console.log('[ChatInterface] Stopping recording...');
            const wasContinuous = document.getElementById('continuousMode').checked;
            
            // Disable continuous mode before stopping
            if (wasContinuous) {
                console.log('[ChatInterface] Disabling continuous mode before stopping');
                document.getElementById('continuousMode').checked = false;
            }
            
            const audioBlob = await this.audioHandler.stopRecording();
            this.elements.recordButton.classList.remove('recording');
            this.elements.recordButton.querySelector('i').className = 'fas fa-microphone';
            
            if (audioBlob && audioBlob.size > 0) {
                await this.processAudio(audioBlob);
            } else {
                console.log('[ChatInterface] No valid audio data to process');
            }
        } catch (error) {
            console.error('[ChatInterface] Failed to stop recording:', error);
            this.showError(error.message || 'Failed to process recording. Please try again.');
            this.setLoadingState(false);
        }
    }

    async processAudio(audioBlob, continuous = false) {
        if (!audioBlob || audioBlob.size === 0) {
            console.error('[ChatInterface] No valid audio data to process');
            return;
        }

        if (audioBlob.size > 10 * 1024 * 1024) {
            console.error('[ChatInterface] Audio file too large:', audioBlob.size);
            this.showError('Recording too large. Please keep messages under 1 minute.');
            return;
        }

        if (!continuous) {
            this.setLoadingState(true, 'processing');
        }

        try {
            this.updateStageProgress('transcribing');

            const formData = new FormData();
            formData.append('audio', audioBlob, 'recording.webm');
            formData.append('category', this.currentCategory);
            formData.append('voice_model', this.elements.voiceModel.value);

            const response = await fetch('/process-audio', {
                method: 'POST',
                body: formData
            });

            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.error || 'Failed to process audio');
            }

            const data = await response.json();

            // Add messages to chat
            this.addMessage(data.text, 'user');
            this.addMessage(data.response, 'bot');

            // Play audio response
            await this.audioHandler.playAudio(data.audio);

        } catch (error) {
            console.error('[ChatInterface] Error processing audio:', error);
            this.showError(error.message || 'Failed to process audio. Please try again.');

            if (continuous) {
                // Attempt to restart recording in continuous mode
                await this.audioHandler.startRecording(true);
            }
        } finally {
            if (!continuous) {
                this.setLoadingState(false);
            }
        }
    }

    addMessage(text, sender) {
        const messageDiv = document.createElement('div');
        messageDiv.className = `message ${sender}-message`;
        
        const contentDiv = document.createElement('div');
        contentDiv.className = 'message-content';
        contentDiv.textContent = text;
        
        messageDiv.appendChild(contentDiv);
        this.elements.chatWindow.appendChild(messageDiv);
        this.elements.chatWindow.scrollTop = this.elements.chatWindow.scrollHeight;
        
        // Update message history
        this.messageHistory.push({ sender, text });
    }

    async resetChat(clearServer = false) {
        try {
            this.messageHistory = [];
            this.elements.chatWindow.innerHTML = '';
            
            if (clearServer) {
                const response = await fetch('/reset-session', {
                    method: 'POST'
                });
                
                if (!response.ok) {
                    throw new Error('Failed to reset server session');
                }
            }
        } catch (error) {
            console.error('[ChatInterface] Error resetting chat:', error);
            this.showError('Failed to reset chat. Please try again.');
        }
    }

    toggleChatSummary() {
        const summaryVisible = !this.elements.chatSummary.classList.contains('d-none');
        
        if (summaryVisible) {
            this.elements.chatSummary.classList.add('d-none');
        } else {
            this.updateChatSummary();
            this.elements.chatSummary.classList.remove('d-none');
        }
    }

    updateChatSummary() {
        this.elements.summaryContent.innerHTML = '';
        
        this.messageHistory.forEach(message => {
            const messageDiv = document.createElement('div');
            messageDiv.className = `summary-message ${message.sender}-message`;
            
            const timestamp = document.createElement('div');
            timestamp.className = 'timestamp';
            timestamp.textContent = new Date().toLocaleTimeString();
            
            const content = document.createElement('div');
            content.textContent = message.text;
            
            messageDiv.appendChild(timestamp);
            messageDiv.appendChild(content);
            this.elements.summaryContent.appendChild(messageDiv);
        });
    }

    exportChat() {
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const filename = `chat-export-${timestamp}.txt`;
        
        const content = this.messageHistory.map(message => 
            `[${message.sender.toUpperCase()}] ${message.text}`
        ).join('\n\n');
        
        const blob = new Blob([content], { type: 'text/plain' });
        const url = URL.createObjectURL(blob);
        
        const link = document.createElement('a');
        link.href = url;
        link.download = filename;
        link.click();
        
        URL.revokeObjectURL(url);
    }

    endSession() {
        this.resetChat(true);
        this.showCategorySelection();
    }

    setLoadingState(loading, message = '') {
        this.isProcessing = loading;
        this.elements.recordButton.disabled = loading;
        if (loading) {
            this.elements.recordButton.classList.add('processing');
            if (message) {
                this.updateLoadingStatus(message);
            }
        } else {
            this.elements.recordButton.classList.remove('processing');
            this.updateLoadingStatus('');
        }
    }

    showError(message) {
        console.error('[ChatInterface] Error:', message);
        // Create or update error message element
        let errorElement = document.getElementById('errorMessage');
        if (!errorElement) {
            errorElement = document.createElement('div');
            errorElement.id = 'errorMessage';
            errorElement.className = 'alert alert-danger mt-2';
            this.elements.recordButton.parentNode.appendChild(errorElement);
        }
        errorElement.textContent = message;
        
        // Auto-hide error after 5 seconds
        setTimeout(() => {
            if (errorElement.parentNode) {
                errorElement.parentNode.removeChild(errorElement);
            }
        }, 5000);
    }

    // Define stages object at class level
    stages = {
        recording: 'Recording your message...',
        transcribing: 'Converting speech to text...',
        processing: 'Processing your message...',
        responding: 'Generating response...'
    };

    updateStageProgress(stage) {
        this.updateLoadingStatus(this.stages[stage] || '');
        
        // Update visual progress indicator
        let progressElement = document.getElementById('processingProgress');
        if (!progressElement) {
            progressElement = document.createElement('div');
            progressElement.id = 'processingProgress';
            progressElement.className = 'progress mt-2';
            progressElement.style.height = '2px';
            progressElement.innerHTML = '<div class="progress-bar progress-bar-striped progress-bar-animated" role="progressbar" style="width: 0%"></div>';
            this.elements.recordButton.parentNode.appendChild(progressElement);
        }

        // Update progress bar based on stage
        const progressBar = progressElement.querySelector('.progress-bar');
        if (progressBar) {
            const stageProgress = {
                recording: 25,
                transcribing: 50,
                processing: 75,
                responding: 100
            };
            progressBar.style.width = `${stageProgress[stage]}%`;
        }
    }

    showInfo(message) {
        let infoElement = document.getElementById('infoMessage');
        if (!infoElement) {
            infoElement = document.createElement('div');
            infoElement.id = 'infoMessage';
            infoElement.className = 'alert alert-info mt-2';
            this.elements.recordButton.parentNode.appendChild(infoElement);
        }
        infoElement.textContent = message;
        
        setTimeout(() => {
            if (infoElement.parentNode) {
                infoElement.parentNode.removeChild(infoElement);
            }
        }, 3000);
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