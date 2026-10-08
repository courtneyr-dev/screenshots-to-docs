#!/usr/bin/env python3
"""Assertions over a capture-report.json for the end-to-end tests. Named modes only; nothing is evaluated.

  assert-report.py <run dir> shot-ok <slug>
  assert-report.py <run dir> shot-failed <slug> [error text it must contain]
  assert-report.py <run dir> only-failed <slug>        that shot failed and every other shot succeeded
  assert-report.py <run dir> neighbor-rejected         both block shots failed as "a different block is selected"; the other shots succeeded
"""
import json
import sys

run, mode, *rest = sys.argv[1:]
data = json.load(open(run + '/capture-report.json'))
shots = {x['slug']: x for x in data['results']}


def need(cond, message):
    if not cond:
        print(message)
        print({k: (v['ok'], v.get('error', '')[:140]) for k, v in shots.items()})
        sys.exit(1)


if mode == 'shot-ok':
    need(rest[0] in shots and shots[rest[0]]['ok'], f'{rest[0]} should have been captured')
elif mode == 'shot-failed':
    need(rest[0] in shots and not shots[rest[0]]['ok'], f'{rest[0]} should have failed')
    if len(rest) > 1:
        need(rest[1] in shots[rest[0]].get('error', ''), f'{rest[0]} error should mention "{rest[1]}"')
elif mode == 'only-failed':
    need(not shots[rest[0]]['ok'], f'{rest[0]} should have failed')
    need(all(v['ok'] for k, v in shots.items() if k != rest[0]), 'every other shot should have succeeded')
elif mode == 'neighbor-rejected':
    blocks = ('block-selected-properties', 'block-selected-canvas-context')
    for b in blocks:
        need(b in shots and not shots[b]['ok'] and 'different block is selected' in shots[b].get('error', ''), f'{b} should be rejected as a different block')
    need(all(v['ok'] for k, v in shots.items() if k not in blocks), 'the non-block shots should succeed')
else:
    print(f'unknown mode {mode}')
    sys.exit(2)
