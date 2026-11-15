import sys, unittest, pathlib
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1] / "server"))
from patient_file_name_check.match import check, normalize  # noqa: E402

P = "محمد أحمد عبد الله السيد"   # synthetic name, not a real patient


class NameCheck(unittest.TestCase):
    def test_normalization(self):
        self.assertEqual(normalize("أَحْمَد عبد الله فاطمة"), "احمد عبدالله فاطمه")

    def test_labeled_match_with_spelling_variants(self):
        r = check(P, "مركز الأشعة\nاسم المريض: محمد احمد عبدالله\nالسن: 40 سنة\nالنتيجة طبيعية تماما")
        self.assertEqual(r["verdict"], "match")

    def test_ocr_slip_still_matches(self):
        r = check(P, "Patient Name: محمد احمب عبدالله\nRESULT: normal values within range")
        self.assertEqual(r["verdict"], "match")

    def test_labeled_other_patient_is_mismatch(self):
        r = check(P, "معمل التحاليل\nالاسم: سارة محمود حسن\nنتيجة صورة دم كاملة طبيعية")
        self.assertEqual(r["verdict"], "mismatch")
        self.assertEqual(r["detected_name"], "ساره محمود حسن")

    def test_shared_first_name_only_is_mismatch(self):
        r = check(P, "الاسم: محمد علي حسن\nتقرير أشعة على الصدر بدون ملاحظات")
        self.assertEqual(r["verdict"], "mismatch")

    def test_unlabeled_name_in_body(self):
        r = check(P, "تقرير طبي للسيد محمد أحمد عبدالله عن حالة الركبة اليمنى بعد العلاج")
        self.assertEqual(r["verdict"], "match")

    def test_no_name_no_alarm(self):
        r = check(P, "Hemoglobin 13.5 g/dL  WBC 6.2  Platelets 250  all within reference range")
        self.assertEqual(r["verdict"], "no_name_found")

    def test_unreadable(self):
        self.assertEqual(check(P, " ~ ")["verdict"], "unreadable")

    def test_english_document(self):
        r = check("Mohamed Ahmed Abdallah", "Radiology Center\nName: John Smith Brown\nChest X-ray: clear lungs")
        self.assertEqual(r["verdict"], "mismatch")
        r = check("Mohamed Ahmed Abdallah", "Name: Mohamed Ahmed Abdallah  Age: 40\nChest X-ray: clear lungs")
        self.assertEqual(r["verdict"], "match")


if __name__ == "__main__":
    unittest.main()
