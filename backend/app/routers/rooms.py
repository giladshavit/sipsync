from fastapi import APIRouter

router = APIRouter(prefix="/rooms", tags=["rooms"])


# POST /rooms  — implemented in M1 (Issue #13)
# GET  /rooms/{code} — implemented in M1 (Issue #13)
