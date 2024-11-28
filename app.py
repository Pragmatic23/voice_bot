import os
import logging
from flask import Flask, render_template, request, jsonify, session
from flask_sqlalchemy import SQLAlchemy
from sqlalchemy.orm import DeclarativeBase
from flask_socketio import SocketIO, emit
from utils.openai_helper import process_audio, generate_response, text_to_speech, process_audio_chunk
import asyncio
import base64
import io

# Enhanced logging configuration
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

# Initialize Flask app
app = Flask(__name__)
app.secret_key = os.urandom(24)

# Database configuration
class Base(DeclarativeBase):
    pass

db = SQLAlchemy(model_class=Base)

app.config["SQLALCHEMY_DATABASE_URI"] = "sqlite:///chat.db"
app.config["SQLALCHEMY_ENGINE_OPTIONS"] = {
    "pool_recycle": 300,
    "pool_pre_ping": True,
}

# Initialize SocketIO
socketio = SocketIO(app, cors_allowed_origins="*", async_mode='eventlet')

# Initialize database
db.init_app(app)

# Store audio chunks temporarily
audio_chunks = {}

# Get OpenAI API key
OPENAI_API_KEY = os.environ.get('OPENAI_API_KEY')

@app.route('/')
def index():
    return render_template('index.html')

@app.route('/process-audio', methods=['POST'])
async def process_audio_route():
    try:
        if 'audio' not in request.files:
            return jsonify({'error': 'No audio file provided'}), 400
        
        audio_file = request.files['audio']
        if not audio_file:
            return jsonify({'error': 'Empty audio file'}), 400
            
        text = await process_audio(audio_file, OPENAI_API_KEY)
        return jsonify({'text': text})
        
    except Exception as e:
        logger.error(f"Error processing audio: {str(e)}")
        return jsonify({'error': str(e)}), 500

@app.route('/generate-response', methods=['POST'])
async def generate_response_route():
    try:
        data = request.get_json()
        
        if not data or 'text' not in data:
            return jsonify({'error': 'No text provided'}), 400
            
        text = data['text']
        category = data.get('category', 'general')
        history = data.get('history', [])
        
        response = await generate_response(text, category, history, OPENAI_API_KEY)
        return jsonify({'response': response})
        
    except Exception as e:
        logger.error(f"Error generating response: {str(e)}")
        return jsonify({'error': str(e)}), 500

@app.route('/text-to-speech', methods=['POST'])
async def text_to_speech_route():
    try:
        data = request.get_json()
        
        if not data or 'text' not in data:
            return jsonify({'error': 'No text provided'}), 400
            
        text = data['text']
        voice_model = data.get('voice_model', 'default')
        
        audio_data = await text_to_speech(text, voice_model)
        return jsonify({'audio': audio_data})
        
    except Exception as e:
        logger.error(f"Error in text-to-speech conversion: {str(e)}")
        return jsonify({'error': str(e)}), 500

@app.route('/reset-session', methods=['POST'])
def reset_session():
    try:
        session.clear()
        return jsonify({'status': 'success'})
    except Exception as e:
        return jsonify({'error': f'Error resetting session: {str(e)}'}), 500

@socketio.on('connect')
def handle_connect():
    session_id = request.sid
    audio_chunks[session_id] = []
    logger.info(f"Client connected: {session_id}")

@socketio.on('disconnect')
def handle_disconnect():
    session_id = request.sid
    if session_id in audio_chunks:
        del audio_chunks[session_id]
    logger.info(f"Client disconnected: {session_id}")

@socketio.on('audio_chunk')
def handle_audio_chunk(data):
    try:
        session_id = request.sid
        timestamp = data.get('timestamp')
        is_last_chunk = data.get('isLastChunk', False)
        
        if not data.get('audio'):
            raise ValueError("No audio data received")
        
        # Decode base64 audio chunk with error handling
        try:
            audio_data = base64.b64decode(data['audio'])
        except Exception as decode_error:
            logger.error(f"Failed to decode base64 audio: {str(decode_error)}")
            emit('error', {'message': 'Invalid audio data received'})
            return
        
        # Validate chunk size
        chunk_size = len(audio_data)
        if chunk_size < 100:  # Minimum size threshold
            logger.warning(f"Received very small audio chunk: {chunk_size} bytes")
            emit('error', {'message': 'Audio chunk too small'})
            return
            
        # Store chunk with session management
        if session_id not in audio_chunks:
            audio_chunks[session_id] = []
            logger.info(f"New session started: {session_id}")
            
        audio_chunks[session_id].append(audio_data)
        logger.debug(f"Added chunk of size {chunk_size} bytes to session {session_id}")
        
        # Process chunks when we have enough or on last chunk
        if len(audio_chunks[session_id]) >= 5 or is_last_chunk:
            try:
                # Combine chunks for processing
                combined_audio = b''.join(audio_chunks[session_id])
                audio_file = io.BytesIO(combined_audio)
                audio_file.content_type = 'audio/webm;codecs=opus'
                
                # Process audio chunk with proper error handling
                async def process_and_emit(text):
                    try:
                        emit('transcription', {'text': text, 'timestamp': timestamp})
                    except Exception as emit_error:
                        logger.error(f"Failed to emit transcription: {str(emit_error)}")
                
                asyncio.run(process_audio_chunk(
                    audio_file,
                    OPENAI_API_KEY,
                    callback=process_and_emit
                ))
                
                # Manage chunks after processing
                if not is_last_chunk:
                    # Keep the latest chunk for overlap
                    audio_chunks[session_id] = [audio_chunks[session_id][-1]]
                    logger.debug(f"Retained last chunk for session {session_id}")
                else:
                    # Clear all chunks on last chunk
                    audio_chunks[session_id] = []
                    logger.info(f"Cleared all chunks for session {session_id}")
                    
            except Exception as process_error:
                logger.error(f"Failed to process audio chunks: {str(process_error)}")
                emit('error', {'message': f'Failed to process audio: {str(process_error)}'})
                
    except Exception as e:
        error_msg = f"Error handling audio chunk: {str(e)}"
        logger.error(error_msg)
        emit('error', {'message': error_msg})

if __name__ == '__main__':
    with app.app_context():
        import models
        db.create_all()
    socketio.run(app, host='0.0.0.0', port=5000)