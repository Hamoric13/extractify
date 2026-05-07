import subprocess
import time
import os

COOKIE_FILE = "/app/secrets/cookies.txt"
PROXY = os.environ.get("YTDLP_PROXY", "")
INTERVAL = 1800  # 30 minutes

def refresh_cookies():
    cmd = [
        "yt-dlp",
        "--cookies", COOKIE_FILE,
        "--skip-download",
        "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    ]

    if PROXY:
        cmd += ["--proxy", PROXY]

    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode == 0:
        print("Cookies refreshed successfully")
    else:
        print("Cookie refresh failed:", result.stderr.strip().splitlines()[-1] if result.stderr else "Unknown error")

if __name__ == "__main__":
    while True:
        refresh_cookies()
        time.sleep(INTERVAL)