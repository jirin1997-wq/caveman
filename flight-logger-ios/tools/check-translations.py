#!/usr/bin/env python3
"""Checks the English table against every string the code asks to translate.

Every `L10n.t("…")` literal must have an English entry, or it shows in Czech
while the app is set to English. The dictionary must not repeat a key, because
Swift traps on a duplicate key at runtime — the compiler does not catch it.

    python3 tools/check-translations.py

Exits non-zero on a missing translation or a duplicate key. Strings built from
interpolation are not literals and are skipped; they compose translated parts.
"""
import collections
import glob
import re
import sys

TABLE = 'FlightLogger/Core/Localization+English.swift'
CALL = re.compile(r'L10n\.t\("((?:[^"\\]|\\.)*)"\)')
KEY = re.compile(r'^\s+"((?:[^"\\]|\\.)*)":', re.M)


def unescape(text):
    return text.replace('\\"', '"').replace('\\\\', '\\')


def main():
    try:
        table = open(TABLE).read()
    except FileNotFoundError:
        print(f'{TABLE} not found — run from flight-logger-ios/')
        return 1

    keys = [unescape(k) for k in KEY.findall(table)]
    problems = []

    for key, count in collections.Counter(keys).items():
        if count > 1:
            problems.append(f'duplicate key in English table: "{key}" ({count}x)')

    translated = set(keys)
    used = {}
    for path in sorted(glob.glob('FlightLogger/**/*.swift', recursive=True)):
        for m in CALL.finditer(open(path).read()):
            text = unescape(m.group(1))
            used.setdefault(text, path)

    missing = sorted(t for t in used if t not in translated)
    for text in missing:
        problems.append(f'no English for: "{text}"  ({used[text]})')

    # Labels such as FlightPhase.label reach L10n through a variable, so a key
    # counts as used when its quoted text appears anywhere in the sources.
    sources = ''.join(open(p).read() for p in glob.glob('FlightLogger/**/*.swift', recursive=True)
                      if p != TABLE)
    unused = sorted(k for k in translated if k not in used and f'"{k}"' not in sources)
    for key in unused:
        problems.append(f'English entry never used anywhere: "{key}"')

    for line in problems:
        print(line)
    print(f'\n{len(used)} strings in code · {len(translated)} English entries · {len(missing)} missing')
    return 1 if problems else 0


if __name__ == '__main__':
    sys.exit(main())
