import unittest
from brand_identity import logo_asset


class BrandIdentityTests(unittest.TestCase):
    def setUp(self):
        self.job = {
            'brand': 'dr_dina', 'input_schema_version': 2,
            'cover_settings': {'logo_source': 'brand_library', 'logo_brand': 'dr_dina', 'logo_asset_id': 'dina-v1'},
            'input_assets': [{'id': 'dina-v1', 'asset_type': 'brand_logo', 'brand': 'dr_dina',
                              'storage_bucket': 'brand-logos', 'storage_path': 'dr_dina/logo.png'}]
        }

    def test_correct_logo_bound_to_job(self):
        self.assertEqual(logo_asset(self.job)['id'], 'dina-v1')

    def test_sono_logo_rejected_for_dina(self):
        self.job['input_assets'][0].update(brand='sono', storage_path='sono/logo.png')
        with self.assertRaisesRegex(RuntimeError, 'does not match'):
            logo_asset(self.job)

    def test_content_brand_changed_requires_refresh(self):
        self.job['brand'] = 'sono'
        with self.assertRaisesRegex(RuntimeError, 'does not match'):
            logo_asset(self.job)

    def test_legacy_per_video_logo_cannot_render(self):
        self.job['input_schema_version'] = 1
        self.job['cover_settings']['logo_source'] = 'uploaded_image'
        with self.assertRaisesRegex(RuntimeError, 'Refresh'):
            logo_asset(self.job)

    def test_missing_or_multiple_logos_rejected(self):
        for assets in ([], self.job['input_assets'] * 2):
            job = dict(self.job, input_assets=assets)
            with self.assertRaisesRegex(RuntimeError, 'Exactly one'):
                logo_asset(job)

    def test_brand_logo_cannot_point_into_general_uploads(self):
        self.job['input_assets'][0]['storage_bucket'] = 'video-inputs'
        with self.assertRaisesRegex(RuntimeError, 'does not match'):
            logo_asset(self.job)


if __name__ == '__main__':
    unittest.main()
