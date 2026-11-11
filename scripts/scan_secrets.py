#!/usr/bin/env python3
"""Offline checks for tracked/staged source. Findings never print secret values."""
from pathlib import Path
import argparse
import json
import re
import subprocess

ROOT = Path(__file__).resolve().parents[1]
RULES = {
    'private-key': r'-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----',
    'github-token': r'\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,})\b',
    'api-token': r'\b(?:sk-(?:proj-)?[A-Za-z0-9_-]{24,}|AKIA[A-Z0-9]{16}|ASIA[A-Z0-9]{16}|AIza[0-9A-Za-z_-]{30,}|xox[baprs]-[0-9A-Za-z-]{20,})\b',
    'credential-literal': r'''(?i)(?:api[_-]?key|client[_-]?secret|access[_-]?token|refresh[_-]?token|password|authorization)\s*[:=]\s*['"]([^'"\n]{8,})['"]''',
    'credential-url': r'''https?://[^/\s"']+:[^/\s"']+@''',
}
PRIVATE_NAMES = {'credentials.json', 'service-account.json', 'cookies', 'login data', 'history', 'bookmarks'}
EXCLUDED = {'.git', 'node_modules', '__pycache__', 'audit-output'}


def files(staged):
    args = ['git', 'diff', '--cached', '--name-only', '--diff-filter=ACMR', '-z'] if staged else ['git', 'ls-files', '-z']
    result = subprocess.run(args, cwd=ROOT, capture_output=True)
    if result.returncode == 0:
        for name in result.stdout.decode('utf-8').split('\0'):
            if not name:
                continue
            path = ROOT / name
            if staged:
                data = subprocess.run(['git', 'show', ':' + name], cwd=ROOT, capture_output=True, check=True).stdout
            elif path.is_file():
                data = path.read_bytes()
            else:
                continue
            yield name, data
    elif staged:
        raise ValueError('Staged scan requires a Git repository')
    else:
        for path in ROOT.rglob('*'):
            if path.is_file() and not any(part in EXCLUDED for part in path.relative_to(ROOT).parts):
                yield path.relative_to(ROOT).as_posix(), path.read_bytes()


def scan(staged=False):
    findings = []
    count = 0
    for name, data in files(staged):
        count += 1
        low = Path(name).name.lower()
        if (low.startswith('.env') and low != '.env.example') or low in PRIVATE_NAMES or low.endswith(('.pem', '.key', '.p12', '.pfx')):
            findings.append({'file': name, 'line': 1, 'rule': 'private-file'})
        if b'\0' in data or name.lower().endswith(('.png', '.jpg', '.jpeg', '.gif', '.ico')):
            continue
        value = data.decode('utf-8', errors='replace')
        for rule, pattern in RULES.items():
            for match in re.finditer(pattern, value):
                findings.append({'file': name, 'line': value.count('\n', 0, match.start()) + 1, 'rule': rule})
    return {'scanned_files': count, 'findings': findings}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--staged', action='store_true')
    args = parser.parse_args()
    result = scan(args.staged)
    print(json.dumps(result, ensure_ascii=True))
    raise SystemExit(1 if result['findings'] else 0)


if __name__ == '__main__':
    main()
