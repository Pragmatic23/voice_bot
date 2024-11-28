import os
import time
import logging
from datetime import datetime
from flask import Flask, render_template, request, jsonify, session
from flask_sqlalchemy import SQLAlchemy
from sqlalchemy.orm import DeclarativeBase
from utils.openai_helper import process_audio, generate_response, text_to_speech

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

class Base(DeclarativeBase):
    pass

db = SQLAlchemy(model_class=Base)
app = Flask(__name__)
app.secret_key = os.environ.get("FLASK_SECRET_KEY") or "a secret key"
app.config["SQLALCHEMY_DATABASE_URI"] = "sqlite:///chat.db"
app.config["SQLALCHEMY_ENGINE_OPTIONS"] = {
    "pool_recycle": 300,
    "pool_pre_ping": True,
}
db.init_app(app)

OPENAI_API_KEY = os.environ.get("OPENAI_API_KEY")

@app.route('/')
def index():
    return render_template('index.html')

@app.route('/process-audio', methods=['POST'])
def process_audio_route():
    start_time = time.time()
    logger.info(f"New audio processing request received at {datetime.now()}")
    
    try:
        if 'audio' not in request.files:
            logger.error("No audio file in request")
            return jsonify({'error': 'No audio file provided'}), 400
        
        audio_file = request.files['audio']
        if not audio_file:
            logger.error("Empty audio file received")
            return jsonify({'error': 'Empty audio file'}), 400
            
        category = request.form.get('category', 'general')
        logger.info(f"Processing audio for category: {category}")
        
        # Process audio using Whisper API
        try:
            text = process_audio(audio_file, OPENAI_API_KEY)
        except Exception as e:
            return jsonify({'error': f'Error processing audio: {str(e)}'}), 500
        
        # Get conversation history from session
        history = session.get('chat_history', [])
        
        try:
            # Generate response using GPT
            response = generate_response(text, category, history, OPENAI_API_KEY)
        except Exception as e:
            return jsonify({'error': f'Error generating response: {str(e)}'}), 500
        
        try:
            # Get voice model from request
            voice_model = request.form.get('voice_model', 'default')
            # Convert response to speech with selected voice model
            audio_response = text_to_speech(response, voice_model)
        except Exception as e:
            return jsonify({'error': f'Error converting text to speech: {str(e)}'}), 500
        
        # Update conversation history
        history.append({'role': 'user', 'content': text})
        history.append({'role': 'assistant', 'content': response})
        session['chat_history'] = history[-10:]  # Keep last 10 messages
        
        return jsonify({
            'text': text,
            'response': response,
            'audio': audio_response
        })
    except Exception as e:
        return jsonify({'error': f'Unexpected error: {str(e)}'}), 500

@app.route('/reset-session', methods=['POST'])
def reset_session():
    try:
        session.clear()
        return jsonify({'status': 'success'})
    except Exception as e:
        return jsonify({'error': f'Error resetting session: {str(e)}'}), 500

with app.app_context():
    import models
    db.create_all()
