#!/usr/bin/env python3
"""Automated YouTube/SBS stereoscopic video downloader.

Pulls 3D SBS videos from a curated list of high-quality sources or user input
and deposits them in the processing queue directory.
"""
from __future__ import annotations

import argparse
import os
import sys
import subprocess
from pathlib import Path

QUEUE_DIR = Path("/home/papa/Downloads/queue")
QUEUE_DIR.mkdir(parents=True, exist_ok=True)

# Curated high-quality Side-by-Side 3D YouTube videos
DEFAULT_SBS_SOURCES = {
    "scenery_sbs": "https://www.youtube.com/watch?v=gIAn09pZ0K4",
    "big_buck_bunny_3d": "https://www.youtube.com/watch?v=aqY36mS6e8o",
    "avatar_trailer_3d": "https://www.youtube.com/watch?v=68A_E46yZGo"
}

def download_video(url: str, name: str) -> bool:
    print(f"[*] Starting download of '{name}' from: {url}")
    
    # We will output directly to Queue folder as {name}.mp4
    output_template = str(QUEUE_DIR / f"{name}.%(ext)s")
    
    # Set up yt-dlp arguments
    # We want a decent 1080p/720p resolution merged file (mp4 preferred)
    cmd = [
        sys.executable, "-m", "yt_dlp",
        "-f", "bestvideo[height<=1080][ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best",
        "--merge-output-format", "mp4",
        "-o", output_template,
        url
    ]
    
    try:
        res = subprocess.run(cmd, capture_output=True, text=True, check=True)
        print(f"[+] Successfully downloaded and queued: {name}.mp4")
        return True
    except subprocess.CalledProcessError as e:
        print(f"[-] Failed to download '{name}'. Error code: {e.returncode}")
        print(f"[-] stderr:\n{e.stderr}")
        return False

def main():
    parser = argparse.ArgumentParser(description="Download stereoscopic SBS videos for the look-around portal.")
    parser.add_argument("--url", type=str, help="Specific YouTube or web URL to download.")
    parser.add_argument("--name", type=str, help="Name for the video (used for filenames).")
    parser.add_argument("--all-curated", action="store_true", help="Download all curated high-quality default SBS videos.")
    
    args = parser.parse_args()
    
    if args.url:
        name = args.name or "custom_downloaded_sbs"
        download_video(args.url, name)
    elif args.all_curated:
        print("[*] Downloading all curated 3D SBS videos...")
        for name, url in DEFAULT_SBS_SOURCES.items():
            download_video(url, name)
    else:
        # Default behavior: show list of options or download the scenery video
        print("[*] No URL provided. Downloading default scenery 3D SBS video...")
        download_video(DEFAULT_SBS_SOURCES["scenery_sbs"], "scenery_sbs")

if __name__ == "__main__":
    main()
