"""Persistent CPU speech worker. JSON lines in/out; diagnostics go to stderr."""
import base64
import contextlib
import io
import json
import os
import sys
import time
import wave


def emit(value):
    print(json.dumps(value), flush=True)


def main():
    # Third-party startup/download messages must not corrupt the JSON protocol.
    with contextlib.redirect_stdout(sys.stderr):
        import numpy as np
        from paradee import Paradee, SAMPLE_RATE
        voice = os.environ.get("PARADEE_VOICE", "am_puck")
        tts = Paradee(threads=1)
        tts("Welcome to the courtyard.", voice=voice)
    emit({"ready": True, "model": "Paradee-8M-v1.3", "voice": voice})
    for line in sys.stdin:
        request = json.loads(line)
        try:
            text = request["text"]
            if not isinstance(text, str) or not text.strip() or len(text) > 600:
                raise ValueError("Invalid speech text")
            started = time.perf_counter()
            with contextlib.redirect_stdout(sys.stderr):
                audio = tts(text, voice=voice)
            pcm = (np.clip(audio, -1, 1) * 32767).astype("<i2")
            output = io.BytesIO()
            with wave.open(output, "wb") as wav:
                wav.setnchannels(1)
                wav.setsampwidth(2)
                wav.setframerate(SAMPLE_RATE)
                wav.writeframes(pcm.tobytes())
            emit({"id": request["id"], "wav": base64.b64encode(output.getvalue()).decode("ascii"),
                  "latencyMs": round((time.perf_counter() - started) * 1000),
                  "durationMs": round(len(audio) / SAMPLE_RATE * 1000)})
        except Exception as error:
            print(str(error), file=sys.stderr, flush=True)
            emit({"id": request.get("id"), "error": "Local speech generation failed"})


if __name__ == "__main__":
    main()
