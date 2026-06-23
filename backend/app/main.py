from fastapi import FastAPI

from app.routers import rooms, ws

app = FastAPI(title="SipSync", version="0.1.0")

app.include_router(rooms.router)
app.include_router(ws.router)


@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}
