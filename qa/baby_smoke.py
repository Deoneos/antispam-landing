#!/usr/bin/env python3
"""Быстрый smoke-тест «Лада» перед деплоем.

Запуск из корня репозитория:
    python3 qa/baby_smoke.py
    python3 qa/baby_smoke.py --api http://127.0.0.1:8091/health
    python3 qa/baby_smoke.py --url https://baby.kustos.ru/baby/
"""
import argparse
import json
import re
import subprocess
import sys
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
APP = ROOT / "baby"
INDEX = APP / "index.html"
JS = APP / "app.js"
CSS = APP / "styles.css"
VERSION = APP / "version.txt"

REQUIRED_IDS = {
    "app-title", "today-card", "row-sleep", "row-awake", "row-walk",
    "timer-sleep", "timer-awake", "timer-walk", "water-btn",
    "sleep-nudge", "sleep-nudge-title", "push-onboard",
    "push-onboard-text", "push-onboard-btn", "push-btn",
    "log-list", "diag-modal", "last-feed-badge", "age-hint", "t-water",
}
LEGACY_IDS = {
    "auth-login", "auth-register", "consent-box", "login-status",
    "login-name", "login-pass", "register-box", "reg-login",
    "reg-pass", "reg-name", "reg-status", "tg-login-btn",
}
DYNAMIC_PREFIXES = ("event-edit-",)
LEGACY_CODE = (
    "setAuthTab", "onLoginClick", "consentGiven",
    "submitPasswordLogin", "toggleRegister", "submitRegister",
)

ok = 0
fail = 0


def check(name, condition, detail=""):
    global ok, fail
    if condition:
        ok += 1
        print(f"  OK   {name}")
    else:
        fail += 1
        print(f"  FAIL {name}" + (f" — {detail}" if detail else ""))


def read(path):
    return path.read_text(encoding="utf-8")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--api", help="URL /health API")
    ap.add_argument("--url", help="URL живой страницы")
    args = ap.parse_args()

    print("Lad smoke test")
    check("index.html exists", INDEX.is_file())
    check("app.js exists", JS.is_file())
    check("styles.css exists", CSS.is_file())
    if fail:
        return 1

    html = read(INDEX)
    js = read(JS)

    ids = re.findall(r'\bid="([^"]+)"', html)
    duplicates = sorted({x for x in ids if ids.count(x) > 1})
    check("no duplicate HTML ids", not duplicates, str(duplicates))

    missing_required = sorted(REQUIRED_IDS - set(ids))
    check("required ids present", not missing_required, str(missing_required))
    present_legacy = sorted(LEGACY_IDS & set(ids))
    check("legacy HTML ids removed", not present_legacy, str(present_legacy))

    refs = set(re.findall(r"getElementById\(['\"]([^'\"]+)['\"]\)", js))
    missing_refs = []
    for ref in refs:
        if ref in ids:
            continue
        if any(ref.startswith(p) for p in DYNAMIC_PREFIXES):
            continue
        missing_refs.append(ref)
    check("getElementById refs resolve", not missing_refs, str(sorted(missing_refs)[:8]))

    legacy_code = [x for x in LEGACY_CODE if re.search(r"\b" + re.escape(x) + r"\b", js)]
    check("legacy auth code removed", not legacy_code, str(legacy_code))

    version = VERSION.read_text(encoding="utf-8").strip() if VERSION.is_file() else ""
    m = re.search(r"app\.js\?v=(\d+)", html)
    check("app.js version query", bool(m), "app.js?v= not found")
    if m:
        check("version.txt matches app.js", version == m.group(1), f"{version} != {m.group(1)}")

    for needed in ("water-btn", "sleep-nudge", "push-onboard", "share-profile-btn", "feedback-profile-btn"):
        check(f"feature markup: {needed}", needed in html)

    for path in ("manifest.json", "sw.js", "chart.js", "icons/icon-192.png"):
        check(f"asset exists: {path}", (APP / path).is_file())

    try:
        manifest = json.loads(read(APP / "manifest.json"))
        check("manifest parses", isinstance(manifest, dict))
        check("manifest scope /baby/", manifest.get("scope") == "/baby/")
    except Exception as e:
        check("manifest parses", False, str(e))

    if shutil_which("node"):
        try:
            r = subprocess.run(["node", "--check", str(JS)], capture_output=True, text=True, timeout=20)
            check("node --check app.js", r.returncode == 0, (r.stderr or "")[:200])
        except Exception as e:
            check("node --check app.js", False, str(e))

    if args.api:
        try:
            with urllib.request.urlopen(args.api, timeout=10) as r:
                body = r.read().decode("utf-8", "replace")
            check("API health 200", r.status == 200, f"status {r.status}")
            check("API health ok", '"ok"' in body, body[:120])
        except Exception as e:
            check("API health", False, str(e))

    if args.url:
        try:
            with urllib.request.urlopen(args.url, timeout=15) as r:
                body = r.read().decode("utf-8", "replace")
            check("live page 200", r.status == 200, f"status {r.status}")
            check("live page has app.js", "app.js?v=" in body)
        except Exception as e:
            check("live page", False, str(e))

    print(f"\n{ok} passed, {fail} failed")
    return 0 if fail == 0 else 1


def shutil_which(name):
    import shutil
    return shutil.which(name)


if __name__ == "__main__":
    sys.exit(main())
