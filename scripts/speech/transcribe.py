"""Local-only transcription. Setup downloads the model; inference never downloads."""
import argparse
import json
import os
import wave
import numpy as np
from pathlib import Path

parser = argparse.ArgumentParser()
parser.add_argument('--setup', action='store_true')
parser.add_argument('--audio')
parser.add_argument('--output')
args = parser.parse_args()
root = Path(__file__).resolve().parents[2]
model_path = root / '.speech' / 'models' / 'base.en'
os.environ.setdefault('HF_HOME', str(root / '.speech' / 'cache' / 'huggingface'))
os.environ.setdefault('HF_HUB_DISABLE_TELEMETRY', '1')
if args.setup:
    from faster_whisper.utils import download_model
    download_model('base.en', output_dir=str(model_path))
    from faster_whisper import WhisperModel
    WhisperModel(str(model_path), device='cpu', compute_type='int8', local_files_only=True)
    (root / '.speech' / 'ready.json').write_text(json.dumps({'engine': 'faster-whisper', 'model': 'base.en', 'device': 'cpu', 'computeType': 'int8'}))
    print('Local speech recognition ready.')
else:
    from faster_whisper import WhisperModel
    model = WhisperModel(str(model_path), device='cpu', compute_type='int8', cpu_threads=min(8, os.cpu_count() or 4), local_files_only=True)
    # Pipeline audio is already mono 16 kHz PCM; avoid another codec decode.
    with wave.open(args.audio, 'rb') as audio_file:
        if audio_file.getnchannels() != 1 or audio_file.getframerate() != 16000 or audio_file.getsampwidth() != 2:
            raise ValueError('Expected mono 16 kHz PCM audio from the analysis pipeline')
        audio = np.frombuffer(audio_file.readframes(audio_file.getnframes()), dtype=np.int16).astype(np.float32) / 32768.0
    segments, info = model.transcribe(audio, language='en', beam_size=5, word_timestamps=True, vad_filter=True, condition_on_previous_text=False)
    result = {'engine': 'faster-whisper', 'model': 'base.en', 'language': info.language, 'duration': info.duration, 'segments': [], 'words': []}
    for segment in segments:
        result['segments'].append({'start': segment.start, 'end': segment.end, 'text': segment.text, 'noSpeechProbability': segment.no_speech_prob})
        for word in segment.words or []:
            result['words'].append({'start': word.start, 'end': word.end, 'text': word.word.strip(), 'probability': word.probability})
    result['text'] = ' '.join(segment['text'].strip() for segment in result['segments'])
    Path(args.output).write_text(json.dumps(result, indent=2), encoding='utf-8')
