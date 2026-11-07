"""Unit tests for the lab matcher using synthetic fixtures only. Run: python3 -I scripts/lab-link/test_lab_match.py"""
import json
import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from lab_match import Matcher, confidence, parse_lab_name  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
SERVICES = json.load(open(os.path.join(HERE, '..', '..', 'tests', 'fixtures', 'lab-link', 'center_lab.json'), encoding='utf-8'))
M = Matcher(SERVICES)
ID = {s['name']: s['id'] for s in SERVICES}


def top(name):
    c, _, _ = M.candidates(name)
    return c, confidence(c)


class MatcherTests(unittest.TestCase):
    def test_sample_parsed_out_of_the_name(self):
        core, sample, groups = parse_lab_name('ADA Serum')
        self.assertEqual((core, sample), ('ADA', 'Serum'))
        self.assertEqual(groups, {'blood'})
        core, sample, groups = parse_lab_name('Magnesium in Urine Urine')
        self.assertIn('Urine', sample)
        self.assertIn('urine', groups)
        self.assertEqual(parse_lab_name('Coombs Test (Direct) SerumEDTA')[1], 'SerumEDTA')

    def test_serum_vs_fluid_is_not_confused(self):
        c, conf = top('ADA Serum')
        self.assertEqual(c[0]['service_id'], ID['ADA - Adenosine Deaminase In Serum'])
        self.assertIn(conf, ('medium', 'high'))
        c, conf = top('ADA Fluid')
        self.assertEqual(c[0]['service_id'], ID['ADA - Adenosine Deaminase In Fluid'])
        wrong = [x for x in c if x['service_id'] == ID['ADA - Adenosine Deaminase In Serum']]
        self.assertTrue(all(x['sample_conflict'] for x in wrong))
        self.assertTrue(all(x['score'] < c[0]['score'] for x in wrong))

    def test_sample_conflict_caps_confidence_at_low(self):
        cands = [{'score': 1.0, 'sample_conflict': True, 'exact': True, 'sample_unspecified': False}]
        self.assertEqual(confidence(cands), 'low')

    def test_abbreviation_with_parenthetical_expansion(self):
        c, conf = top('TSH Serum')
        self.assertEqual(c[0]['service_id'], ID['TSH (Thyroid Stimulating H)'])
        self.assertNotEqual(conf, 'none')

    def test_igg_not_igm(self):
        c, conf = top('CMV IgG Serum')
        self.assertEqual(c[0]['service_id'], ID['CMV - IgG'])
        self.assertEqual(conf, 'high')

    def test_urine_sample_vs_unspecified_center_name_is_never_high(self):
        c, conf = top('Glucose in urine (Random) Urine')
        self.assertIn(conf, ('medium', 'low', 'none'))

    def test_unknown_test_has_no_high_match(self):
        c, conf = top('Vitamin Zed Serum')
        self.assertIn(conf, ('none', 'low'))

    def test_several_candidates_are_returned_ranked(self):
        c, _ = top('Magnesium in Urine Urine')
        self.assertGreaterEqual(len(c), 2)
        self.assertEqual(c[0]['service_id'], ID['Mg In Urine'])
        self.assertEqual([x['score'] for x in c], sorted([x['score'] for x in c], reverse=True))


if __name__ == '__main__':
    unittest.main(verbosity=1)
