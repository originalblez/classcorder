"""Classcorder: local development server.

The app runs in the browser. Recordings go from the browser straight to Mistral's API
using the teacher's own API key, and pupils and notes are stored in the browser's
IndexedDB. This server only serves the static files, so no pupil data reaches it.
"""

from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.staticfiles import StaticFiles

# Served at the root so the same relative paths work locally and on GitHub Pages.
STATIC_DIR = Path(__file__).parent / "static"

app = FastAPI(title="Classcorder")


@app.middleware("http")
async def security_headers(request: Request, call_next):
    response = await call_next(request)
    # The CSP is set in index.html; frame-ancestors only works as a header.
    response.headers["Content-Security-Policy"] = "frame-ancestors 'none'"
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["Referrer-Policy"] = "no-referrer"
    response.headers["Permissions-Policy"] = "microphone=(self), camera=(), geolocation=()"
    # Always revalidate, so updated scripts are picked up instead of stale cached copies.
    response.headers["Cache-Control"] = "no-cache"
    return response


app.mount("/", StaticFiles(directory=STATIC_DIR, html=True), name="static")
