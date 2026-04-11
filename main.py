from fastapi import FastAPI, Request
from fastapi.responses import HTMLResponse, JSONResponse, FileResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
import yt_dlp
import os
import uuid
import threading
import time

app = FastAPI()

app.mount("/static", StaticFiles(directory="static"), name="static")
templates = Jinja2Templates(directory="templates")

TEMP_DIR = "temp"
os.makedirs(TEMP_DIR, exist_ok=True)

COOKIE_FILE = "/app/secrets/cookies.txt"

YDL_BASE_OPTS = {
    "quiet": True,
    "no_warnings": True,
    "cookiefile": COOKIE_FILE,
    "extractor_args": {
        "youtube": {
            "player_client": ["web"],
        }
    },
    "js_runtimes": {"node": {}},
    "remote_components": {"ejs:github": {}},
}


@app.get("/", response_class=HTMLResponse)
async def home(request: Request):
    return templates.TemplateResponse(
        request,
        "index.html",
        {"message": "Extractify is alive."}
    )


def pick_better_video_format(current_format, new_format):
    current_filesize = current_format.get("filesize") or 0
    new_filesize = new_format.get("filesize") or 0

    if new_filesize > current_filesize:
        return new_format
    if current_filesize > new_filesize:
        return current_format

    current_tbr = current_format.get("tbr") or 0
    new_tbr = new_format.get("tbr") or 0

    if new_tbr > current_tbr:
        return new_format

    return current_format


def parse_timestamp_to_seconds(value):
    if value is None:
        return None

    value = str(value).strip()
    if not value:
        return None

    parts = value.split(":")
    try:
        parts = [int(part) for part in parts]
    except ValueError:
        return None

    if len(parts) == 3:
        hours, minutes, seconds = parts
        if minutes > 59 or seconds > 59:
            return None
        return hours * 3600 + minutes * 60 + seconds

    if len(parts) == 2:
        minutes, seconds = parts
        if seconds > 59:
            return None
        return minutes * 60 + seconds

    if len(parts) == 1:
        return parts[0]

    return None


def schedule_file_delete(filepath, delay_seconds=3600):
    def delete_later():
        time.sleep(delay_seconds)
        try:
            if os.path.exists(filepath):
                os.remove(filepath)
        except Exception:
            pass

    threading.Thread(target=delete_later, daemon=True).start()


@app.post("/api/info")
async def get_media_info(request: Request):
    data = await request.json()
    url = data.get("url", "").strip()

    if not url:
        return JSONResponse({"error": "URL is required."}, status_code=400)

    ydl_opts = YDL_BASE_OPTS.copy()

    try:
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            info = ydl.extract_info(url, download=False)

        title = info.get("title", "Unknown title")
        duration = info.get("duration", 0)
        formats = info.get("formats", [])

        best_video_by_resolution = {}
        audio_formats = []
        seen_audio = set()

        for f in formats:
            ext = f.get("ext")
            format_id = f.get("format_id")
            vcodec = f.get("vcodec")
            acodec = f.get("acodec")
            width = f.get("width")
            height = f.get("height")
            filesize = f.get("filesize")
            abr = f.get("abr")
            resolution = f.get("resolution")
            tbr = f.get("tbr")

            if ext == "mhtml":
                continue

            if vcodec == "none" and acodec == "none":
                continue

            if vcodec == "none" and acodec != "none":
                audio_key = (ext, acodec, abr, filesize)
                if audio_key in seen_audio:
                    continue

                seen_audio.add(audio_key)

                audio_formats.append({
                    "format_id": format_id,
                    "ext": ext,
                    "resolution": "audio only",
                    "width": None,
                    "height": None,
                    "filesize": filesize,
                    "vcodec": "none",
                    "acodec": acodec,
                    "abr": abr,
                    "tbr": tbr,
                })
                continue

            if ext != "mp4":
                continue

            if vcodec == "none":
                continue

            if height is not None and width is not None:
                resolution_key = (width, height)
                display_resolution = f"{width}x{height}"
            elif resolution:
                resolution_key = resolution
                display_resolution = resolution
            else:
                resolution_key = "unknown"
                display_resolution = "Unknown"

            candidate = {
                "format_id": format_id,
                "ext": ext,
                "resolution": display_resolution,
                "width": width,
                "height": height,
                "filesize": filesize,
                "vcodec": vcodec,
                "acodec": acodec,
                "abr": abr,
                "tbr": tbr,
            }

            if resolution_key not in best_video_by_resolution:
                best_video_by_resolution[resolution_key] = candidate
            else:
                best_video_by_resolution[resolution_key] = pick_better_video_format(
                    best_video_by_resolution[resolution_key],
                    candidate,
                )

        video_formats = list(best_video_by_resolution.values())
        video_formats.sort(key=lambda f: (f.get("height") or 0, f.get("width") or 0))

        audio_formats.sort(
            key=lambda f: (
                f.get("abr") or 0,
                f.get("filesize") or 0,
            ),
            reverse=True,
        )

        return {
            "title": title,
            "duration": duration,
            "video_formats": video_formats,
            "audio_formats": audio_formats,
        }

    except Exception as e:
        return JSONResponse({"error": str(e)}, status_code=500)


