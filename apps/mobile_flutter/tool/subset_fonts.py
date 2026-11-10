"""Bundled font subsets for the scripts the interface fonts (Inter, Outfit) do not cover.

Without them, the web build draws Arabic, Japanese, Chinese, Korean, Hebrew and Devanagari text with fallback fonts
that the Flutter web engine downloads from fonts.gstatic.com at runtime (the learner's IP goes to Google, and nothing
renders offline), and it picks Chinese or Japanese forms for kanji by the browser's language, not the phrase's.
iOS and Android use system fonts and a phrase's locale; the subsets are harmless there.

Each subset is a static Regular (400) and Bold (700) instance of a Noto Sans font from the Google Fonts repository,
pinned to one commit and checked by SHA-256, holding:
  * every character of that script used by the content bundle (assets/content/*.json) and the interface, and
  * whole blocks where they are small (kana and CJK punctuation for Japanese; Arabic; Hebrew), so most content edits
    need no new subset. Chinese, Korean and Devanagari appear only in course names: just those characters. test/script_fonts_test.dart fails when the bundle uses a character a subset lacks.

Run from apps/mobile_flutter after the content bundle changes (needs Python 3 and network access):
  python3 -m venv /tmp/fonts-venv && /tmp/fonts-venv/bin/pip install fonttools==4.68.0
  /tmp/fonts-venv/bin/python tool/subset_fonts.py
"""

from __future__ import annotations

import hashlib
import io
import json
import pathlib
import sys
import unicodedata
import urllib.request

from fontTools import subset
from fontTools.ttLib import TTFont
from fontTools.varLib import instancer

GOOGLE_FONTS_COMMIT = "5bb28733cec313b63fbd415b574b5ae35c8aa8b8"
RAW = f"https://raw.githubusercontent.com/google/fonts/{GOOGLE_FONTS_COMMIT}/ofl"

ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT = ROOT / "assets" / "fonts" / "scripts"
UI_FONTS = ["Inter-Regular.ttf", "Inter-Medium.ttf", "Inter-SemiBold.ttf", "Outfit-SemiBold.ttf", "Outfit-Bold.ttf"]


def block(first: int, last: int) -> set[int]:
    return set(range(first, last + 1))


KANA = block(0x3040, 0x30FF)  # Hiragana, Katakana
CJK_PUNCTUATION = block(0x3000, 0x303F) | block(0xFF01, 0xFF5E)  # 、。「」 and fullwidth ！？…

# family id → (directory, file, sha256, scripts (primaryScript values of tracks), whole blocks, extra axes)
FONTS = {
    "NotoSansJP": ("notosansjp", "NotoSansJP[wght].ttf",
                   "c2f3b4d463500a2ddcd3849cded1fceeb9fd6d1c32e6cbecd568453ba50fc68f",
                   {"Jpan"}, KANA | CJK_PUNCTUATION, {}),
    "NotoSansSC": ("notosanssc", "NotoSansSC[wght].ttf",
                   "a3041811a78c361b1de50f953c805e0244951c21c5bd412f7232ef0d899af0da",
                   {"Hans"}, set(), {}),
    "NotoSansTC": ("notosanstc", "NotoSansTC[wght].ttf",
                   "864727d210d54f2537bbe23b3a839436c3992af72de9322af5270897246bd44f",
                   {"Hant"}, set(), {}),
    "NotoSansKR": ("notosanskr", "NotoSansKR[wght].ttf",
                   "194018e6b2b293a7964f037b25c0249ce1418bc9ab3c971060a03aa57861e252",
                   {"Kore"}, set(), {}),
    "NotoSansArabic": ("notosansarabic", "NotoSansArabic[wdth,wght].ttf",
                       "63111b5b2e074dd48cc67692e0a2726d86ee94c1c37fe8598257b7b4e87e869e",
                       {"Arab"}, block(0x0600, 0x06FF), {"wdth": 100}),
    "NotoSansHebrew": ("notosanshebrew", "NotoSansHebrew[wdth,wght].ttf",
                       "7ef36a2c3593758cdb622e1bdef4f84523e92fbc3ccc667438dd80ff54c2de88",
                       {"Hebr"}, block(0x0590, 0x05FF), {"wdth": 100}),
    "NotoSansDevanagari": ("notosansdevanagari", "NotoSansDevanagari[wdth,wght].ttf",
                           "14ec4af41f27482216d1c2229f417ff9b1425e1babb014e57d1d40d03229853e",
                           {"Deva"}, set(), {"wdth": 100}),
}
WEIGHTS = {"Regular": 400, "Bold": 700}


