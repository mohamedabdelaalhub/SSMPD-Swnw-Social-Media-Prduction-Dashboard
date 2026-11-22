// Runs tests/test_reelkit_voices_instinct.py (Instinct narrator + ElevenLabs fallback) and tests/test_vo_worker.py (server worker DB jobs).
const { spawnSync } = require('child_process');
const r = spawnSync('python3', ['-m', 'unittest', '-q', 'tests/test_reelkit_voices_instinct.py', 'tests/test_vo_worker.py'], { encoding: 'utf8' });
if (r.error && r.error.code === 'ENOENT') { console.log('SKIP python3 not installed'); process.exit(0); }
process.stdout.write(r.stdout || ''); process.stderr.write(r.stderr || '');
process.exit(r.status === 0 ? 0 : 1);
