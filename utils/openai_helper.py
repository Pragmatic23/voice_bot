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

@retry_on_exception(retries=3, delay=1)
async def process_audio(audio_file, api_key):
    """Process audio file using Whisper API with improved error handling and retries."""
    start_time = time.time()
    request_id = f"audio_{int(start_time * 1000)}"
    logger.info("Starting audio processing", extra={'request_id': request_id})
    
    try:
        # Convert WebM to WAV if needed
        if audio_file.content_type.startswith('audio/webm'):
            import subprocess
            
            logger.info("Converting WebM to WAV format", extra={'request_id': request_id})
            
            with tempfile.NamedTemporaryFile(suffix='.webm', delete=False) as temp_webm:
                try:
                    # Save WebM file
                    audio_file.save(temp_webm.name)
                    temp_webm.flush()
                    os.fsync(temp_webm.fileno())
                    
                    # Create WAV file
                    wav_file = tempfile.NamedTemporaryFile(suffix='.wav', delete=False)
                    wav_path = wav_file.name
                    wav_file.close()
                    
                    # Enhanced FFmpeg command with better WebM/Opus handling
                    conversion_command = [
                        'ffmpeg',
                        '-y',  # Overwrite output file
                        '-f', 'webm',  # Force WebM format for input
                        '-i', temp_webm.name,
                        '-acodec', 'pcm_s16le',  # Output codec
                        '-ar', '16000',  # Sample rate
                        '-ac', '1',  # Mono audio
                        '-af', 'aresample=resampler=soxr',  # High quality resampling
                        wav_path
                    ]
                    
                    # Run conversion with detailed error capturing
                    process = subprocess.run(
                        conversion_command,
                        capture_output=True,
                        text=True,
                        check=True
                    )
                    
                    # Verify the converted file exists and has content
                    if not os.path.exists(wav_path) or os.path.getsize(wav_path) == 0:
                        raise ValueError("Conversion produced empty or missing file")
                    
                    logger.info(
                        "Successfully converted WebM to WAV",
                        extra={
                            'request_id': request_id,
                            'output_size': os.path.getsize(wav_path)
                        }
                    )
                    
                    # Create OpenAI client
                    client = OpenAI(api_key=api_key)
                    
                    # Transcribe using Whisper API
                    logger.info(f"[{request_id}] Initiating Whisper API request...")
                    with open(wav_path, 'rb') as audio:
                        transcript = client.audio.transcriptions.create(
                            model="whisper-1",
                            file=audio,
                            language="en"
                        )
                        
                    return transcript.text
                    
                except subprocess.CalledProcessError as e:
                    error_msg = e.stderr if isinstance(e.stderr, str) else e.stderr.decode()
                    logger.error(f"FFmpeg conversion failed: {error_msg}", extra={'request_id': request_id})
                    raise ValueError(f"Audio conversion failed: {error_msg}")
                    
                except Exception as e:
                    logger.error(f"Error processing audio: {str(e)}", extra={'request_id': request_id})
                    raise
                    
                finally:
                    # Clean up temporary files
                    try:
                        if os.path.exists(temp_webm.name):
                            os.unlink(temp_webm.name)
                        if os.path.exists(wav_path):
                            os.unlink(wav_path)
                    except Exception as e:
                        logger.warning(f"Failed to cleanup temp files: {str(e)}", 
                                     extra={'request_id': request_id})
        else:
            # Direct processing for WAV files
            client = OpenAI(api_key=api_key)
            transcript = client.audio.transcriptions.create(
                model="whisper-1",
                file=audio_file,
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
                    voice="alloy",
                    input=text
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
            audio_base64 = base64.b64encode(fp.read()).decode()
            return f"data:audio/mp3;base64,{audio_base64}"
            
    except Exception as e:
        raise Exception(f"Text-to-speech conversion failed: {str(e)}")

def validate_audio_format(audio_file):
    """Validate and ensure proper audio format."""
    allowed_base_types = {
        'audio/wav': [''],
        'audio/wave': [''],
        'audio/x-wav': [''],
        'audio/webm': ['opus']
    }
    
    if not hasattr(audio_file, 'content_type'):
        raise ValueError("Invalid audio file: Missing content type")
    
    # Parse content type and codec
    content_parts = audio_file.content_type.split(';')
    base_type = content_parts[0].strip()
    codec = ''
    
    if len(content_parts) > 1:
        codec_part = [p for p in content_parts[1:] if 'codecs=' in p]
        if codec_part:
            codec = codec_part[0].split('=')[1].strip('"')
    
    # Validate base type and codec
    if base_type not in allowed_base_types:
        supported_formats = [f"{t}{';codecs=' + c if c else ''}" 
                           for t, codecs in allowed_base_types.items() 
                           for c in codecs]
        raise ValueError(f"Unsupported audio format: {audio_file.content_type}. "
                        f"Supported formats: {', '.join(supported_formats)}")
    
    if codec and codec not in allowed_base_types[base_type]:
        raise ValueError(f"Unsupported codec: {codec} for format {base_type}")
    
    return True