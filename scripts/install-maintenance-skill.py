#!/usr/bin/env python3
"""Link the repository-owned skill into both CLI skill catalogs; never overwrite."""
import argparse
from pathlib import Path

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--home', type=Path, default=Path.home(), help='Target user home (also useful for an isolated install check)')
args = parser.parse_args()
source = Path(__file__).resolve().parents[1] / 'skills' / 'agent-workspace'
if not (source / 'SKILL.md').is_file():
    parser.error('Missing skills/agent-workspace/SKILL.md beside this checkout')
targets = [args.home / name / 'skills' / 'agent-workspace' for name in ('.codex', '.claude')]
for target in targets:
    if (target.exists() or target.is_symlink()) and not (target.is_symlink() and target.resolve() == source):
        parser.error(f'Refusing to overwrite existing skill: {target}')
for target in targets:
    target.parent.mkdir(parents=True, exist_ok=True)
    if not target.is_symlink():
        target.symlink_to(source, target_is_directory=True)
    print(f'{target} -> {source}')
