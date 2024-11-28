import os
import time
import logging
import sys
from datetime import datetime
from flask import Flask, render_template, request, jsonify, session
from flask_sqlalchemy import SQLAlchemy
from flask_socketio import SocketIO, emit
from sqlalchemy.orm import DeclarativeBase
from utils.openai_helper import process_audio, generate_response, text_to_speech
import asyncio

# Enhanced logging configuration
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - [%(request_id)s] %(message)s',
    datefmt='%Y-%m-%d %H:%M:%S',
    stream=sys.stdout
)

class RequestIDFilter(logging.Filter):
    def filter(self, record):
        record.request_id = getattr(record, 'request_id', 'N/A')
        return True

logger = logging.getLogger(__name__)
logger.addFilter(RequestIDFilter())

class Base(DeclarativeBase):
    pass

db = SQLAlchemy(model_class=Base)
app = Flask(__name__)
socketio = SocketIO(app, cors_allowed_origins="*", async_mode='gevent', logger=True, engineio_logger=True)

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

@socketio.on('connect')
def handle_connect():
    logger.info("Client connected to WebSocket")
    emit('connection_established', {'status': 'connected'})

@socketio.on('disconnect')
def handle_disconnect():
    logger.info("Client disconnected from WebSocket")

@socketio.on('audio_stream')
def handle_audio_stream(data):
    request_id = f"stream_{int(time.time() * 1000)}"
    logger.info("Received audio stream chunk", extra={'request_id': request_id})
    
    try:
        # Process audio chunk
        text = process_audio(data, OPENAI_API_KEY, streaming=True)
        if text:
            # Send transcription back to client
            emit('transcription', {'type': 'transcription', 'text': text})
            
            # Generate response
            response = generate_response(text, session.get('category', 'general'), 
                                    session.get('chat_history', []), OPENAI_API_KEY)
            
            # Convert to speech and stream back
            audio_response = text_to_speech(response, session.get('voice_model', 'default'))
            emit('audio_response', {
                'type': 'audio_response',
                'audio': audio_response,
                'text': response
            })
            
            # Update chat history
            history = session.get('chat_history', [])
            history.append({'role': 'user', 'content': text})
            history.append({'role': 'assistant', 'content': response})
            session['chat_history'] = history[-10:]
            
    except Exception as e:
        logger.error(f"Error processing audio stream: {str(e)}", 
                    extra={'request_id': request_id})
        emit('error', {
            'type': 'error',
            'message': str(e)
        })

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

if __name__ == '__main__':
    socketio.run(app, host='0.0.0.0', port=5000, debug=False)
