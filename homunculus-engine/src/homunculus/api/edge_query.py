# homunculus-engine/src/homunculus/api/edge_query.py
"""The bridge's patient query (Group 2 · B1d, spec §5.1, D3, D4, D12).

A Connex Spot's typed or scanned id reaches NCE, which asks its patient-query host — our bridge —
with a QBP^Q22; the bridge asks this route. It is the device credential's first READ: the name,
birth date and sex of one exact number. That credential already writes vitals and identities
(/ingest); the route stays closed to the outside all the same (nginx never proxies /edge, D12),
takes the number in a POST body (never in a URL, so never in an access log) and never logs it.

    POST /edge/patient-query   {"id": "<number>"}
      → 200 {"found": true, "family", "given", "birth_date", "sex"}   always the name (D3)
      → 200 {"found": false}       no record, a `kabul` tombstone, a HIS record discharged (D4)
      → 400 a body that is not one non-empty string of at most 64 characters
      → 401 / 403 no credential / not a device
      → 503 the identity store (or the tombstone check) raised: "we cannot answer" is never
            "patient unknown" — the bridge then answers from its own mirror (D8)

`create_app` builds it with its own `_caller` and identity store (a factory: `_caller` is a
closure of `create_app`, E2). Reading the sync store from this async route is the app's own
pattern (/ingest does it). "A stalled store raises within seconds" (so the 503 above comes fast)
holds only once Lane A's `fix/pg-bounds` is on main: until then a stalled database holds the
API's event loop here as it already does in /ingest, and the bridge's own 2 s timeout and mirror
protect the device alone, not the API. Hence the deploy order (amendment A-4): the bounds slice
reaches the VM before or together with B1d.
"""
from __future__ import annotations

import logging
from collections.abc import Awaitable, Callable

from fastapi import APIRouter, Header, HTTPException, Request

from homunculus.api.identity import Caller
from homunculus.api.patient_identity import IdentityStore, is_tombstone

log = logging.getLogger(__name__)

#: The longest id a query may carry: a protocol number is 12, a Comed one shorter; 64 is the board
#: key's own bound and keeps a hostile body small.
MAX_ID = 64
_DISCHARGED = "discharged"


def edge_query_router(*, caller: Callable[[str | None], Awaitable[Caller]],
                      identities: IdentityStore) -> APIRouter:
    """The route, bound to the app's caller resolver and identity store."""
    router = APIRouter()

    @router.post("/edge/patient-query", tags=["edge"])
    async def patient_query(request: Request, authorization: str | None = Header(default=None)):
        who = await caller(authorization)
        if not who.is_device:
            raise HTTPException(status_code=403, detail="the patient query requires a device token")
        try:
            body = await request.json()
        except ValueError:
            raise HTTPException(status_code=400, detail="the body is one JSON object") from None
        asked = body.get("id") if isinstance(body, dict) else None
        if not isinstance(asked, str) or not asked or len(asked) > MAX_ID:
            raise HTTPException(status_code=400,
                                detail=f"id: one non-empty string of at most {MAX_ID}")
        try:
            record = identities.get(who.hospital, asked)
            gone = record is None or is_tombstone(record) or record.state == _DISCHARGED
        except Exception as exc:  # noqa: BLE001 — any failure is "cannot answer", never "unknown"
            # The class only: a database error's words carry the statement's parameters — the
            # number asked (E14).
            log.error("patient query: the identity store did not answer (%s); answered 503",
                      type(exc).__name__)
            raise HTTPException(status_code=503, detail="the identity store did not answer") from None
        if gone:
            return {"found": False}
        return {"found": True, "family": record.family, "given": record.given,
                "birth_date": record.birth_date, "sex": record.sex}

    return router
