from openai import OpenAI
import base64
import tempfile
import requests
from gtts import gTTS
import io
import os
import logging
import mimetypes

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

def validate_audio_file(file):
    """Validate the audio file format and size."""
    if not file:
        raise ValueError("No audio file provided")
    
    # Check file size (max 25MB)
    file.seek(0, os.SEEK_END)
    size = file.tell()
    file.seek(0)
    if size > 25 * 1024 * 1024:
        raise ValueError("Audio file size exceeds 25MB limit")
    
    # Check file format
    content_type = file.content_type if hasattr(file, 'content_type') else mimetypes.guess_type(file.filename)[0]
    allowed_formats = {'audio/wav', 'audio/x-wav', 'audio/mpeg', 'audio/mp3', 'audio/webm'}
    
    if not content_type or content_type not in allowed_formats:
        raise ValueError(f"Unsupported audio format. Supported formats: WAV, MP3, WebM")
    
    return True

def process_audio(audio_file, api_key):
    """Process audio file with improved error handling and validation."""
    try:
        # Validate audio file
        validate_audio_file(audio_file)
        logger.info(f"Processing audio file: {audio_file.filename}")
        
        client = OpenAI(api_key=api_key)
        
        # Save the audio file temporarily
        with tempfile.NamedTemporaryFile(delete=False, suffix='.wav') as temp_audio:
            try:
                audio_file.save(temp_audio.name)
                logger.info("Audio file saved temporarily")
                
                # Transcribe using Whisper API
                with open(temp_audio.name, 'rb') as audio:
                    try:
                        transcript = client.audio.transcriptions.create(
                            model="whisper-1",
                            file=audio
                        )
                        logger.info("Audio transcription successful")
                        return transcript.text
                    except Exception as e:
                        logger.error(f"OpenAI API error during transcription: {str(e)}")
                        raise Exception(f"Failed to transcribe audio: {str(e)}")
            finally:
                # Clean up temporary file
                try:
                    os.unlink(temp_audio.name)
                except Exception as e:
                    logger.warning(f"Failed to delete temporary file: {str(e)}")
                    
    except ValueError as ve:
        logger.error(f"Validation error: {str(ve)}")
        raise
    except Exception as e:
        logger.error(f"Unexpected error in process_audio: {str(e)}")
        raise Exception(f"Failed to process audio: {str(e)}")

def generate_response(text, category, history, api_key):
    """Generate response with improved error handling."""
    try:
        client = OpenAI(api_key=api_key)
        
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
        
        try:
            # Generate response using GPT-4
            response = client.chat.completions.create(
                model="gpt-4",
                messages=messages,
                temperature=0.7,
                max_tokens=150
            )
            
            logger.info("Successfully generated response from OpenAI")
            return response.choices[0].message.content
        except Exception as e:
            logger.error(f"OpenAI API error during response generation: {str(e)}")
            raise Exception(f"Failed to generate response: {str(e)}")
            
    except Exception as e:
        logger.error(f"Error in generate_response: {str(e)}")
        raise

def text_to_speech(text):
    """Convert text to speech with improved error handling."""
    try:
        if not text or not isinstance(text, str):
            raise ValueError("Invalid text input for speech conversion")
            
        # Using gTTS for text-to-speech conversion
        tts = gTTS(text=text, lang='en')
        
        # Save to bytes buffer
        fp = io.BytesIO()
        tts.write_to_fp(fp)
        fp.seek(0)
        
        # Convert to base64 for frontend playback
        audio_base64 = base64.b64encode(fp.read()).decode()
        logger.info("Successfully converted text to speech")
        return f"data:audio/mp3;base64,{audio_base64}"
        
    except Exception as e:
        logger.error(f"Error in text_to_speech: {str(e)}")
        raise Exception(f"Failed to convert text to speech: {str(e)}")
