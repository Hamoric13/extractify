# Extractify

A web-based media clipper for YouTube and SoundCloud. Paste a URL, pick a format, set your timestamps, and download exactly the clip you want — no need to download the full file and cut it yourself.

Built to solve a personal problem: wanting specific parts of kirtan or music from YouTube or SoundCloud without the hassle of downloading everything.

**Live at [extractify.org](https://extractify.org)**

---

## What it does

- Paste any YouTube or SoundCloud URL
- See all available video and audio formats with quality info
- Set start and end timestamps to clip exactly what you need
- Download video clips (up to 3 minutes) or audio clips
- Download full audio tracks with one click

---

## Tech Stack

| Layer | Technology |
|---|---|
| Backend | Python, FastAPI |
| Media | yt-dlp, ffmpeg |
| Frontend | Vanilla JS, HTML, CSS |
| Hosting | Hetzner VPS, Coolify |
| Proxy | Webshare (datacenter proxy) |
| Notifications | ntfy.sh |

---

## How it works

1. User pastes a URL and hits **Fetch**
2. The backend calls yt-dlp to extract all available formats
3. User selects a format and sets timestamps
4. On download, yt-dlp downloads only the selected section using `--download-sections`
5. ffmpeg merges video and audio (for video clips) and trims precisely with `--force-keyframes-at-cuts`
6. The file is served to the user and deleted from the server after 1 hour

All downloads are routed through a residential-adjacent proxy to avoid YouTube bot detection. Cookies are used as an additional layer of authentication.

---

## Limitations

- Video clips are capped at 3 minutes
- Supported platforms: YouTube, SoundCloud
- TikTok and Instagram are not supported due to platform restrictions
- Files are deleted from the server after 1 hour

---

## Running locally

**Prerequisites:** Python 3.11+, ffmpeg, Node.js

```bash
git clone https://github.com/Hamoric13/extractify.git
cd extractify
pip install -r requirements.txt
uvicorn main:app --reload
```

Open `http://localhost:8000` in your browser.

For YouTube to work locally, export cookies from your browser:

```bash
yt-dlp --cookies-from-browser chrome --cookies cookies.txt --skip-download "https://www.youtube.com/watch?v=dQw4w9WgXcQ"
```

Place `cookies.txt` at `/app/secrets/cookies.txt` or update `COOKIE_FILE` in `main.py`.

---

## Project structure

```
extractify/
├── main.py           # FastAPI backend, yt-dlp integration
├── Dockerfile        # Container setup with ffmpeg and Node.js
├── requirements.txt  # Python dependencies
├── static/
│   ├── script.js     # Frontend logic
│   └── style.css     # Dark mode UI
└── templates/
    └── index.html    # Main page
```

---

## License

MIT — free to use, modify, and distribute.

---

*Built by [Haramrit Singh Suri](https://github.com/Hamoric13)*
