#!/usr/bin/env python3
"""本地转写（《优化清单》第 9 条）：在本体所在的机器上把一段 16kHz 单声道 wav 转成带时间的句子，输出一行 JSON。

引擎可替换：
  sensevoice      sherpa-onnx + SenseVoiceSmall int8（模型目录里有 model.int8.onnx、tokens.txt，
                  可选 silero_vad.onnx 用来按停顿切段；没有 VAD 就按 20 秒一段切）。CPU 上快，中文准。
  faster-whisper  CTranslate2 int8（--model 写 small / medium 或本地目录），多语种，CPU 上慢一些。

用法：python3 transcribe.py --engine sensevoice --model /path/to/model-dir --threads 2 audio.wav
输出：{"engine": "...", "audioSeconds": 123.4, "peakMb": 512.0, "segments": [{"start": 0.0, "text": "..."}]}
"""

import argparse
import json
import os
import resource
import sys
import wave

SAMPLE_RATE = 16000
CHUNK_SECONDS = 20


def peak_mb():
    # Linux 上 ru_maxrss 的单位是 KB。
    return round(resource.getrusage(resource.RUSAGE_SELF).ru_maxrss / 1024, 1)


def read_wav(path):
    import numpy as np

    with wave.open(path, "rb") as audio:
        if audio.getnchannels() != 1 or audio.getsampwidth() != 2 or audio.getframerate() != SAMPLE_RATE:
            raise SystemExit("要 16kHz 单声道 16 位 wav（ffmpeg -ac 1 -ar 16000 -sample_fmt s16）")
        frames = audio.readframes(audio.getnframes())
    return np.frombuffer(frames, dtype=np.int16).astype(np.float32) / 32768.0


def sense_voice(model_dir, threads, path):
    import sherpa_onnx

    samples = read_wav(path)
    recognizer = sherpa_onnx.OfflineRecognizer.from_sense_voice(
        model=os.path.join(model_dir, "model.int8.onnx"),
        tokens=os.path.join(model_dir, "tokens.txt"),
        num_threads=threads,
        use_itn=True,
        language="auto",
    )
    pieces = list(vad_pieces(model_dir, samples)) or list(fixed_pieces(samples))
    segments = []
    for start, chunk in pieces:
        stream = recognizer.create_stream()
        stream.accept_waveform(SAMPLE_RATE, chunk)
        recognizer.decode_stream(stream)
        text = stream.result.text.strip()
        if text:
            segments.append({"start": round(start, 2), "text": text})
    return len(samples) / SAMPLE_RATE, segments


def fixed_pieces(samples):
    size = CHUNK_SECONDS * SAMPLE_RATE
    for offset in range(0, len(samples), size):
        yield offset / SAMPLE_RATE, samples[offset:offset + size]


def vad_pieces(model_dir, samples):
    vad_model = os.path.join(model_dir, "silero_vad.onnx")
    if not os.path.exists(vad_model):
        return
    import sherpa_onnx

    config = sherpa_onnx.VadModelConfig()
    config.silero_vad.model = vad_model
    config.silero_vad.min_silence_duration = 0.4
    config.silero_vad.max_speech_duration = CHUNK_SECONDS
    config.sample_rate = SAMPLE_RATE
    vad = sherpa_onnx.VoiceActivityDetector(config, buffer_size_in_seconds=60)
    window = config.silero_vad.window_size
    for offset in range(0, len(samples), window):
        vad.accept_waveform(samples[offset:offset + window])
        while not vad.empty():
            yield vad.front.start / SAMPLE_RATE, vad.front.samples
            vad.pop()
    vad.flush()
    while not vad.empty():
        yield vad.front.start / SAMPLE_RATE, vad.front.samples
        vad.pop()


def faster_whisper(model, threads, path):
    from faster_whisper import WhisperModel

    whisper = WhisperModel(model, device="cpu", compute_type="int8", cpu_threads=threads)
    # 直接给采样好的数组：不经 PyAV 解码（PyAV 版本和 faster-whisper 对不上时会在 open 里报错）。
    samples = read_wav(path)
    pieces, info = whisper.transcribe(samples, beam_size=1, vad_filter=True, initial_prompt="以下是普通话的句子。")
    segments = [{"start": round(piece.start, 2), "text": piece.text.strip()} for piece in pieces if piece.text.strip()]
    return info.duration, segments


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--engine", choices=["sensevoice", "faster-whisper"], required=True)
    parser.add_argument("--model", required=True)
    parser.add_argument("--threads", type=int, default=2)
    parser.add_argument("audio")
    args = parser.parse_args()
    if args.engine == "sensevoice":
        seconds, segments = sense_voice(args.model, args.threads, args.audio)
    else:
        seconds, segments = faster_whisper(args.model, args.threads, args.audio)
    json.dump({"engine": args.engine, "audioSeconds": round(seconds, 2), "peakMb": peak_mb(),
               "segments": segments}, sys.stdout, ensure_ascii=False)


if __name__ == "__main__":
    main()
