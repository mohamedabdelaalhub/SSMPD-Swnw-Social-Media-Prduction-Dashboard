"""Hard gate for the Claude Code team chat read tools.

Used two ways: imported by runtime.py (stream check) and run as a Claude Code PreToolUse hook
(`python3 read_gate.py <code_dir>`; JSON on stdin; exit 2 blocks the tool BEFORE it runs). Fails closed."""
import json
import os
import sys

READ_TOOLS = ('Read', 'Grep', 'Glob')


def inside(code_dir, value):
    if not isinstance(value, str) or not value or '\x00' in value:
        return False
    path = value if os.path.isabs(value) else os.path.join(code_dir, value)
    real = os.path.realpath(path)
    return real == code_dir or real.startswith(code_dir + os.sep)


def decide(code_dir, name, data):
    if name not in READ_TOOLS or not isinstance(data, dict):
        return False
    paths = [data[k] for k in ('file_path', 'path') if k in data]
    if name == 'Read' and not paths:
        return False
    if any(not inside(code_dir, v) for v in paths):
        return False
    glob = data.get('glob')
    if glob is not None and (not isinstance(glob, str) or glob.startswith(('/', '~')) or '..' in glob):
        return False
    pattern = data.get('pattern')
    if name == 'Glob' and (not isinstance(pattern, str) or pattern.startswith(('/', '~')) or '..' in pattern):
        return False
    return True


def main():
    try:
        code_dir = os.path.realpath(sys.argv[1])
        event = json.load(sys.stdin)
        if decide(code_dir, event.get('tool_name'), event.get('tool_input')):
            return 0
    except Exception:
        pass
    sys.stderr.write('محظور: مسموح فقط Read/Grep/Glob داخل نسخة كود اللوحة\n')
    return 2


if __name__ == '__main__':
    sys.exit(main())