def fetch(url: str, sha256: str | None = None) -> bytes:
    with urllib.request.urlopen(url, timeout=120) as response:
        data = response.read()
    if sha256 is not None and hashlib.sha256(data).hexdigest() != sha256:
        sys.exit(f"{url}: SHA-256 mismatch (expected {sha256}); check the pinned commit before updating the hash")
    return data


def strings(value) -> list[str]:
    if isinstance(value, str):
        return [value]
    if isinstance(value, dict):
        return [s for v in value.values() for s in strings(v)]
    if isinstance(value, list):
        return [s for v in value for s in strings(v)]
    return []


def needed_by_family(ui_cmap: set[int]) -> dict[str, set[int]]:
    """Characters outside the interface fonts, per family, from the tracks that use each script."""
    catalog = json.loads((ROOT / "assets/content/catalog.json").read_text("utf-8"))
    chapters = json.loads((ROOT / "assets/content/chapters.json").read_text("utf-8"))["chapters"]
    texts_by_script: dict[str, list[str]] = {}
    for track in catalog["tracks"]:
        texts = [track["nativeName"]] + [s for c in chapters if c["courseTrackId"] == track["id"] for s in strings(c)]
        texts_by_script.setdefault(track["primaryScript"], []).extend(texts)
    needed = {}
    for family, (_, _, _, scripts, blocks, _) in FONTS.items():
        chars = {ord(ch) for s in scripts for text in texts_by_script.get(s, []) for ch in text}
        needed[family] = {cp for cp in chars if cp not in ui_cmap and not unicodedata.category(chr(cp)).startswith(("C", "Z"))} | blocks
    return needed


def main() -> None:
    ui_cmap: set[int] = set()
    for name in UI_FONTS:
        ui_cmap |= set(TTFont(ROOT / "assets/fonts" / name).getBestCmap())
    needed = needed_by_family(ui_cmap)
    OUT.mkdir(parents=True, exist_ok=True)
    for family, (directory, file, sha256, _, _, axes) in FONTS.items():
        source = fetch(f"{RAW}/{directory}/{file.replace('[', '%5B').replace(']', '%5D')}", sha256)
        (ROOT / "assets/fonts" / f"OFL-{family}.txt").write_bytes(fetch(f"{RAW}/{directory}/OFL.txt"))
        for style, weight in WEIGHTS.items():
            font = instancer.instantiateVariableFont(TTFont(io.BytesIO(source)), {"wght": weight, **axes})
            available = set(font.getBestCmap())
            # The default layout features are script-aware (Arabic joining forms, Devanagari conjuncts, Hangul jamo).
            options = subset.Options()
            options.name_IDs = ["*"]
            options.notdef_outline = True
            options.hinting = False
            subsetter = subset.Subsetter(options)
            subsetter.populate(unicodes=sorted(needed[family] & available))
            subsetter.subset(font)
            path = OUT / f"{family}-{style}.ttf"
            font.save(path)
            missing = sorted(cp for cp in needed[family] - available if cp not in blocks_of(family))
            note = f"; not in the source font: {''.join(map(chr, missing))}" if missing else ""
            print(f"{path.relative_to(ROOT)}  {path.stat().st_size // 1024} KB  {len(needed[family] & available)} characters{note}")


def blocks_of(family: str) -> set[int]:
    return FONTS[family][4]


if __name__ == "__main__":
    main()
