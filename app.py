import os
import time
import logging
from datetime import datetime
from flask import Flask, render_template, request, jsonify, session
from flask_sqlalchemy import SQLAlchemy
from sqlalchemy.orm import DeclarativeBase
from utils.openai_helper import process_audio, generate_response, text_to_speech
import asyncio

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
    request_id = f"req_{int(start_time)}"
    logger.info(f"[{request_id}] New audio processing request received at {datetime.now()}")
    
    try:
        # Request validation logging
        logger.info(f"[{request_id}] Validating request parameters...")
        if 'audio' not in request.files:
            logger.error(f"[{request_id}] No audio file in request")
            return jsonify({'error': 'No audio file provided'}), 400
        
        audio_file = request.files['audio']
        if not audio_file:
            logger.error(f"[{request_id}] Empty audio file received")
            return jsonify({'error': 'Empty audio file'}), 400
        
        # Log request details
        category = request.form.get('category', 'general')
        voice_model = request.form.get('voice_model', 'default')
        logger.info(f"[{request_id}] Request details - Category: {category}, Voice Model: {voice_model}")
        logger.info(f"[{request_id}] Audio file size: {request.content_length} bytes")
        
        # Process all async operations using asyncio
        async def process_request():
            # Process audio using Whisper API
            logger.info(f"[{request_id}] Starting audio transcription...")
            transcription_start = time.time()
            try:
                text = await process_audio(audio_file, OPENAI_API_KEY)
                logger.info(f"[{request_id}] Audio transcription completed in {time.time() - transcription_start:.2f}s")
            except Exception as e:
                logger.error(f"[{request_id}] Audio transcription failed: {str(e)}")
                return jsonify({'error': f'Error processing audio: {str(e)}'}), 500
            
            # Get conversation history from session
            history = session.get('chat_history', [])
            logger.info(f"[{request_id}] Retrieved conversation history: {len(history)} messages")
            
            # Generate response using GPT
            gpt_start = time.time()
            try:
                response = await generate_response(text, category, history, OPENAI_API_KEY)
                logger.info(f"[{request_id}] GPT response generated in {time.time() - gpt_start:.2f}s")
            except Exception as e:
                logger.error(f"[{request_id}] GPT response generation failed: {str(e)}")
                return jsonify({'error': f'Error generating response: {str(e)}'}), 500
            
            # Convert to speech
            tts_start = time.time()
            try:
                audio_response = await text_to_speech(response, voice_model)
                logger.info(f"[{request_id}] Text-to-speech completed in {time.time() - tts_start:.2f}s")
            except Exception as e:
                logger.error(f"[{request_id}] Text-to-speech conversion failed: {str(e)}")
                return jsonify({'error': f'Error converting text to speech: {str(e)}'}), 500
            
            return text, response, audio_response

        # Run async operations
        text, response, audio_response = asyncio.run(process_request())
        
        # Update conversation history
        history = session.get('chat_history', [])
        history.append({'role': 'user', 'content': text})
        history.append({'role': 'assistant', 'content': response})
        session['chat_history'] = history[-10:]  # Keep last 10 messages
        
        total_time = time.time() - start_time
        logger.info(f"[{request_id}] Request completed successfully in {total_time:.2f}s")
        
        return jsonify({
            'text': text,
            'response': response,
            'audio': audio_response,
            'processing_time': total_time
        })
    except Exception as e:
        logger.error(f"[{request_id}] Unexpected error: {str(e)}")
        return jsonify({
            'error': f'Unexpected error: {str(e)}',
            'request_id': request_id
        }), 500

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
