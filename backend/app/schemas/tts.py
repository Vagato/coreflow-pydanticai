"""TTS (read-aloud) request/response schemas."""

from pydantic import BaseModel, Field


class TTSRequest(BaseModel):
    """Speech synthesis request for the Kokoro TTS service."""

    text: str = Field(min_length=1, max_length=2000)
    voice: str | None = None
    speed: float | None = Field(default=None, ge=0.5, le=2.0)
    # stream=True → raw int16 PCM streamed chunk-by-chunk (audio/pcm);
    # otherwise a whole-file WAV response.
    stream: bool = False


class TTSVoice(BaseModel):
    id: str
    name: str
    language: str
    provider: str


class TTSVoicesResponse(BaseModel):
    voices: list[TTSVoice]
