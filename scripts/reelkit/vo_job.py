"""Instinct narrator job status + suggested shots.
   python3 scripts/reelkit/vo_job.py status OUT        (jobs that `build.py story.json OUT --vo-submit` asked for)
   python3 scripts/reelkit/vo_job.py status <job_id>
Prints {status, voice, clips:[{url, source, kind?, id?}]} per job. clips are Instinct's suggested shots for that script:
optional ideas, never required. Pixabay ones have kind + id -> op=stock {"id": <id>, "type": kind, "brand": ...} gives the
file URL for op=fetch_media (no-repeat rule as always); other sites are ideas for the look / search words only."""
import json, os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import voices as V

if __name__ == "__main__":
    if len(sys.argv) != 3 or sys.argv[1] != "status": sys.exit(__doc__)
    arg = sys.argv[2]; f = os.path.join(arg, "vo_jobs.json")
    ids = list(json.load(open(f)).values()) if os.path.isdir(arg) and os.path.exists(f) else [arg]
    for j in ids: print(json.dumps({"job_id": j, **V.vo_status(j)}, ensure_ascii=False, indent=1))
