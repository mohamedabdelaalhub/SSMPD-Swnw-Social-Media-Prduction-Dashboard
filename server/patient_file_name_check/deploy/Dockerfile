# Local OCR worker image — everything runs on the clinic server; no external OCR service.
FROM debian:stable-slim
RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 tesseract-ocr tesseract-ocr-ara tesseract-ocr-eng poppler-utils openssl ca-certificates \
 && rm -rf /var/lib/apt/lists/* \
 && useradd --system --uid 10050 --home /nonexistent --shell /usr/sbin/nologin ocr
COPY match.py worker.py __init__.py /app/patient_file_name_check/
WORKDIR /app
USER ocr
ENTRYPOINT ["python3", "-m", "patient_file_name_check.worker", "--once"]
