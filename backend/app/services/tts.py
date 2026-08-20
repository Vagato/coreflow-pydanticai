"""iFlytek (讯飞) online TTS client.

Synthesizes Mandarin speech via the iFlytek online TTS WebSocket API
(https://www.xfyun.cn/doc/tts/online_tts/API.html). Credentials stay
server-side: the backend talks directly to iFlytek over WSS, and the API key
never reaches the browser.

The API is single-shot — one request returns one finished MP3, with an
8000-byte text cap per request. Text longer than ``MAX_CHUNK_CHARS`` is split
at sentence boundaries and synthesized one chunk at a time, yielding MP3 bytes
per chunk so playback can start before the whole text is done.
"""

import asyncio
import base64
import hashlib
import hmac
import json
import urllib.parse
from collections.abc import AsyncIterator
from email.utils import formatdate

import websockets
from websockets.exceptions import WebSocketException

from app.core.config import settings
from app.core.exceptions import ExternalServiceError

_HOST = "tts-api.xfyun.cn"
_PATH = "/v2/tts"
_WS_URL = f"wss://{_HOST}{_PATH}"

DEFAULT_VOICE = "xiaoyan"
DEFAULT_SPEED = 50  # 0-100
DEFAULT_VOLUME = 50
DEFAULT_PITCH = 50

# Long text is split at sentence boundaries into chunks up to this many chars.
# 500 chars is ~1500 UTF-8 bytes — comfortably under the API's 8000-byte-per-
# request cap — and synthesizes in a few seconds, so the first chunk reaches
# the client quickly.
MAX_CHUNK_CHARS = 500

# Characters treated as sentence boundaries (Chinese + English punctuation).
_SENTENCE_END = "。！？；.!?;…\n"  # noqa: RUF001

_VOICES: list[dict] = [
    {"id": "xiaoyan", "name": "小燕", "language": "zh-CN", "provider": "iflytek"},
    {"id": "xiaoyu", "name": "小宇", "language": "zh-CN", "provider": "iflytek"},
    {"id": "xiaomei", "name": "小梅", "language": "zh-CN", "provider": "iflytek"},
]


def is_configured() -> bool:
    return bool(
        settings.IFLYTEK_TTS_APP_ID
        and settings.IFLYTEK_TTS_API_KEY
        and settings.IFLYTEK_TTS_API_SECRET
    )


def _auth_url() -> str:
    """Build the authenticated WSS URL (HMAC-SHA256 signature over host/date/request-line)."""
    date = formatdate(usegmt=True)
    origin = f"host: {_HOST}\ndate: {date}\nGET {_PATH} HTTP/1.1"
    signature = base64.b64encode(
        hmac.new(
            settings.IFLYTEK_TTS_API_SECRET.encode(),
            origin.encode(),
            hashlib.sha256,
        ).digest()
    ).decode()
    auth_origin = (
        f'api_key="{settings.IFLYTEK_TTS_API_KEY}", algorithm="hmac-sha256", '
        f'headers="host date request-line", signature="{signature}"'
    )
    authorization = base64.b64encode(auth_origin.encode()).decode()
    query = urllib.parse.urlencode(
        {"host": _HOST, "date": date, "authorization": authorization}
    )
    return f"{_WS_URL}?{query}"


def split_text(text: str, max_chars: int = MAX_CHUNK_CHARS) -> list[str]:
    """Split text into <= max_chars chunks at sentence boundaries.

    Prefers a sentence break near the limit; falls back to a hard cut on
    whitespace when a single sentence exceeds the limit.
    """
    if len(text) <= max_chars:
        return [text]

    chunks: list[str] = []
    remaining = text
    while len(remaining) > max_chars:
        cut = max_chars
        for i in range(max_chars - 1, max_chars // 2, -1):
            if remaining[i] in _SENTENCE_END:
                cut = i + 1
                break
        else:
            space = remaining.rfind(" ", 0, max_chars)
            if space > max_chars // 2:
                cut = space + 1
        chunks.append(remaining[:cut].strip())
        remaining = remaining[cut:].strip()

    if remaining:
        chunks.append(remaining)
    return chunks


def _payload(text: str, voice: str, speed: int) -> dict:
    return {
        "common": {"app_id": settings.IFLYTEK_TTS_APP_ID},
        "business": {
            "aue": "lame",  # MP3 output
            "sfl": 1,  # streaming MP3 framing
            "vcn": voice,
            "speed": speed,
            "volume": DEFAULT_VOLUME,
            "pitch": DEFAULT_PITCH,
            "tte": "UTF8",
        },
        "data": {
            "status": 2,  # single-shot
            "text": base64.b64encode(text.encode()).decode(),
        },
    }


async def _synth_once(text: str, voice: str, speed: int) -> bytes:
    """One single-shot synthesis request; returns the MP3 bytes."""
    url = _auth_url()
    try:
        async with websockets.connect(url, open_timeout=15) as ws:
            await ws.send(json.dumps(_payload(text, voice, speed)))
            audio = bytearray()
            while True:
                raw = await asyncio.wait_for(ws.recv(), timeout=120)
                data = json.loads(raw)
                code = data.get("code", 0)
                if code != 0:
                    raise ExternalServiceError(
                        f"iFlytek TTS error {code}: {data.get('message', 'unknown')}"
                    )
                chunk = data.get("data", {}).get("audio")
                if chunk:
                    audio += base64.b64decode(chunk)
                if data.get("data", {}).get("status") == 2:
                    break
            return bytes(audio)
    except ExternalServiceError:
        raise
    except TimeoutError as exc:
        raise ExternalServiceError("iFlytek TTS timed out") from exc
    except (WebSocketException, OSError, json.JSONDecodeError) as exc:
        raise ExternalServiceError(f"iFlytek TTS connection failed: {exc}") from exc


def _resolve(voice: str | None, speed: int | None) -> tuple[str, int]:
    return voice or DEFAULT_VOICE, speed if speed is not None else DEFAULT_SPEED


async def synthesize(text: str, voice: str | None, speed: int | None) -> bytes:
    """Synthesize the whole text and return a single MP3."""
    if not is_configured():
        raise ExternalServiceError("iFlytek TTS is not configured")
    voice, speed = _resolve(voice, speed)
    parts = []
    for chunk in split_text(text):
        parts.append(await _synth_once(chunk, voice, speed))
    return b"".join(parts)


async def synthesize_stream(
    text: str, voice: str | None, speed: int | None
) -> AsyncIterator[bytes]:
    """Yield MP3 bytes per chunk so playback can start before synthesis ends."""
    if not is_configured():
        raise ExternalServiceError("iFlytek TTS is not configured")
    voice, speed = _resolve(voice, speed)
    for chunk in split_text(text):
        yield await _synth_once(chunk, voice, speed)


async def list_voices() -> list[dict]:
    return _VOICES
