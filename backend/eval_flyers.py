"""Score the OCR on test-flyers/flyer-*.jpg against their .expected.json files.

Run from the backend folder:  python eval_flyers.py

It posts each flyer to /api/upload (the same code path the real endpoint uses),
saves test-flyers/flyer-XX.output.json, and writes test-flyers/RESULTS.md.
Needs GEMINI_API_KEY in backend/.env. Costs 3 model calls.
"""

import difflib
import json
import os
import re
import sys
from pathlib import Path

os.environ.setdefault("PORT", "0")  # config requires it; the test client doesn't use it

from fastapi.testclient import TestClient  # noqa: E402

from app.main import app  # noqa: E402

FLYER_DIR = Path(__file__).resolve().parent.parent / "test-flyers"
IMAGE_EXTS = {".jpg", ".jpeg", ".png", ".webp", ".heic"}
FACTS = ["title", "date", "time", "location"]


def norm(s: str) -> str:
    """Lowercase and collapse whitespace."""
    return re.sub(r"\s+", " ", s.lower()).strip()


def words(s: str) -> list[str]:
    return re.findall(r"[a-z0-9$@:/.&'-]+", s.lower())


def similarity(expected: str, actual: str) -> float:
    return difflib.SequenceMatcher(None, norm(expected), norm(actual), autojunk=False).ratio()


def check_fact(value: str, output: str) -> str:
    """exact = appears as written; minor = most words present; missing = otherwise.

    'wrong' (a different value) can't be told apart from 'missing' automatically, so
    review the output yourself for those.
    """
    if re.sub(r"\W+", "", value.lower()) in re.sub(r"\W+", "", output.lower()):
        return "exact"
    fact_words = words(value)
    out_words = set(words(output))
    hit = sum(w in out_words for w in fact_words) / max(len(fact_words), 1)
    return "minor differences" if hit >= 0.6 else "missing/wrong"


def extra_words(expected: str, actual: str) -> list[str]:
    """Output words that never appear in the expected text: possible hallucinations."""
    known = set(words(expected))
    seen, extras = set(), []
    for w in words(actual):
        if w not in known and w not in seen:
            seen.add(w)
            extras.append(w)
    return extras


def main() -> int:
    client = TestClient(app)
    flyers = sorted(
        p for p in FLYER_DIR.glob("flyer-*") if p.suffix.lower() in IMAGE_EXTS
    )
    if not flyers:
        print(f"No flyer-*.jpg/png/webp/heic files in {FLYER_DIR}")
        return 1

    rows, sections = [], []
    for img in flyers:
        expected_path = img.with_suffix(".expected.json")
        if not expected_path.exists():
            print(f"Skipping {img.name}: no {expected_path.name}")
            continue
        expected = json.loads(expected_path.read_text())

        print(f"Running {img.name} ...")
        with img.open("rb") as f:
            resp = client.post(
                "/api/upload",
                files={"file": (img.name, f, "application/octet-stream")},
                data={"timezone": "America/Los_Angeles"},
            )
        body = resp.json()
        (img.parent / f"{img.stem}.output.json").write_text(
            json.dumps({"file": img.name, "status": resp.status_code, **body}, indent=2) + "\n"
        )

        if resp.status_code != 200:
            err = body.get("error", {})
            print(f"  FAILED {resp.status_code}: {err.get('code')} {err.get('message')}")
            rows.append(f"| {img.stem} | 0/4 | n/a | n/a | upload failed: {err.get('code')} |")
            sections.append(f"## {img.stem}\n\nUpload failed ({resp.status_code}): {err}\n")
            continue

        text = body["text"]
        facts = expected["key_facts"]
        results = {k: check_fact(facts[k], text) for k in FACTS}
        correct = sum(v == "exact" for v in results.values())
        sim = similarity(expected["full_text"], text)
        extras = extra_words(expected["full_text"], text)

        rows.append(
            f"| {img.stem} | {correct}/4 | {len(extras)} possible | {sim:.1%} | {expected.get('difficulty', '')} |"
        )
        fact_lines = "\n".join(f"- **{k}**: {results[k]} (expected: `{facts[k]}`)" for k in FACTS)
        sections.append(
            f"## {img.stem}\n\n### Key facts (automatic check)\n{fact_lines}\n\n"
            f"### Words in the output that are not in the expected text\n"
            f"{', '.join(extras) if extras else 'none'}\n\n"
            f"### Output\n```\n{text}\n```\n"
        )
        print(f"  key facts {correct}/4, similarity {sim:.1%}, {len(extras)} extra words")

    model = body.get("model", "?") if flyers else "?"
    md = (
        "# OCR test results\n\n"
        f"Model: `{model}`. Scores are automatic and only a first pass: 'possible' hallucinations are "
        "words that are not in the ground truth, so they include misreads and anything the ground truth "
        "left out. Check them against the real flyer.\n\n"
        "| Flyer | Key facts exact (of 4) | Possible hallucinated words | Text similarity | Difficulty |\n"
        "|---|---|---|---|---|\n" + "\n".join(rows) + "\n\n" + "\n".join(sections)
    )
    (FLYER_DIR / "RESULTS.md").write_text(md)
    print(f"\nWrote {FLYER_DIR / 'RESULTS.md'}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
