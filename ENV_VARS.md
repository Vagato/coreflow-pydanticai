# Environment variables

Reference for `coreflow` runtime configuration. The
authoritative source is `backend/.env.example` — this doc explains what each
group is for and which are required vs optional.

> Quick start: copy `backend/.env.example` to `backend/.env` and fill in the
> blanks marked **Required**. Defaults are sensible for local development.

## Project

| Variable | Required | Default | Description |
|---|---|---|---|
| `PROJECT_NAME` | optional | `coreflow` | Used in logs, OpenAPI title, email templates |
| `DEBUG` | optional | `true` | When `true`, FastAPI returns full tracebacks |
| `ENVIRONMENT` | optional | `local` | Free-form tag: `local` / `staging` / `production` |
| `TIMEZONE` | optional | `UTC` | IANA TZ name (e.g. `Europe/Warsaw`) |
| `BACKEND_URL` | optional | `http://localhost:8000` | Used by frontend BFF + email link generation |
| `FRONTEND_URL` | optional | `http://localhost:3000` | Used by password-reset / magic-link emails |

## Auth & secrets

| Variable | Required | Default | Description |
|---|---|---|---|
| `SECRET_KEY` | **required in prod** | (generated) | JWT signing key. Rotating invalidates all tokens |
| `API_KEY` | **required in prod** | (generated) | Static admin/service-to-service key for `X-API-Key` header |
| `ACCESS_TOKEN_EXPIRE_MINUTES` | optional | `30` | JWT access token lifetime |
| `REFRESH_TOKEN_EXPIRE_MINUTES` | optional | `10080` | JWT refresh token lifetime (7 days) |

## Database
| Variable | Required | Default | Description |
|---|---|---|---|
| `DATABASE_URL` | **required** | `postgresql+asyncpg://...` | Full async connection string |
| `DB_POOL_SIZE` | optional | `5` | Number of long-lived connections |
| `DB_MAX_OVERFLOW` | optional | `10` | Burst capacity above pool size |

## LLM / AI

| Variable | Required | Default | Description |
|---|---|---|---|
| `OPENAI_API_KEY` | **required** | — | From platform.openai.com |
| `AI_MODEL` | optional | `gpt-5.5` | Default model used by agent (provider-specific) |
| `LOGFIRE_TOKEN` | optional | — | When set, ships traces to Logfire (logfire.pydantic.dev) |

## RAG (pgvector)

| Variable | Required | Default | Description |
|---|---|---|---|
| `GOOGLE_DRIVE_CREDENTIALS_FILE` | required | — | Path to service-account JSON |
| `RAG_S3_BUCKET` | required | — | Source bucket for ingestion |
| `RAG_S3_PREFIX` | optional | `""` | Path prefix to scan |

## Redis

| Variable | Required | Default | Description |
|---|---|---|---|
| `REDIS_URL` | **required** | `redis://localhost:6379/0` | Used by cache, rate-limiter, session store |

## Email (resend)

| Variable | Required | Default | Description |
|---|---|---|---|
| `RESEND_API_KEY` | **required** | — | From resend.com |
| `EMAIL_FROM` | **required** | — | Verified sender, e.g. `noreply@yourdomain.com` |

## iFlytek TTS (read-aloud)

| Variable | Required | Default | Description |
|---|---|---|---|
| `IFLYTEK_TTS_APP_ID` | optional | `""` | iFlytek app ID (讯飞应用ID). Empty disables `/api/v1/tts` (503). |
| `IFLYTEK_TTS_API_KEY` | optional | `""` | iFlytek API key (接口密钥). |
| `IFLYTEK_TTS_API_SECRET` | optional | `""` | iFlytek API secret (接口密钥), used to sign requests. |

## Validation

```bash
# Confirm settings load without errors:
cd backend && uv run python -c "from app.core.config import settings; print(settings.model_dump_json(indent=2))"
```

If any **Required** var is missing, FastAPI raises `pydantic_settings.SettingsError` on startup — check the message for which field.
