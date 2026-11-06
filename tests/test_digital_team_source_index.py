import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'server'))
from digital_team.knowledge import Knowledge, Viewer, canon  # noqa: E402

STRICT = {'accounting', 'human_resources', 'price_lists', 'patients', 'booking_cash', 'contracting_entities', 'inventory', 'tasks'}
QUESTIONS = ['ازاي اسجل دفعة في الخزينة', 'مرتبات الدكاترة', 'فاتورة مخزون', 'عقد جهة تأمين', 'ازاي اضيف دكتور واربط خدمة وحجز',
             'صلاحيات المستخدمين', 'مديونيات الخدمات حساب 1122', 'مين يشوف تاب الحسابات', 'تقرير مالي شهري', 'كشف حساب مورد']


class SourceIndexTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory()
        subprocess.run([sys.executable, str(ROOT / 'scripts/build-sono-knowledge.py'), '--repo', str(ROOT), '--out', cls.tmp.name,
                        '--sha', 'a' * 40], check=True, capture_output=True)
        cls.kb = Knowledge(cls.tmp.name, release_id='a' * 40)
        cls.src = cls.kb.tiers['source']

    @classmethod
    def tearDownClass(cls):
        cls.tmp.cleanup()

    def test_pack_loads_and_has_source(self):
        self.assertIsNone(self.kb.error)
        self.assertGreater(len(self.src), 500)
        self.assertTrue(all(i['kind'] == 'code' for i in self.src))

    def test_unmapped_files_default_to_owner_only(self):
        for i in self.src:
            if not i['tab']:
                self.assertEqual(i['access'], {'mode': 'owner'}, i['id'])

    def test_no_sql_config_or_secrets_in_pack(self):
        for tier in self.kb.tiers.values():
            for i in tier:
                self.assertNotRegex(i['source'], r'\.(sql|env|pem|key)$')
                self.assertNotIn('supabase/', i['source'])
                self.assertNotIn('Secrets', i['source'])
                self.assertNotRegex(i['text'], r'eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}')

    def test_employee_roles_never_get_owner_or_strict_items(self):
        for roles in [(), ('reception',), ('customer_service',), ('nursing',), ('designer',), ('page_manager',), ('accountant',)]:
            v = Viewer(False, roles)
            for q in QUESTIONS:
                for it in self.kb.select(v, q):
                    self.assertNotEqual(it['access'].get('mode'), 'owner', (roles, q, it['id']))
                    self.assertNotIn(it.get('tab'), STRICT, (roles, q, it['id']))
                    self.assertFalse(it['id'].startswith('doc:'), (roles, q, it['id']))

    def test_manager_sees_accounting_code_but_not_owner_only_docs(self):
        v = Viewer(False, ('general_manager',))
        got = {i['id'] for q in QUESTIONS for i in self.kb.select(v, q)}
        self.assertTrue(any(g.startswith('src:') and self.by_id(g)['tab'] in STRICT for g in got))
        self.assertFalse(any(self.by_id(g)['access'].get('mode') == 'owner' for g in got))

    def test_owner_reaches_docs_and_code(self):
        ids = {i['id'] for q in QUESTIONS for i in self.kb.select(Viewer(True, ()), q)}
        self.assertTrue(any(i.startswith('doc:') for i in ids))
        self.assertTrue(any(i.startswith('src:') for i in ids))

    def by_id(self, iid):
        for tier in self.kb.tiers.values():
            for i in tier:
                if i['id'] == iid:
                    return i
        raise KeyError(iid)

    def test_context_marks_code_as_data_for_employee(self):
        body = self.kb.context_entry(Viewer(False, ('reception',)), 'حجز موعد')['body']
        self.assertIn('DATA', body)
        self.assertIn('بدون عرض الكود', body)
        self.assertNotIn('المستخدم هو المالك', body)

    def test_arabic_synonyms_and_prefixes(self):
        from digital_team.knowledge import norm
        self.assertEqual(canon(norm('الدكاترة')), 'دكتور')
        self.assertEqual(canon(norm('طبيب')), 'دكتور')
        self.assertEqual(canon(norm('واربط')), 'اربط')

    def test_code_never_crowds_out_everything(self):
        from digital_team.knowledge import MAX_CODE
        for q in QUESTIONS:
            got = self.kb.select(Viewer(True, ()), q)
            self.assertLessEqual(sum(1 for i in got if i.get('kind') == 'code'), MAX_CODE)

    def test_add_doctor_question_finds_the_how_to_article(self):
        q = 'ازاي اضيف دكتور واربط خدمة وحجز'
        for v in (Viewer(True, ()), Viewer(False, ('reception',)), Viewer(False, ('general_manager',))):
            ids = [i['id'] for i in self.kb.select(v, q)]
            self.assertIn('help:add-doctor-service-booking', ids[:3], ids)
        self.assertNotIn('help:add-doctor-service-booking', [i['id'] for i in self.kb.select(Viewer(False, ('designer',)), q)])

    def test_nonsense_question_matches_nothing(self):
        self.assertEqual(self.kb.select(Viewer(False, ('reception',)), 'qqq zzz www'), [])

    def test_manifest_records_exclusions_without_content(self):
        ex = [e for e in self.kb.manifest['excluded'] if e['source'] == 'assets/js/*']
        self.assertTrue(ex)
        self.assertNotIn('text', json.dumps(ex))


if __name__ == '__main__':
    unittest.main()
