import openai
import base64
import tempfile
import requests
from gtts import gTTS
import io

def process_audio(audio_file, api_key):
    openai.api_key = api_key
    
    # Save the audio file temporarily
    with tempfile.NamedTemporaryFile(delete=False, suffix='.wav') as temp_audio:
        audio_file.save(temp_audio.name)
        
        # Transcribe using Whisper API
        with open(temp_audio.name, 'rb') as audio:
            transcript = openai.Audio.transcribe("whisper-1", audio)
            
    return transcript['text']

def generate_response(text, category, history, api_key):
    openai.api_key = api_key
    
    # Create system message based on category
    system_messages = {
        'soft_skills': "You are an expert in soft skills and communication coaching.",
        'interview': "You are an experienced interview coach and career counselor.",
        'personality': "You are a personality development coach focusing on personal growth.",
        'general': "You are a helpful life coach providing general advice and guidance."
    }
    
    messages = [
        {"role": "system", "content": system_messages.get(category, system_messages['general'])}
    ]
    
    # Add conversation history
    for msg in history:
        messages.append(msg)
        
    # Add current user message
    messages.append({"role": "user", "content": text})
    
    # Generate response using GPT-4
    response = openai.ChatCompletion.create(
        model="gpt-4",
        messages=messages,
        temperature=0.7,
        max_tokens=150
    )
    
    return response.choices[0].message['content']

def text_to_speech(text):
    # Using gTTS for text-to-speech conversion
    tts = gTTS(text=text, lang='en')
    
    # Save to bytes buffer
    fp = io.BytesIO()
    tts.write_to_fp(fp)
    fp.seek(0)
    
    # Convert to base64 for frontend playback
    audio_base64 = base64.b64encode(fp.read()).decode()
    return f"data:audio/mp3;base64,{audio_base64}"
