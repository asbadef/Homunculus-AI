# homunculus-engine/src/homunculus/protocol/schemas.py
"""GET|PUT /admin/protocol-settings (G2-B1d, spec §3). The numbers travel as their twelve-digit
text; the label as whole millimetres and the printer's dpi. A field too many, or of the wrong
type, is FastAPI's own 422 (the screen sends whole bodies); a value of the right type that the
rules refuse is a coded 422 or 409 (protocol/router.py)."""
from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, ConfigDict, StrictInt, StrictStr


class ProtocolSettingsIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    next_no: StrictStr
    label_width_mm: StrictInt
    label_height_mm: StrictInt
    printer_dpi: StrictInt


class ProtocolSettingsOut(BaseModel):
    configured: bool                 # a start number is set: admissions may be made (D5)
    next_no: str | None
    last_issued: str | None
    label_width_mm: int
    label_height_mm: int
    printer_dpi: int
    updated_at: datetime | None
