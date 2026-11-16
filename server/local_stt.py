"""Local Parakeet-TDT v2 INT8 transcription. No network or audio files at runtime."""
import base64
import contextlib
import io
import json
from pathlib import Path
import sys
import time
import wave


def load_recognizer():
    import sherpa_onnx
    model = Path(__file__).resolve().parent.parent / ".local-stt" / "model"
    return sherpa_onnx.OfflineRecognizer.from_transducer(
        encoder=str(model / "encoder.int8.onnx"),
        decoder=str(model / "decoder.int8.onnx"),
        joiner=str(model / "joiner.int8.onnx"),
        tokens=str(model / "tokens.txt"),
        num_threads=2, sample_rate=16000, feature_dim=80,
        decoding_method="greedy_search", model_type="nemo_transducer", provider="cpu",
    )


def main():
    with contextlib.redirect_stdout(sys.stderr):
        import numpy as np
        recognizer = load_recognizer()
    print(json.dumps({"ready": True}), flush=True)
    for line in sys.stdin:
        request = json.loads(line)
        try:
            started = time.perf_counter()
            with wave.open(io.BytesIO(base64.b64decode(request["wav"])), "rb") as wav:
                if wav.getnchannels() != 1 or wav.getsampwidth() != 2 or wav.getframerate() != 16000 or not 1600 <= wav.getnframes() <= 480000:
                    raise ValueError("Expected mono 16 kHz PCM, 0.1 to 30 seconds")
                samples = np.frombuffer(wav.readframes(wav.getnframes()), dtype="<i2").astype(np.float32) / 32768
            text = ""
            if np.max(np.abs(samples)) > 0.0001:
                stream = recognizer.create_stream()
                stream.accept_waveform(16000, samples)
                with contextlib.redirect_stdout(sys.stderr):
                    recognizer.decode_stream(stream)
                text = stream.result.text.strip()
            print(json.dumps({"id": request["id"], "text": text, "latencyMs": round((time.perf_counter() - started) * 1000)}), flush=True)
        except Exception as error:
            print(str(error), file=sys.stderr, flush=True)
            print(json.dumps({"id": request.get("id"), "error": "Local transcription failed"}), flush=True)


if __name__ == "__main__":
    main()
