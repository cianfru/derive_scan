"""Derive Scan backend: records Derive options data and serves it read-only."""
from __future__ import annotations

import asyncio
import logging
import os
from contextlib import asynccontextmanager

from dotenv import load_dotenv
from fastapi import FastAPI
from fastapi.middleware.gzip import GZipMiddleware

load_dotenv()

from derive.api import router  # noqa: E402
from derive.config import Settings  # noqa: E402
from derive.egress import ConditionalGetMiddleware, EgressCounterMiddleware  # noqa: E402
from derive.recorder import Recorder  # noqa: E402
from derive.store import Store  # noqa: E402

logging.basicConfig(level=os.getenv("LOG_LEVEL", "INFO"), format="%(asctime)s %(levelname)s %(name)s %(message)s")


@asynccontextmanager
async def lifespan(app: FastAPI):
    settings = Settings()
    store = Store(settings.db_path)
    app.state.settings, app.state.store = settings, store
    task = None
    if settings.recorder_enabled:
        rec = Recorder(settings, store)
        app.state.recorder = rec
        task = asyncio.create_task(rec.run_forever())
    yield
    if task:
        task.cancel()
        await app.state.recorder.close()
    store.close()


app = FastAPI(title="Derive Scan", lifespan=lifespan)
# Order matters: ETags see the plain body (inside gzip); the counter is outermost.
app.add_middleware(ConditionalGetMiddleware)
app.add_middleware(GZipMiddleware, minimum_size=1000)
app.add_middleware(EgressCounterMiddleware)
app.include_router(router)


@app.get("/health")
def health():
    return {"ok": True}


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=int(os.getenv("PORT", "8000")))
