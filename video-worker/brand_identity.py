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


def ass_filter(ass_path):
    """ffmpeg ass= filter that always loads the bundled brand fonts when present."""
    value = "ass=filename='" + _filter_escape(ass_path) + "'"
    if FONTS_DIR.is_dir() and any(FONTS_DIR.glob('*.woff2')):
        value += ":fontsdir='" + _filter_escape(FONTS_DIR) + "'"
    return value
