#!/usr/bin/env python3
"""Rebuild every game asset from the original sources.

Needs assets-src/bubbros-1.6.2 (extract bubbros-1.6.2.tar.gz from
http://bub-n-bros.sourceforge.net/ into assets-src/) and assets-src/julgen.
"""
import pathlib
import subprocess
import sys

TOOLS = pathlib.Path(__file__).resolve().parent
for script in ("build_sprites.py", "build_font.py", "build_levels.py", "build_audio.py"):
    print(f"== {script}")
    subprocess.run([sys.executable, str(TOOLS / script)], check=True)
