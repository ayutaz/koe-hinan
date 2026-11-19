"""録画（screen.webm）に、読み上げの音声（*.wav）を timeline.json の時刻で重ねて mp4 にする。

使い方: uv run --no-project python tools/compose_demo.py  （ffmpeg が要る）
出力: public/demo/demo.mp4（公開ページで再生できる。Service Worker の保存対象からは外す）
"""
import json
import os
import subprocess

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
D = os.path.join(ROOT, ".artifacts", "demo")
OUT = os.path.join(ROOT, "public", "demo", "demo.mp4")

t = json.load(open(os.path.join(D, "timeline.json"), encoding="utf-8"))
args = ["ffmpeg", "-y", "-i", os.path.join(D, "screen.webm")]
filters = []
for i, ev in enumerate(t["timeline"], start=1):
    args += ["-i", os.path.join(D, f"{ev['clip']}.wav")]
    ms = int(ev["at"] * 1000)
    filters.append(f"[{i}:a]aresample=48000,adelay={ms}|{ms},apad[a{i}]")
mix = "".join(f"[a{i}]" for i in range(1, len(t["timeline"]) + 1))
filters.append(f"{mix}amix=inputs={len(t['timeline'])}:normalize=0,atrim=0:{t['end']:.2f}[aout]")
args += [
    "-filter_complex", ";".join(filters),
    "-map", "0:v", "-map", "[aout]",
    "-t", f"{t['end']:.2f}",
    "-c:v", "libx264", "-preset", "medium", "-crf", "26", "-pix_fmt", "yuv420p", "-r", "25",
    "-c:a", "aac", "-b:a", "128k", "-ac", "1",
    "-movflags", "+faststart",
    OUT,
]
subprocess.run(args, check=True)
print(OUT, os.path.getsize(OUT))
