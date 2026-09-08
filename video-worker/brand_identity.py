"""Reject unbound, missing and cross-brand logo snapshots."""
def logo_asset(job, downloaded=False):
    brand = job.get('brand')
    settings = job.get('cover_settings') or {}
    if job.get('input_schema_version') != 2 or settings.get('logo_source') != 'brand_library':
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
