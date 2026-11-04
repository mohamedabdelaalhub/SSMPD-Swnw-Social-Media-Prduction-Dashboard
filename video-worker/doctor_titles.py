"""Data-driven Arabic doctor titles (DRAFT). No gender guessing from names: a title is added ONLY for names present in the registry; any other
'د. <name>' / 'أ.د. <name>' keeps its abbreviation exactly as written. Registry = list of {name, title}; the default holds the single name the
worker already special-cased in spoken_script."""
from __future__ import annotations

DEFAULT_REGISTRY = [{"name": "دينا حسني", "title": "الدكتورة", "spoken_name": "دينا حُسْني"}]


def find(registry: list[dict], name: str) -> dict | None:
    wanted = " ".join(name.split())
    for entry in registry:
        if " ".join(entry["name"].split()) == wanted:
            return entry
    return None


def caption_unit(registry: list[dict], abbreviation: str, name: str) -> str:
    entry = find(registry, name)
    return (entry["title"] + " " + name) if entry else (abbreviation + " " + name)


def spoken(registry: list[dict], text: str) -> str:
    """Speech text: registered names get their spoken title + spoken name; everything else is left untouched (the TTS engine decides)."""
    for entry in registry:
        plain = entry["name"]
        for dotted in ("د. " + plain, "د." + plain):
            text = text.replace(dotted, entry["title"] + " " + entry.get("spoken_name", plain))
        text = text.replace(plain, entry.get("spoken_name", plain))
    return text


def spoken_numbers(text: str) -> str:
    """OPT-IN number normalisation for speech (policy decision pending, not used by default): '120.5' -> '120 فاصلة 5', thousands separators removed."""
    import re
    text = re.sub(r"(?<=\d),(?=\d{3}\b)", "", text)
    return re.sub(r"(?<=[0-9٠-٩])[.٫](?=[0-9٠-٩])", " فاصلة ", text)
