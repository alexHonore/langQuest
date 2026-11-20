"""Scan the existing MP3s for the English synthesis prompt, entirely on this machine.

Install pocketsphinx, numpy, scipy and soundfile, then run python scripts/audit-speech-prompts.py.
Multiple prompt phrases in sequence flag a clip for review. Word times are in seconds.
An isolated word is not evidence of a preamble. No audio is modified or sent to a service.
"""

import json
from math import gcd
from multiprocessing import Pool
from pathlib import Path
from tempfile import TemporaryDirectory

import numpy as np
import soundfile as sf
from pocketsphinx import Decoder
from scipy.signal import resample_poly

AUDIO = Path(__file__).resolve().parents[1] / "apps/mobile_flutter/assets/audio"
KEYWORDS = """nothing else /1e-18/
read aloud /1e-19/
only this line /1e-18/
everyday conversation /1e-22/
intonation /1e-23/
language teacher /1e-22/
unhurried /1e-24/
"""


def initialize(keywords):
    global decoder
    decoder = Decoder(kws=str(keywords), loglevel="ERROR")


def scan(path):
    samples, rate = sf.read(path, always_2d=True)
    divisor = gcd(rate, 16000)
    mono = resample_poly(samples.mean(axis=1), 16000 // divisor, rate // divisor)
    pcm = (mono * 32767).clip(-32768, 32767).astype("int16")
    decoder.start_utt()
    decoder.process_raw(pcm.tobytes(), False, True)
    decoder.end_utt()
    hits = [(word.word.strip(), word.start_frame / 100, word.end_frame / 100) for word in decoder.seg() or ()]
    style = {"language teacher", "unhurried"} if path.parent.name == "narration" or "narration" in path.parts else {"everyday conversation", "intonation"}
    delivery = [end for word, _, end in hits if word in style]
    instruction = [start for word, start, _ in hits if word in {"read aloud", "only this line", "nothing else"}]
    delivery_pair = any(word == "everyday conversation" for word, _, _ in hits) and any(word == "intonation" for word, _, _ in hits)
    read_pair = any(word == "only this line" for word, _, _ in hits) and any(word == "nothing else" for word, _, _ in hits)
    if delivery_pair or read_pair or any(end <= start for end in delivery for start in instruction):
        return {"file": str(path.relative_to(AUDIO)), "matches": hits}
    return None


if __name__ == "__main__":
    files = sorted(AUDIO.rglob("*.mp3"))
    matches = 0
    with TemporaryDirectory() as temporary:
        keywords = Path(temporary) / "keywords.txt"
        keywords.write_text(KEYWORDS)
        with Pool(2, initializer=initialize, initargs=(keywords,)) as workers:
            for result in workers.imap_unordered(scan, files, chunksize=8):
                if result:
                    print(json.dumps(result), flush=True)
                    matches += 1
    print(f"Scanned {len(files)} recordings. Found {matches} possible spoken prompts.")
    raise SystemExit(1 if matches else 0)
