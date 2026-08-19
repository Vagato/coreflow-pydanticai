"""Kokoro TTS service client.

Proxies speech synthesis to the self-hosted coreflow-tts service
(see the `coreflow-tts` repo). The API key stays server-side: only the
backend talks to the TTS service, over an `X-API-Key` header.
"""

import time

import httpx

from app.core.config import settings
from app.core.exceptions import BadRequestError, ExternalServiceError

_TIMEOUT = httpx.Timeout(300.0, connect=10.0)
_VOICES_CACHE_TTL_SECS = 300.0

_voices_cache: tuple[float, list[dict]] | None = None


def is_configured() -> bool:
    return bool(settings.KOKORO_TTS_BASE_URL and settings.KOKORO_TTS_API_KEY)


def _headers() -> dict[str, str]:
    return {"X-API-Key": settings.KOKORO_TTS_API_KEY}


def _base_url() -> str:
    return settings.KOKORO_TTS_BASE_URL.rstrip("/")


async def synthesize(text: str, voice: str | None, speed: float | None) -> bytes:
    """Synthesize speech and return WAV bytes (16-bit PCM, 24 kHz)."""
    if not is_configured():
        raise ExternalServiceError("Kokoro TTS is not configured")

    payload = {
        "text": text,
        "voice": voice or "af_heart",
        "speed": speed or 1.0,
        "lang": "en-us",
    }
    try:
        async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
            response = await client.post(
                f"{_base_url()}/v1/tts", json=payload, headers=_headers()
            )
    except httpx.HTTPError as exc:
        raise ExternalServiceError(f"Kokoro TTS service unreachable: {exc}") from exc

    if response.status_code != 200:
        detail = response.text[:200]
        if 400 <= response.status_code < 500:
            raise BadRequestError(f"Kokoro TTS rejected request: {detail}")
        raise ExternalServiceError(
            f"Kokoro TTS service error {response.status_code}: {detail}"
        )
    return response.content


async def synthesize_stream(text: str, voice: str | None, speed: float | None):
    """Stream raw int16 PCM from the TTS service (async generator of bytes)."""
    if not is_configured():
        raise ExternalServiceError("Kokoro TTS is not configured")

    payload = {
        "text": text,
        "voice": voice or "af_heart",
        "speed": speed or 1.0,
        "lang": "en-us",
        "stream": True,
        "format": "pcm",
    }
    client = httpx.AsyncClient(timeout=_TIMEOUT)
    try:
        async with client.stream(
            "POST", f"{_base_url()}/v1/tts", json=payload, headers=_headers()
        ) as response:
            if response.status_code != 200:
                body = (await response.aread()).decode(errors="replace")[:200]
                if 400 <= response.status_code < 500:
                    raise BadRequestError(f"Kokoro TTS rejected request: {body}")
                raise ExternalServiceError(
                    f"Kokoro TTS service error {response.status_code}: {body}"
                )
            async for chunk in response.aiter_bytes():
                yield chunk
    except httpx.HTTPError as exc:
        raise ExternalServiceError(f"Kokoro TTS service unreachable: {exc}") from exc
    finally:
        await client.aclose()


async def list_voices() -> list[dict]:
    """List available Kokoro voices (short TTL cache)."""
    global _voices_cache
    now = time.monotonic()
    if _voices_cache and now - _voices_cache[0] < _VOICES_CACHE_TTL_SECS:
        return _voices_cache[1]

    if not is_configured():
        return []

    try:
        async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
            response = await client.get(
                f"{_base_url()}/v1/voices", headers=_headers()
            )
    except httpx.HTTPError:
        # The voices list is auxiliary — never fail the chat over it.
        return []

    if response.status_code != 200:
        return []

    voices = response.json().get("voices", [])
    _voices_cache = (now, voices)
    return voices
