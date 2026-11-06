"""Owner attachments for the Digital Team chat: strict allowlist validation by content (magic bytes), never by
the browser-declared type or the file name. Stored files are inert data: random names, no executable bit, outside
any web root, never served back, never executed."""
import base64
import binascii
import os
import re
import secrets
import unicodedata
from pathlib import Path

MAX_BYTES = 700_000          # per file; base64 JSON body must stay under the 1 MB default of the same-origin proxy
MAX_MESSAGE_REQUEST = 950_000  # JSON body of a message: 200k chars of Arabic ~ 400 KB; stays under the proxy's 1 MB default
MAX_REQUEST = 1_000_000      # raw HTTP body for the upload route only (all other routes stay at 24 KB)
MAX_PER_MESSAGE = 3
MAX_PENDING = 12             # unattached uploads kept per owner
PENDING_TTL = 3600           # unattached uploads are purged after an hour
MAX_STORE_BYTES = 512 * 1024 * 1024
MAX_INLINE_CHARS = 60_000    # text files are inlined into the prompt up to this size

TEXT_EXTS = {'txt': 'text/plain', 'csv': 'text/csv', 'md': 'text/markdown'}


class UploadRejected(Exception):
    """Message is already user-facing Arabic."""


def clean_name(value):
    name = str(value or '').replace('\\', '/').rsplit('/', 1)[-1]
    name = ''.join(c for c in unicodedata.normalize('NFC', name) if c.isprintable() and c not in '<>"\'`')
    name = re.sub(r'\s+', ' ', name).strip().strip('.')
    return name[:80] or 'ملف'


def extension(name):
    return name.rsplit('.', 1)[-1].lower() if '.' in name else ''


def sniff(raw, name):
    """Return (kind, mime, ext) or raise. kind is 'image', 'pdf' or 'text'."""
    if raw[:8] == b'\x89PNG\r\n\x1a\n':
        return 'image', 'image/png', 'png'
    if raw[:3] == b'\xff\xd8\xff':
        return 'image', 'image/jpeg', 'jpg'
    if raw[:4] == b'RIFF' and raw[8:12] == b'WEBP':
        return 'image', 'image/webp', 'webp'
    if raw[:5] == b'%PDF-':
        return 'pdf', 'application/pdf', 'pdf'
    ext = extension(name)
    if ext in TEXT_EXTS:
        if b'\x00' in raw:
            raise UploadRejected('الملف النصي غير صالح')
        try:
            raw.decode('utf-8')
        except UnicodeDecodeError:
            raise UploadRejected('الملف النصي يجب أن يكون بترميز UTF-8') from None
        return 'text', TEXT_EXTS[ext], ext
    raise UploadRejected('نوع الملف غير مسموح؛ المسموح: صور png/jpg/webp وملفات pdf/txt/csv/md')


def decode_payload(data):
    """Validate the upload JSON and return (display_name, raw bytes, kind, mime, stored_ext)."""
    if not isinstance(data.get('name'), str) or not isinstance(data.get('data'), str):
        raise UploadRejected('طلب الإرفاق غير صالح')
    if len(data['data']) > (MAX_BYTES * 4) // 3 + 8:
        raise UploadRejected('الملف أكبر من الحد المسموح (700 كيلوبايت)')
    try:
        raw = base64.b64decode(data['data'], validate=True)
    except (binascii.Error, ValueError):
        raise UploadRejected('محتوى الملف غير صالح') from None
    if not raw:
        raise UploadRejected('الملف فارغ')
    if len(raw) > MAX_BYTES:
        raise UploadRejected('الملف أكبر من الحد المسموح (700 كيلوبايت)')
    name = clean_name(data['name'])
    kind, mime, ext = sniff(raw, name)
    declared = data.get('mime')
    if declared not in (None, '', mime) and not (kind == 'text' and str(declared).startswith('text/')) \
            and not (kind == 'text' and declared in ('application/vnd.ms-excel', 'application/octet-stream')):
        raise UploadRejected('نوع الملف لا يطابق محتواه')
    return name, raw, kind, mime, ext


def write_private(directory, raw, ext):
    """Randomised name, 0600, exclusive create. Returns the stored basename."""
    directory = Path(directory)
    directory.mkdir(mode=0o700, parents=True, exist_ok=True)
    stored = secrets.token_hex(16) + '.' + ext
    fd = os.open(directory / stored, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    with os.fdopen(fd, 'wb') as f:
        f.write(raw)
    return stored


def inline_text(raw):
    text = raw.decode('utf-8', 'replace')
    return text[:MAX_INLINE_CHARS] + ('\n[... اقتُطع النص لطول الملف]' if len(text) > MAX_INLINE_CHARS else '')
