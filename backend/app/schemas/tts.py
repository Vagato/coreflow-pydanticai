"""TTS (read-aloud) request/response schemas."""

from pydantic import BaseModel, Field


class TTSRequest(BaseModel):
    """Speech synthesis request for the iFlytek TTS service."""

    text: str = Field(min_length=1, max_length=8000)
    voice: str | None = None
    speed: int | None = Field(default=None, ge=0, le=100)
    # stream=True → MP3 streamed chunk-by-chunk (audio/mpeg) so playback can
    # start before the whole text is synthesized; otherwise a whole-file MP3.
    stream: bool = False


class TTSVoice(BaseModel):
    id: str
    name: str
    language: str
    provider: str


class TTSVoicesResponse(BaseModel):
    voices: list[TTSVoice]
