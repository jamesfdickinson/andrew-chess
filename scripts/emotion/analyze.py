"""Local vocal-emotion estimates. No camera, transcript inference or cloud calls."""
import argparse
import json
import os
from pathlib import Path
import time
import wave

ROOT = Path(__file__).resolve().parents[2]
HOME = ROOT / '.emotion'
MODEL = HOME / 'models' / 'emotion2vec-plus-large'
MODEL_ID = 'emotion2vec/emotion2vec_plus_large'
REVISION = '6c303ba987b86b93193de93e34bb2b077a6bedc4'


def load_model():
    import torch
    from funasr import AutoModel
    requested = os.environ.get('COACH_EMOTION_DEVICE', 'auto')
    device = 'cpu'
    if requested not in ('auto', 'cpu', 'cuda:0'):
        raise ValueError('COACH_EMOTION_DEVICE must be auto, cpu or cuda:0')
    if requested != 'cpu' and torch.cuda.is_available():
        free, _ = torch.cuda.mem_get_info()
        if free >= 2500 * 1024 ** 2:
            device = 'cuda:0'
    if requested == 'cuda:0' and device == 'cpu':
        raise RuntimeError('CUDA requested but unavailable or less than 2.5 GB free. Use auto or cpu.')
    torch.set_num_threads(min(8, os.cpu_count() or 4))
    model = AutoModel(model=str(MODEL), device=device, disable_update=True, disable_pbar=True, trust_remote_code=False)
    return model, device, torch


def audio_samples(file):
    import numpy as np
    with wave.open(str(file), 'rb') as wav:
        if wav.getnchannels() != 1 or wav.getframerate() != 16000 or wav.getsampwidth() != 2:
            raise ValueError('Emotion input must be 16 kHz mono PCM16 WAV.')
        return np.frombuffer(wav.readframes(wav.getnframes()), dtype='<i2').astype('float32') / 32768.0


def classify(model, samples):
    import numpy as np
    if len(samples) < 8000 or float(np.sqrt(np.mean(samples ** 2))) < 0.004:
        return {'status': 'insufficient_audio', 'scores': {}, 'label': 'unknown', 'score': 0, 'margin': 0}
    result = model.generate(samples, granularity='utterance', extract_embedding=False, disable_pbar=True)[0]
    scores = {('unknown' if label == '<unk>' else label.split('/')[-1].strip().lower()): float(score)
              for label, score in zip(result['labels'], result['scores'])}
    ordered = sorted(scores.items(), key=lambda item: item[1], reverse=True)
    if len(ordered) < 2 or not all(np.isfinite(score) for score in scores.values()):
        raise ValueError('Emotion model returned invalid class scores.')
    label, score = ordered[0]
    return {'status': 'estimated', 'scores': scores, 'label': label, 'score': score, 'margin': score - ordered[1][1]}


def setup():
    from huggingface_hub import snapshot_download
    HOME.mkdir(exist_ok=True)
    ready_file = HOME / 'ready.json'
    ready_file.unlink(missing_ok=True)
    snapshot_download(repo_id=MODEL_ID, revision=REVISION, local_dir=MODEL,
                      allow_patterns=['model.pt', 'config.yaml', 'configuration.json', 'tokens.txt', 'README.md', 'example/test.wav'])
    # Self-test the installed stack before reporting readiness; inference thereafter
    # always resolves this pinned local directory, never a remote model identifier.
    os.environ['HF_HUB_OFFLINE'] = '1'
    model, device, torch = load_model()
    result = classify(model, audio_samples(MODEL / 'example/test.wav'))
    metadata = {'ready': True, 'model': MODEL_ID, 'revision': REVISION, 'device': device,
                'torch': torch.__version__, 'cudaAvailable': torch.cuda.is_available(),
                'selfTest': result, 'installedAt': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())}
    ready_file.write_text(json.dumps(metadata, indent=2), encoding='utf-8')
    print(json.dumps({'ready': True, 'device': device, 'selfTestLabel': result['label']}))


def analyze(audio, segments_file, output):
    samples = audio_samples(audio)
    duration = len(samples) / 16000
    if not 0 < duration <= 120:
        raise ValueError('Emotion clips must be 0–120 seconds.')
    segments = json.loads(Path(segments_file).read_text(encoding='utf-8'))
    model, device, torch = load_model()
    started = time.perf_counter()
    results = []
    with torch.inference_mode():
        for segment in segments:
            start, end = float(segment['start']), float(segment['end'])
            if not 0 <= start < end <= duration + 0.02 or end - start > 10:
                raise ValueError('Invalid emotion segment. Use windows up to ten seconds.')
            # Short final segments borrow nearby acoustic context, explicitly recorded.
            context_start = max(0, min(start, end - 1.0))
            context_end = min(duration, max(end, context_start + 1.0))
            window = samples[round(context_start * 16000):round(context_end * 16000)]
            result = classify(model, window) if segment.get('hasSpeech', True) else {
                'status': 'no_recognized_speech', 'scores': {}, 'label': 'unknown', 'score': 0, 'margin': 0}
            results.append({'start': start, 'end': end, 'contextStart': context_start, 'contextEnd': context_end, **result})
    result = {'schemaVersion': 1, 'status': 'complete', 'model': MODEL_ID, 'revision': REVISION,
              'modality': 'audio', 'device': device, 'duration': duration,
              'elapsedSeconds': round(time.perf_counter() - started, 3),
              'peakGpuMB': round(torch.cuda.max_memory_allocated() / 1024 ** 2) if device.startswith('cuda') else None,
              'peakGpuReservedMB': round(torch.cuda.max_memory_reserved() / 1024 ** 2) if device.startswith('cuda') else None,
              'note': 'Class scores are uncalibrated model estimates, not probabilities that the acting emotion is correct. Facial expression and gestures were not analyzed.',
              'segments': results}
    Path(output).write_text(json.dumps(result, indent=2), encoding='utf-8')


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--setup', action='store_true')
    parser.add_argument('--audio')
    parser.add_argument('--segments')
    parser.add_argument('--output')
    args = parser.parse_args()
    if args.setup:
        setup()
    elif args.audio and args.segments and args.output:
        analyze(args.audio, args.segments, args.output)
    else:
        parser.error('Supply --setup or --audio, --segments and --output.')
