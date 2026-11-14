"""Captions must render with the bundled BigVesta font, never a silent fallback."""
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

from brand_identity import BRAND_FONT_FAMILY, FONTS_DIR, ass_filter, brand_font_family


class BrandFontTest(unittest.TestCase):
    def test_legacy_and_empty_names_map_to_real_family(self):
        for value in (None, '', 'BigVestaArabicBeta', 'BigVesta Arabic', 'bigvesta'):
            job = {'cover_settings': {'font_family': value}} if value is not None else {}
            self.assertEqual(brand_font_family(job), BRAND_FONT_FAMILY)
        self.assertEqual(brand_font_family({'cover_settings': {'font_family': 'Tajawal'}}), 'Tajawal')

    def test_fonts_are_bundled_and_passed_to_libass(self):
        self.assertTrue((FONTS_DIR / 'BigVesta-Regular.woff2').is_file())
        self.assertTrue((FONTS_DIR / 'BigVesta-Bold.woff2').is_file())
        self.assertIn(':fontsdir=', ass_filter(Path('/tmp/x.ass')))

    @unittest.skipUnless(shutil.which('ffmpeg'), 'ffmpeg not installed')
    def test_libass_selects_bigvesta(self):
        with tempfile.TemporaryDirectory() as tmp:
            ass = Path(tmp) / 'c.ass'
            ass.write_text(
                '[Script Info]\nScriptType: v4.00+\nPlayResX: 1080\nPlayResY: 600\n\n[V4+ Styles]\n'
                'Format: Name,Fontname,Fontsize,PrimaryColour,SecondaryColour,OutlineColour,BackColour,Bold,Italic,'
                'Underline,StrikeOut,ScaleX,ScaleY,Spacing,Angle,BorderStyle,Outline,Shadow,Alignment,MarginL,'
                'MarginR,MarginV,Encoding\n'
                f'Style: Body,{brand_font_family({})},60,&H00FFFFFF,&H000000FF,&H00000000,&H00000000,1,0,0,0,'
                '100,100,0,0,1,0,0,5,10,10,0,1\n\n[Events]\n'
                'Format: Layer,Start,End,Style,Name,MarginL,MarginR,MarginV,Effect,Text\n'
                'Dialogue: 0,0:00:00.00,0:00:01.00,Body,,0,0,0,,لا تؤجل علاج الأسنان\n',
                encoding='utf-8')
            out = subprocess.run(
                ['ffmpeg', '-v', 'verbose', '-y', '-f', 'lavfi', '-i', 'color=s=1080x600:d=1',
                 '-vf', ass_filter(ass), '-frames:v', '1', '-update', '1', str(Path(tmp) / 'f.png')],
                capture_output=True, text=True)
            picks = [l for l in out.stderr.splitlines() if 'fontselect' in l]
            self.assertTrue(picks, out.stderr[-800:])
            self.assertTrue(all('BigVestaArabicBeta' in l.split('->')[1] for l in picks), picks)
            self.assertNotIn('not found', out.stderr)


if __name__ == '__main__':
    unittest.main()
