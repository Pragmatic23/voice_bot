import os
from flask import Flask, render_template, request, jsonify, session
from flask_sqlalchemy import SQLAlchemy
from sqlalchemy.orm import DeclarativeBase
from utils.openai_helper import process_audio, generate_response, text_to_speech

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

OPENAI_API_KEY = os.environ.get("OPENAI_API_KEY", "your-api-key")

@app.route('/')
def index():
    return render_template('index.html')

@app.route('/process-audio', methods=['POST'])
def process_audio_route():
    if 'audio' not in request.files:
        return jsonify({'error': 'No audio file provided'}), 400
    
    audio_file = request.files['audio']
    category = request.form.get('category', 'general')
    
    # Process audio using Whisper API
    text = process_audio(audio_file, OPENAI_API_KEY)
    
    # Get conversation history from session
    history = session.get('chat_history', [])
    
    # Generate response using GPT
    response = generate_response(text, category, history, OPENAI_API_KEY)
    
    # Convert response to speech
    audio_response = text_to_speech(response)
    
    # Update conversation history
    history.append({'role': 'user', 'content': text})
    history.append({'role': 'assistant', 'content': response})
    session['chat_history'] = history[-10:]  # Keep last 10 messages
    
    return jsonify({
        'text': text,
        'response': response,
        'audio': audio_response
    })

@app.route('/reset-session', methods=['POST'])
def reset_session():
    session.clear()
    return jsonify({'status': 'success'})

with app.app_context():
    import models
    db.create_all()
