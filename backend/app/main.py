"""FastAPI entrypoint."""

from __future__ import annotations

import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from backend.app.utils.cuda_utils import configure_cuda_path

# Configure CUDA DLL path before any library loads ctranslate2.
configure_cuda_path()

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from backend.app.api.routes import agents, audio, clis, health, workspaces
from backend.app.api.websocket import router as ws_router
from backend.app.config import get_settings
from backend.app.core.agent_manager import get_agent_manager
from backend.app.core.transcriber import get_transcriber
from backend.app.security import local_api_auth_middleware

logging.basicConfig(
    level=get_settings().log_level.upper(),
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
)
logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(_: FastAPI) -> AsyncIterator[None]:
    logger.info("Vibe Spam backend started")

    logger.info("Preloading Whisper model in background…")
    get_transcriber().start_preload()
    try:
        yield
    finally:
        get_agent_manager().stop_all()
        logger.info("Vibe Spam backend stopped")


app = FastAPI(title="Vibe Spam", version="0.1.0", lifespan=lifespan)

settings = get_settings()
# Allow the configured frontend URL plus common Vite dev ports.
_cors_origins = [
    settings.frontend_url,
    "http://localhost:5173",
    "http://localhost:5174",
    "http://localhost:5175",
    "http://127.0.0.1:5173",
    "http://127.0.0.1:5174",
    "http://127.0.0.1:5175",
    # The packaged Electron app loads the UI from a file:// URL, whose CORS
    # origin is reported as the literal string "null".
    "null",
]
app.add_middleware(
    CORSMiddleware,
    allow_origins=list(dict.fromkeys(_cors_origins)),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.middleware("http")(local_api_auth_middleware)

app.include_router(health.router, prefix="/api", tags=["health"])
app.include_router(agents.router, prefix="/api/agents", tags=["agents"])
app.include_router(audio.router, prefix="/api/audio", tags=["audio"])
app.include_router(clis.router, prefix="/api/clis", tags=["clis"])
app.include_router(workspaces.router, prefix="/api/workspaces", tags=["workspaces"])
app.include_router(ws_router, prefix="/ws")
