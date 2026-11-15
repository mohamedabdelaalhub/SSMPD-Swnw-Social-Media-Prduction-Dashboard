"""Compare the patient name found in an uploaded document's text with the patient's record.

Pure standard library, no network: the OCR text comes from a local engine on the clinic server
(tesseract / pdftotext). Result is a WARNING for staff only — it never blocks or changes a file.

Verdicts:
  match         the patient's name (first 3 parts) appears in the text
  mismatch      the document labels a name ("الاسم:", "اسم المريض", "Name:") that is not the patient
  no_name_found no labeled name and the patient's name is not found — nothing to warn about
  unreadable    too little text to judge (photo too blurry, handwriting, empty scan)
"""
import re
import unicodedata

_TASHKEEL = re.compile(r"[ؐ-ًؚ-ٰٟۖ-ۭـ]")
_NON_WORD = re.compile(r"[^\w\s]", re.UNICODE)
_LABEL = re.compile(
    r"(?:اسم\s*المريض(?:ه|ة)?|اسم\s*المريضة|الاسم|المريض(?:ه|ة)?|patient\s*name|name\s*of\s*patient|patient|name)"
    r"\s*[:：\-–]\s*([^\n\r|/]{2,60})",
    re.IGNORECASE,
)
# words that are often printed next to a label but are not part of a name
_STOP = {"السيد", "السيده", "الاستاذ", "الاستاذه", "الطفل", "الطفله", "المريض", "المريضه", "mr", "mrs", "ms", "miss",
         "السن", "العمر", "age", "sex", "النوع", "التاريخ", "date", "id", "رقم"}
_PREFIXES = ("عبد ",)


def normalize(text: str) -> str:
    t = unicodedata.normalize("NFKC", text or "").lower()
    t = _TASHKEEL.sub("", t)
    t = (t.replace("أ", "ا").replace("إ", "ا").replace("آ", "ا").replace("ٱ", "ا")
          .replace("ى", "ي").replace("ة", "ه").replace("ؤ", "و").replace("ئ", "ي"))
    t = re.sub(r"\bعبد\s+ال", "عبدال", t)          # "عبد الله" == "عبدالله"
    t = _NON_WORD.sub(" ", t)
    return re.sub(r"\s+", " ", t).strip()


def tokens(text: str):
    return [w for w in normalize(text).split() if len(w) > 1 and not w.isdigit() and w not in _STOP]


def _close(a: str, b: str) -> bool:
    """Same word allowing one OCR slip for words of 4+ letters."""
    if a == b:
        return True
    if min(len(a), len(b)) < 4 or abs(len(a) - len(b)) > 1:
        return False
    prev = list(range(len(b) + 1))
    for i, ca in enumerate(a, 1):
        cur = [i]
        for j, cb in enumerate(b, 1):
            cur.append(min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (ca != cb)))
        prev = cur
    return prev[-1] <= 1


def name_score(patient_name: str, candidate_words) -> float:
    """Share of the patient's first 3 name parts found (in order-independent way) among candidate words."""
    want = tokens(patient_name)[:3]
    if not want:
        return 0.0
    have = list(candidate_words)
    used, hits = set(), 0
    # one document word can match only one name part (so "احمد" can't reuse the "محمد" already matched);
    # exact matches are taken first, then one-letter OCR slips.
    for exact in (True, False):
        for w in list(want):
            for i, h in enumerate(have):
                if i not in used and (w == h if exact else _close(w, h)):
                    used.add(i); hits += 1; want.remove(w); break
    return hits / len(tokens(patient_name)[:3])


def labeled_names(text: str):
    out = []
    for m in _LABEL.finditer(text or ""):
        words = tokens(m.group(1))[:4]
        if len(words) >= 2:
            out.append(words)
    return out


def check(patient_name: str, document_text: str, min_chars: int = 25) -> dict:
    clean = normalize(document_text)
    if len(clean.replace(" ", "")) < min_chars:
        return {"verdict": "unreadable", "score": None, "detected_name": None}
    if not tokens(patient_name):
        return {"verdict": "unreadable", "score": None, "detected_name": None}

    labels = labeled_names(document_text)
    if labels:
        scored = [(name_score(patient_name, words), " ".join(words)) for words in labels]
        best_score, best_name = max(scored)
        if best_score >= 2 / 3:
            return {"verdict": "match", "score": round(best_score, 2), "detected_name": best_name}
        # a labeled name that is not the patient: warn, show what the document says
        return {"verdict": "mismatch", "score": round(best_score, 2), "detected_name": best_name}

    whole = name_score(patient_name, clean.split())
    if whole >= 2 / 3:
        return {"verdict": "match", "score": round(whole, 2), "detected_name": None}
    return {"verdict": "no_name_found", "score": round(whole, 2), "detected_name": None}
