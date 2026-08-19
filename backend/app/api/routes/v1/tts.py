"""TTS routes — read-aloud speech synthesis via the Kokoro TTS service.

Routes are HTTP plumbing only; the service client lives in
``app.services.tts``. Domain exceptions are mapped to HTTP responses by the
global exception handlers in ``app.api.exception_handlers``.
"""

from typing import Any

from fastapi import APIRouter, Response

from app.api.deps import CurrentUser
from app.schemas.tts import TTSRequest, TTSVoicesResponse
from app.services import tts as tts_service

router = APIRouter()


@router.post("")
async def synthesize(request: TTSRequest, user: CurrentUser) -> Response:
    """Synthesize speech for the given text and return WAV audio."""
    audio = await tts_service.synthesize(request.text, request.voice, request.speed)
    return Response(
        content=audio,
        media_type="audio/wav",
        headers={
            "Content-Disposition": 'inline; filename="tts.wav"',
            "X-Content-Type-Options": "nosniff",
        },
    )


@router.get("/voices", response_model=TTSVoicesResponse)
async def list_voices(user: CurrentUser) -> Any:
    """List available Kokoro TTS voices."""
    return {"voices": await tts_service.list_voices()}
