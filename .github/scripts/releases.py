"""Crea su GitHub una Release per ogni versione di CHANGELOG.md che non ce l'ha ancora.

Intestazioni attese:  ## [1.2.3] — 2026-11-15 — Titolo della release
La Release punta al commit "Release v1.2.3". Usato da .github/workflows/release.yml.
"""
import json, re, subprocess, tempfile

def run(*args):
    return subprocess.run(args, capture_output=True, text=True, check=True).stdout

cl = open("CHANGELOG.md", encoding="utf-8").read()
parts = re.split(r"^## \[(\d+\.\d+\.\d+)\](.*)$", cl, flags=re.M)
versions = []
for i in range(1, len(parts), 3):
    v, head, body = parts[i], parts[i + 1], parts[i + 2].strip()
    bits = [b.strip() for b in head.split("—") if b.strip()]
    date = bits[0] if bits else ""
    title = bits[1] if len(bits) > 1 else ""
    versions.append((v, date, title, body))

key = lambda v: tuple(int(x) for x in v.split("."))
existing = {r["tagName"] for r in json.loads(run("gh", "release", "list", "--limit", "500", "--json", "tagName") or "[]")}
commits = {}
for line in run("git", "log", "--format=%H %s").splitlines():
    sha, subject = line.split(" ", 1)
    m = re.match(r"Release v(\d+\.\d+\.\d+)$", subject)
    if m and m.group(1) not in commits:
        commits[m.group(1)] = sha

latest = max((v for v, *_ in versions), key=key)
for v, date, title, body in sorted(versions, key=lambda x: key(x[0])):
    tag = f"v{v}"
    if tag in existing:
        continue
    if v not in commits:
        print(f"{tag}: nessun commit 'Release {tag}', salto")
        continue
    notes = (f"_Rilasciata il {date}_\n\n" if date else "") + body + "\n\n🌐 **App:** https://tracker-casa-a0c47.web.app"
    with tempfile.NamedTemporaryFile("w", suffix=".md", delete=False, encoding="utf-8") as f:
        f.write(notes)
    run("gh", "release", "create", tag, "--target", commits[v],
        "--title", f"{tag} — {title}" if title else tag,
        "--notes-file", f.name, "--latest" if v == latest else "--latest=false")
    print(f"{tag}: creata")
