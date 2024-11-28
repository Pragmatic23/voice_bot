from openai import OpenAI
import base64
import tempfile
import requests
from gtts import gTTS
import io
import time
from functools import wraps
import os
import logging
from datetime import datetime

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

def log_timing(func_name, start_time):
    """Log execution time of a function"""
    duration = time.time() - start_time
    logger.info(f"{func_name} completed in {duration:.2f} seconds")

def retry_on_exception(retries=3, delay=1):
    def decorator(func):
        @wraps(func)
        async def wrapper(*args, **kwargs):
            last_exception = None
            for attempt in range(retries):
                try:
                    return await func(*args, **kwargs)
                except Exception as e:
                    last_exception = e
                    if attempt < retries - 1:
                        print(f"Attempt {attempt + 1} failed, retrying in {delay} seconds...")
                        time.sleep(delay)
                    continue
            raise last_exception
        return wrapper
    return decorator

def validate_audio_format(audio_file):
    """Validate and ensure proper audio format."""
    allowed_types = {'audio/wav', 'audio/wave', 'audio/x-wav', 'audio/webm'}
    
    if not hasattr(audio_file, 'content_type'):
        raise ValueError("Invalid audio file: Missing content type")
        
    if audio_file.content_type not in allowed_types:
        raise ValueError(f"Unsupported audio format: {audio_file.content_type}. Supported formats: WAV, WebM")
    
    return True

@retry_on_exception(retries=3, delay=1)
async def process_audio(audio_file, api_key):
    """Process audio file using Whisper API with improved error handling and retries."""
    start_time = time.time()
    logger.info("Starting audio processing...")
    
    try:
        # Validate audio format
        logger.info("Validating audio format...")
        validate_audio_format(audio_file)
        
        logger.info("Initializing OpenAI client...")
        client = OpenAI(api_key=api_key)
        
        # Save the audio file temporarily
        logger.info("Creating temporary audio file...")
        with tempfile.NamedTemporaryFile(delete=False, suffix='.wav') as temp_audio:
            logger.info("Saving audio data...")
            audio_file.save(temp_audio.name)
            
            # Transcribe using Whisper API
            try:
                logger.info("Sending audio to Whisper API for transcription...")
                transcription_start = time.time()
                with open(temp_audio.name, 'rb') as audio:
                    transcript = client.audio.transcriptions.create(
                        model="whisper-1",
                        file=audio,
                        language="en"
                    )
                logger.info(f"Transcription completed in {time.time() - transcription_start:.2f} seconds")
                logger.info(f"Transcribed text: {transcript.text[:100]}...")
                log_timing("process_audio", start_time)
                return transcript.text
            except Exception as e:
                raise Exception(f"Transcription failed: {str(e)}")
            finally:
                # Cleanup temporary file
                try:
                    os.unlink(temp_audio.name)
                except Exception as e:
                    print(f"Warning: Failed to cleanup temporary file: {str(e)}")
                    
    except Exception as e:
        raise Exception(f"Audio processing failed: {str(e)}")

@retry_on_exception(retries=3, delay=1)
async def generate_response(text, category, history, api_key):
    """Generate response using GPT with improved error handling and retries."""
    try:
        client = OpenAI(api_key=api_key)
        
        # Create system message based on category
        system_messages = {
            'soft_skills': "You are an expert in soft skills and communication coaching. Always respond in English.",
            'interview': "You are an experienced interview coach and career counselor. Always respond in English.",
            'personality': "You are a personality development coach focusing on personal growth. Always respond in English.",
            'general': "You are a helpful life coach providing general advice and guidance. Always respond in English."
        }
        
        messages = [
            {"role": "system", "content": system_messages.get(category, system_messages['general'])}
        ]
        
        # Add conversation history
        for msg in history:
            messages.append(msg)
            
        # Add current user message
        messages.append({"role": "user", "content": text})
        
        try:
            # Generate response using GPT-4
            response = client.chat.completions.create(
                model="gpt-4",
                messages=messages,
                temperature=0.7,
                max_tokens=150
            )
            
            return response.choices[0].message.content
        except Exception as e:
            raise Exception(f"GPT response generation failed: {str(e)}")
            
    except Exception as e:
        raise Exception(f"Error generating response: {str(e)}")

@retry_on_exception(retries=3, delay=1)
async def text_to_speech(text, voice_model='default'):
    """Convert text to speech with improved error handling and retries."""
    try:
        if voice_model == 'openai':
            try:
                client = OpenAI(api_key=os.environ.get('OPENAI_API_KEY'))
                response = client.audio.speech.create(
                    model="tts-1",
                    voice="alloy",  # Default OpenAI voice
                    input=text,
                )
                
                audio_data = response.content
                audio_base64 = base64.b64encode(audio_data).decode()
                return f"data:audio/mp3;base64,{audio_base64}"
            except Exception as e:
                raise Exception(f"OpenAI TTS failed: {str(e)}")
        else:
            # Using gTTS for default text-to-speech conversion
            tts = gTTS(text=text, lang='en')
            
            # Save to bytes buffer
            fp = io.BytesIO()
            tts.write_to_fp(fp)
            fp.seek(0)
            
            # Convert to base64 for frontend playback
            try:
                audio_base64 = base64.b64encode(fp.read()).decode()
                return f"data:audio/mp3;base64,{audio_base64}"
            except Exception as e:
                raise Exception(f"Audio encoding failed: {str(e)}")
            
    except Exception as e:
        raise Exception(f"Text-to-speech conversion failed: {str(e)}")
