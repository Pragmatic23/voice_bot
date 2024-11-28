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

@retry_on_exception(retries=3, delay=1)
async def process_audio(audio_file, api_key):
    """Process audio file using Whisper API with improved error handling and retries."""
    start_time = time.time()
    request_id = f"audio_{int(start_time * 1000)}"
    logger.info("Starting audio processing", extra={'request_id': request_id})
    
    try:
        # Detailed request logging
        logger.info(f"Audio file details - Size: {audio_file.content_length} bytes, Type: {audio_file.content_type}",
                   extra={'request_id': request_id})
        
        # Validate audio format with enhanced logging
        logger.info("Starting audio format validation", extra={'request_id': request_id})
        validation_start = time.time()
        try:
            validate_audio_format(audio_file)
            validation_time = time.time() - validation_start
            logger.info(f"Audio format validation successful in {validation_time:.2f}s - Format: {audio_file.content_type}",
                       extra={'request_id': request_id})
        except ValueError as e:
            logger.error(f"Audio format validation failed: {str(e)}",
                        extra={'request_id': request_id, 'error_type': 'ValidationError'})
            raise
        
        logger.info(f"[{request_id}] Initializing OpenAI client...")
        client = OpenAI(api_key=api_key)
        
        # Save the audio file temporarily
        logger.info(f"[{request_id}] Creating temporary audio file...")
        temp_start = time.time()
        with tempfile.NamedTemporaryFile(delete=False, suffix='.wav') as temp_audio:
            try:
                audio_file.save(temp_audio.name)
                file_size = os.path.getsize(temp_audio.name)
                logger.info(f"[{request_id}] Audio file saved: {file_size} bytes in {time.time() - temp_start:.2f}s")
                
                # Transcribe using Whisper API
                logger.info(f"[{request_id}] Initiating Whisper API request...")
                transcription_start = time.time()
                
                try:
                    with open(temp_audio.name, 'rb') as audio:
                        logger.info("Initiating Whisper API request", 
                                  extra={'request_id': request_id})
                        
                        api_start = time.time()
                        transcript = client.audio.transcriptions.create(
                            model="whisper-1",
                            file=audio,
                            language="en"
                        )
                        api_time = time.time() - api_start
                        
                        # Log API response details
                        logger.info(
                            "Whisper API response received",
                            extra={
                                'request_id': request_id,
                                'api_response_time': f"{api_time:.2f}s",
                                'text_length': len(transcript.text),
                                'model': 'whisper-1'
                            }
                        )
                        
                        # Log text preview with proper truncation
                        preview = transcript.text[:100] + ('...' if len(transcript.text) > 100 else '')
                        logger.info(f"Transcribed text preview: {preview}",
                                  extra={'request_id': request_id})
                        
                        # Calculate and log total processing time
                        total_time = time.time() - start_time
                        logger.info(
                            "Audio processing completed",
                            extra={
                                'request_id': request_id,
                                'total_time': f"{total_time:.2f}s",
                                'transcription_time': f"{api_time:.2f}s"
                            }
                        )
                        return transcript.text
                    
                except Exception as e:
                    error_type = type(e).__name__
                    error_details = {
                        'request_id': request_id,
                        'error_type': error_type,
                        'error_message': str(e),
                        'processing_stage': 'whisper_api',
                        'processing_time': f"{time.time() - api_start:.2f}s"
                    }
                    logger.error("Whisper API transcription failed", extra=error_details)
                    raise Exception(f"Transcription failed ({error_type}): {str(e)}")
                    
            except Exception as e:
                error_type = type(e).__name__
                error_details = {
                    'request_id': request_id,
                    'error_type': error_type,
                    'error_message': str(e),
                    'processing_stage': 'audio_processing'
                }
                logger.error("Error in audio processing", extra=error_details)
                raise
            finally:
                # Enhanced cleanup logging
                cleanup_start = time.time()
                try:
                    os.unlink(temp_audio.name)
                    cleanup_time = time.time() - cleanup_start
                    logger.info(f"Temporary file cleanup successful in {cleanup_time:.2f}s",
                              extra={'request_id': request_id})
                except Exception as e:
                    logger.warning("Failed to cleanup temporary file",
                                 extra={
                                     'request_id': request_id,
                                     'error_type': type(e).__name__,
                                     'error_message': str(e)
                                 })
                    
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