@app.post("/api/process")
async def process_media(request: Request):
    data = await request.json()

    url = str(data.get("url", "")).strip()
    format_id = str(data.get("format_id", "")).strip()
    media_type = str(data.get("media_type", "")).strip()
    start_time = data.get("start_time", "")
    end_time = data.get("end_time", "")
    full_audio = bool(data.get("full_audio", False))

    if not url:
        return JSONResponse({"error": "URL is required."}, status_code=400)

    if not format_id:
        return JSONResponse({"error": "Format selection is required."}, status_code=400)

    if media_type not in ["video", "audio"]:
        return JSONResponse({"error": "Invalid media type."}, status_code=400)

    try:
        duration = 0
        start_seconds = None
        end_seconds = None

        if media_type == "video" or (media_type == "audio" and not full_audio):
            info_opts = YDL_BASE_OPTS.copy()
            with yt_dlp.YoutubeDL(info_opts) as ydl:
                info = ydl.extract_info(url, download=False)
            duration = info.get("duration", 0)

        if media_type == "video":
            start_seconds = parse_timestamp_to_seconds(start_time)
            end_seconds = parse_timestamp_to_seconds(end_time)

            if start_seconds is None or end_seconds is None:
                return JSONResponse(
                    {"error": "Valid start and end timestamps are required for video."},
                    status_code=400,
                )

            if end_seconds <= start_seconds:
                return JSONResponse(
                    {"error": "End time must be greater than start time."},
                    status_code=400,
                )

            if end_seconds > duration:
                return JSONResponse(
                    {"error": "End time cannot exceed media duration."},
                    status_code=400,
                )

            if (end_seconds - start_seconds) > 180:
                return JSONResponse(
                    {"error": "Video clips cannot exceed 3 minutes."},
                    status_code=400,
                )

        elif media_type == "audio" and not full_audio:
            start_seconds = parse_timestamp_to_seconds(start_time)
            end_seconds = parse_timestamp_to_seconds(end_time)

            if start_seconds is None or end_seconds is None:
                return JSONResponse(
                    {"error": "Valid start and end timestamps are required unless full audio is selected."},
                    status_code=400,
                )

            if end_seconds <= start_seconds:
                return JSONResponse(
                    {"error": "End time must be greater than start time."},
                    status_code=400,
                )

            if end_seconds > duration:
                return JSONResponse(
                    {"error": "End time cannot exceed media duration."},
                    status_code=400,
                )

        job_id = str(uuid.uuid4())
        output_template = os.path.join(TEMP_DIR, f"{job_id}.%(ext)s")

        if media_type == "audio" and full_audio:
            ydl_opts = YDL_BASE_OPTS.copy()
            ydl_opts.update({
                "format": format_id,
                "outtmpl": output_template,
                "noplaylist": True,
            })

            with yt_dlp.YoutubeDL(ydl_opts) as ydl:
                ydl.download([url])

        else:
            if media_type == "video":
                format_string = f"{format_id}+bestaudio"
            else:
                format_string = format_id

            ydl_opts = YDL_BASE_OPTS.copy()
            ydl_opts.update({
                "format": format_string,
                "outtmpl": output_template,
                "noplaylist": True,
                "download_ranges": yt_dlp.utils.download_range_func(
                    None,
                    [(start_seconds, end_seconds)]
                ),
                "force_keyframes_at_cuts": True,
            })

            if media_type == "video":
                ydl_opts["merge_output_format"] = "mp4"

            with yt_dlp.YoutubeDL(ydl_opts) as ydl:
                ydl.download([url])

        produced_files = [
            os.path.join(TEMP_DIR, f)
            for f in os.listdir(TEMP_DIR)
            if f.startswith(job_id + ".")
        ]

        if not produced_files:
            return JSONResponse({"error": "No output file was created."}, status_code=500)

        output_file = max(produced_files, key=os.path.getmtime)
        filename = os.path.basename(output_file)

        schedule_file_delete(output_file, delay_seconds=3600)

        return {
            "success": True,
            "download_url": f"/download/{filename}",
            "filename": filename,
        }

    except Exception as e:
        return JSONResponse({"error": str(e)}, status_code=500)


@app.get("/download/{filename}")
async def download_file(filename: str):
    filepath = os.path.join(TEMP_DIR, filename)

    if not os.path.exists(filepath):
        return JSONResponse({"error": "File not found or expired."}, status_code=404)

    return FileResponse(filepath, filename=filename)