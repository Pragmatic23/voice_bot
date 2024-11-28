from openai import OpenAI
import base64
import tempfile
import requests
import os
import logging
import time
from datetime import datetime
from gtts import gTTS
import io
from functools import wraps
import subprocess

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

def log_timing(func_name, start_time):
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

async def process_audio(audio_data, api_key, streaming=False):
    """Process audio data with streaming support."""
    start_time = time.time()
    request_id = f"audio_{int(start_time * 1000)}"
    logger.info("Starting audio processing", extra={'request_id': request_id})
    
    try:
        if streaming:
            # Handle streaming audio chunk
            with tempfile.NamedTemporaryFile(suffix='.webm', delete=False) as temp_webm:
                if isinstance(audio_data, bytes):
                    temp_webm.write(audio_data)
                else:
                    temp_webm.write(audio_data.read())
                temp_webm.flush()
                
                # Convert to WAV
                wav_file = tempfile.NamedTemporaryFile(suffix='.wav', delete=False)
                wav_path = wav_file.name
                wav_file.close()
                
                try:
                    # Enhanced FFmpeg command for streaming
                    conversion_command = [
                        'ffmpeg',
                        '-y',
                        '-f', 'webm',
                        '-i', temp_webm.name,
                        '-acodec', 'pcm_s16le',
                        '-ar', '16000',
                        '-ac', '1',
                        '-af', 'aresample=resampler=soxr',
                        '-f', 'wav',
                        wav_path
                    ]
                    
                    process = subprocess.run(
                        conversion_command,
                        capture_output=True,
                        text=True,
                        check=True
                    )
                    
                    # Transcribe using Whisper API
                    client = OpenAI(api_key=api_key)
                    with open(wav_path, 'rb') as audio:
                        response = client.audio.transcriptions.create(
                            model="whisper-1",
                            file=audio,
                            language="en"
                        )
                    return response.text
                    
                except subprocess.CalledProcessError as e:
                    logger.error(f"FFmpeg conversion failed: {e.stderr}", 
                               extra={'request_id': request_id})
                    raise ValueError(f"Audio conversion failed: {e.stderr}")
                finally:
                    # Cleanup temporary files
                    try:
                        os.unlink(temp_webm.name)
                        if os.path.exists(wav_path):
                            os.unlink(wav_path)
                    except Exception as e:
                        logger.warning(f"Failed to cleanup temp files: {str(e)}", 
                                     extra={'request_id': request_id})
        else:
            # Handle regular audio file
            client = OpenAI(api_key=api_key)
            transcript = client.audio.transcriptions.create(
                model="whisper-1",
                file=audio_data,
                language="en"
            )
            return transcript.text
            
    except Exception as e:
        logger.error(f"[{request_id}] Audio processing failed: {str(e)}")
        raise Exception(f"Audio processing failed: {str(e)}")

@retry_on_exception(retries=3, delay=1)
async def generate_response(text, category, history, api_key):
    """Generate response using GPT with improved error handling and retries."""
    try:
        client = OpenAI(api_key=api_key)
        
        system_messages = {
            'soft_skills': "You are an expert in soft skills and communication coaching. Always respond in English.",
            'interview': "You are an experienced interview coach and career counselor. Always respond in English.",
            'personality': "You are a personality development coach focusing on personal growth. Always respond in English.",
            'general': "You are a helpful life coach providing general advice and guidance. Always respond in English."
        }
        
        messages = [
            {"role": "system", "content": system_messages.get(category, system_messages['general'])}
        ]
        
        for msg in history:
            messages.append(msg)
            
        messages.append({"role": "user", "content": text})
        
        response = client.chat.completions.create(
            model="gpt-4",
            messages=messages,
            temperature=0.7,
            max_tokens=150
        )
        
        return response.choices[0].message.content
        
    except Exception as e:
        raise Exception(f"Error generating response: {str(e)}")

@retry_on_exception(retries=3, delay=1)
async def text_to_speech(text, voice_model='default'):
    """Convert text to speech with improved error handling and retries."""
    try:
        if voice_model == 'openai':
            client = OpenAI(api_key=os.environ.get('OPENAI_API_KEY'))
            response = client.audio.speech.create(
                model="tts-1",
                voice="alloy",
                input=text
            )
            
            audio_data = response.content
            audio_base64 = base64.b64encode(audio_data).decode()
            return f"data:audio/mp3;base64,{audio_base64}"
        else:
            tts = gTTS(text=text, lang='en')
            fp = io.BytesIO()
            tts.write_to_fp(fp)
            fp.seek(0)
            
            audio_base64 = base64.b64encode(fp.read()).decode()
            return f"data:audio/mp3;base64,{audio_base64}"
            
    except Exception as e:
        raise Exception(f"Text-to-speech conversion failed: {str(e)}")