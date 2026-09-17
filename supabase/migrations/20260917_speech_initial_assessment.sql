-- حقول التقييم الأولي لحالة التخاطب
alter table public.patient_speech_profiles
  add column if not exists presenting_complaint text,
  add column if not exists problem_started text,
  add column if not exists consanguinity boolean,
  add column if not exists genetic_family_history boolean,
  add column if not exists genetic_family_history_details text,
  add column if not exists pregnancy_birth_issues boolean,
  add column if not exists pregnancy_birth_issues_details text,
  add column if not exists first_word text,
  add column if not exists first_sentence text,
  add column if not exists previous_speech_therapy boolean,
  add column if not exists previous_speech_therapy_result text,
  add column if not exists current_understanding_speech text,
  add column if not exists specialist_notes text,
  add column if not exists therapy_goal text;