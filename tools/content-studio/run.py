#!/usr/bin/env python3
"""One-command Content Studio launcher (no Docker).

1. Rebuild SQLite from data/data.sql when the dump changed
2. Start the local FastAPI (edge-function compatible) on :8765
3. Start the Vite frontend pointed at that API
4. Open /admin/content-studio in the browser

Usage (from repo root):
  npm run content-studio
  # or
  python3 tools/content-studio/run.py
  python3 tools/content-studio/run.py --rebuild
"""

from __future__ import annotations

import argparse
import os
import signal
import subprocess
import sys
import time
import urllib.error
import urllib.request
import webbrowser
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
VENV = HERE / ".venv"
API_URL = "http://127.0.0.1:8765"
APP_URL = "http://127.0.0.1:5173/admin/content-studio"
# Supabase JS expects a JWT-shaped anon key; signature is irrelevant locally.
LOCAL_ANON_KEY = (
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9."
    "eyJpc3MiOiJsb2NhbC1jb250ZW50LXN0dWRpbyIsInJvbGUiOiJhbm9uIn0."
    "local-content-studio"
)


def venv_python() -> Path:
    if sys.platform == "win32":
        return VENV / "Scripts" / "python.exe"
    return VENV / "bin" / "python"


def ensure_venv() -> Path:
    py = venv_python()
    if not py.exists():
        print("Creating tools/content-studio/.venv …")
        subprocess.check_call([sys.executable, "-m", "venv", str(VENV)])
        subprocess.check_call(
            [str(py), "-m", "pip", "install", "--upgrade", "pip"],
            stdout=subprocess.DEVNULL,
        )
        subprocess.check_call(
            [str(py), "-m", "pip", "install", "-r", str(HERE / "requirements.txt")],
        )
    return py


def wait_http(url: str, timeout: float = 60.0) -> bool:
    deadline = time.time() + timeout
    while time.time() < deadline:
        try:
            with urllib.request.urlopen(url, timeout=1.5) as resp:
                if 200 <= resp.status < 500:
                    return True
        except (urllib.error.URLError, TimeoutError):
            time.sleep(0.35)
    return False


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--rebuild", action="store_true", help="Force SQLite rebuild from data.sql")
    parser.add_argument("--no-open", action="store_true", help="Do not open a browser window")
    parser.add_argument("--api-only", action="store_true", help="Only run the local API")
    args = parser.parse_args()

    py = ensure_venv()

    build_cmd = [str(py), str(HERE / "build_db.py")]
    if args.rebuild:
        build_cmd.append("--force")
    subprocess.check_call(build_cmd, cwd=str(ROOT))

    children: list[subprocess.Popen] = []

    def shutdown(*_args):
        for proc in children:
            if proc.poll() is None:
                proc.send_signal(signal.SIGTERM)
        for proc in children:
            try:
                proc.wait(timeout=5)
            except subprocess.TimeoutExpired:
                proc.kill()
        sys.exit(0)

    signal.signal(signal.SIGINT, shutdown)
    signal.signal(signal.SIGTERM, shutdown)

    def log(msg: str) -> None:
        print(msg, flush=True)

    log(f"Starting local API on {API_URL} …")
    api = subprocess.Popen(
        [str(py), "-m", "uvicorn", "server:app", "--host", "127.0.0.1", "--port", "8765"],
        cwd=str(HERE),
    )
    children.append(api)

    if not wait_http(f"{API_URL}/health", timeout=30):
        print("Local API failed to start", file=sys.stderr, flush=True)
        shutdown()

    if args.api_only:
        log(f"API ready: {API_URL}/health")
        api.wait()
        return

    env = os.environ.copy()
    env["VITE_SUPABASE_URL"] = API_URL
    env["VITE_SUPABASE_KEY"] = LOCAL_ANON_KEY
    env["VITE_ENV"] = "development"
    # Prefer local mode env over any existing frontend/.env.local for this process only.
    # Free the port if a previous Vite is still around.
    try:
        listened = subprocess.check_output(["lsof", "-tiTCP:5173", "-sTCP:LISTEN"], text=True).strip()
        for pid in listened.splitlines():
            os.kill(int(pid), signal.SIGTERM)
        time.sleep(0.8)
    except (subprocess.CalledProcessError, ProcessLookupError, ValueError):
        pass

    log("Starting Vite frontend on http://127.0.0.1:5173 …")
    vite = subprocess.Popen(
        ["npm", "--prefix", "frontend", "run", "dev", "--", "--host", "127.0.0.1", "--port", "5173", "--strictPort"],
        cwd=str(ROOT),
        env=env,
    )
    children.append(vite)

    if not wait_http("http://127.0.0.1:5173/", timeout=90):
        print("Vite failed to start", file=sys.stderr, flush=True)
        shutdown()

    if not args.no_open:
        log(f"Opening {APP_URL}")
        webbrowser.open(APP_URL)

    log("Content Studio is running. Ctrl+C to stop.")
    # Wait until either child exits
    while True:
        for proc in children:
            code = proc.poll()
            if code is not None:
                print(f"Process exited ({code}); shutting down.")
                shutdown()
        time.sleep(0.5)


if __name__ == "__main__":
    main()
