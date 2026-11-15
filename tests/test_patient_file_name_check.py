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


import os, tempfile  # noqa: E402
from patient_file_name_check import worker  # noqa: E402


class Worker(unittest.TestCase):
    def setUp(self):
        self.base = tempfile.mkdtemp()
        self.calls, self.logs = [], []
        self.rpc = lambda fn, args: self.calls.append((fn, args))

    def run_one(self, row, text=None, fail=False):
        def download(token, drive_id, dest):
            if fail:
                raise OSError("network")
            open(dest, "wb").write(b"%PDF")
        return worker.process_one(row, self.rpc, lambda: "tok", download,
                                  lambda p, m, w: text, self.base, log=self.logs.append)

    def test_mismatch_recorded_with_detected_name_and_cleaned_up(self):
        v = self.run_one({"file_id": "f1", "patient_name": P, "drive_file_id": "d", "mime_type": "application/pdf"},
                         text="الاسم: سارة محمود حسن\nنتيجة صورة دم كاملة طبيعية")
        self.assertEqual(v, "mismatch")
        fn, args = self.calls[0]
        self.assertEqual((fn, args["p_verdict"], args["p_detected_name"]), ("patient_file_name_check_record", "mismatch", "ساره محمود حسن"))
        self.assertEqual(os.listdir(self.base), [], "work dir removed")
        self.assertNotIn("سارة", "".join(self.logs), "no document content in logs")
        self.assertNotIn("ساره", "".join(self.logs))

    def test_match_stores_no_name(self):
        self.run_one({"file_id": "f2", "patient_name": P, "drive_file_id": "d", "mime_type": "image/jpeg"},
                     text="اسم المريض: محمد احمد عبدالله\nالتشخيص التهاب بسيط في الحلق")
        self.assertEqual(self.calls[0][1]["p_verdict"], "match")
        self.assertIsNone(self.calls[0][1]["p_detected_name"])

    def test_errors_are_recorded_not_raised(self):
        self.assertEqual(self.run_one({"file_id": "f3", "patient_name": P, "drive_file_id": "d"}, fail=True), "error")
        self.assertEqual(self.calls[0][1]["p_verdict"], "error")
        self.assertEqual(os.listdir(self.base), [])

    def test_encrypted_skipped(self):
        self.assertEqual(self.run_one({"file_id": "f4", "is_encrypted": True}), "unreadable")
        self.assertEqual(self.calls[0][1]["p_engine"], "skipped-encrypted")

    def test_pdf_falls_back_to_ocr(self):
        seen = []
        def run(args, timeout=120, input_bytes=None):
            seen.append(args[0])
            if args[0] == "pdftotext":
                return b"  "
            if args[0] == "pdftoppm":
                open(args[-1] + "-1.png", "wb").write(b"x"); return b""
            return "الاسم: محمد احمد عبدالله".encode()
        work = tempfile.mkdtemp()
        text = worker.extract_text(os.path.join(work, "src"), "application/pdf", work, run=run)
        self.assertEqual(seen, ["pdftotext", "pdftoppm", "tesseract"])
        self.assertIn("محمد", text)
