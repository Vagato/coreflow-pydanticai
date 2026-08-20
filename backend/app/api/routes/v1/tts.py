"""TTS routes — read-aloud speech synthesis via the iFlytek TTS service.

Routes are HTTP plumbing only; the service client lives in
``app.services.tts``. Domain exceptions are mapped to HTTP responses by the
global exception handlers in ``app.api.exception_handlers``.
"""

from typing import Any

from fastapi import APIRouter, Response
from fastapi.responses import StreamingResponse

from app.api.deps import CurrentUser
from app.core.exceptions import ExternalServiceError
from app.schemas.tts import TTSRequest, TTSVoicesResponse
from app.services import tts as tts_service

router = APIRouter()


@router.post("")
async def synthesize(request: TTSRequest, user: CurrentUser) -> Response:
    """Synthesize speech for the given text.

    Returns MP3 audio. When ``stream=True``, audio is streamed chunk-by-chunk
    so playback can begin before the whole text is synthesized.
    """
    if not tts_service.is_configured():
        raise ExternalServiceError("iFlytek TTS is not configured")

    if request.stream:
        return StreamingResponse(
            tts_service.synthesize_stream(request.text, request.voice, request.speed),
            media_type="audio/mpeg",
            headers={"X-Content-Type-Options": "nosniff"},
        )

    audio = await tts_service.synthesize(request.text, request.voice, request.speed)
    return Response(
        content=audio,
        media_type="audio/mpeg",
        headers={
            "Content-Disposition": 'inline; filename="tts.mp3"',
            "X-Content-Type-Options": "nosniff",
        },
    )


@router.get("/voices", response_model=TTSVoicesResponse)
async def list_voices(user: CurrentUser) -> Any:
    """List available iFlytek TTS voices."""
    return {"voices": await tts_service.list_voices()}
