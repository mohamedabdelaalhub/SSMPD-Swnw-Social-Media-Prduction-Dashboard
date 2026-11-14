"""Reject unbound, missing and cross-brand logo snapshots."""
def logo_asset(job, downloaded=False):
    brand = job.get('brand')
    settings = job.get('cover_settings') or {}
    if job.get('input_schema_version') not in (2, 3) or settings.get('logo_source') != 'brand_library':
        raise RuntimeError('Refresh this pending job from the dashboard to bind its saved brand logo.')
    if brand not in ('sono', 'dr_dina') or settings.get('logo_brand') != brand:
        raise RuntimeError('Brand logo does not match the video brand.')
    assets = job.get('_downloaded_assets' if downloaded else 'input_assets') or []
    logos = [a for a in assets if isinstance(a, dict) and a.get('asset_type') == 'brand_logo']
    if len(logos) != 1:
        raise RuntimeError('Exactly one saved brand logo is required.')
    logo = logos[0]
    if (logo.get('brand') != brand or logo.get('id') != settings.get('logo_asset_id')
            or logo.get('storage_bucket') != 'brand-logos'
            or not str(logo.get('storage_path', '')).startswith(brand + '/')):
        raise RuntimeError('Brand logo does not match the video brand.')
    return logo


# --- Brand caption font -----------------------------------------------------
# libass looks fonts up by *family* name. The BigVesta files declare the family
# "BigVesta Arabic Beta"; the old value "BigVestaArabicBeta" (no spaces) matched
# nothing, so captions silently fell back to another font. The font files ship
# next to the worker and are passed to libass with fontsdir= so rendering does
# not depend on what is installed on the render machine.
from pathlib import Path as _Path

BRAND_FONT_FAMILY = 'BigVesta Arabic Beta'
FONTS_DIR = _Path(__file__).resolve().parent / 'fonts'
_LEGACY_FONT_NAMES = {'bigvestaarabicbeta', 'bigvestaarabic', 'bigvesta'}


def brand_font_family(job):
    settings = job.get('cover_settings') or {}
    configured = str(settings.get('font_family') or '').strip()
    if not configured or configured.replace(' ', '').replace('-', '').lower() in _LEGACY_FONT_NAMES:
        return BRAND_FONT_FAMILY
    return configured


def _filter_escape(value):
    return str(value).replace('\\', r'\\').replace(':', r'\:').replace("'", r"\'")


FONT_FILES = ('BigVesta-Regular.woff2', 'BigVesta-Bold.woff2')
FONTS_SOURCE = ('https://raw.githubusercontent.com/mohamedabdelaalhub/'
                'SSMPD-Swnw-Social-Media-Prduction-Dashboard/main/video-worker/fonts/')


def ensure_fonts():
    """Download the brand fonts next to the worker if an older Update.command did not."""
    import urllib.request
    try:
        FONTS_DIR.mkdir(parents=True, exist_ok=True)
    except OSError:
        return False
    for name in FONT_FILES:
        target = FONTS_DIR / name
        if target.is_file() and target.stat().st_size > 1000:
            continue
        try:
            req = urllib.request.Request(FONTS_SOURCE + name, headers={'User-Agent': 'ssmpd-video-worker'})
            with urllib.request.urlopen(req, timeout=30) as resp:
                data = resp.read()
            if data[:4] != b'wOF2':
                continue
            tmp = target.with_suffix('.part')
            tmp.write_bytes(data)
            tmp.replace(target)
        except Exception:
            continue
    return all((FONTS_DIR / n).is_file() for n in FONT_FILES)


def ass_filter(ass_path):
    """ffmpeg ass= filter that always loads the bundled brand fonts when present."""
    ensure_fonts()
    value = "ass=filename='" + _filter_escape(ass_path) + "'"
    if FONTS_DIR.is_dir() and any(FONTS_DIR.glob('*.woff2')):
        value += ":fontsdir='" + _filter_escape(FONTS_DIR) + "'"
    return value
