# homunculus-engine/src/homunculus/devicebeds/schemas.py
"""The bind and unbind bodies (spec §4.3). Closed (`extra="forbid"`, as admission/schemas.py): a
misspelt key is FastAPI's 422, not a value dropped. Both `expected` keys are required; null is an
explicit value ("the screen saw none"). A well-formed wrong value is `field_invalid:<field>`.

There is no `unit_id` (A-8): the bind path reads the bed's unit from the bed's own room, so a body
that carries one is refused, not obeyed and not ignored. `confirm_occupied` is a real boolean
(`StrictBool`, A-22 M5): it is the second confirmation for an admitted patient's bed, and `1`, `"yes"`
or `"true"` are not it."""
from __future__ import annotations

import uuid

from pydantic import BaseModel, ConfigDict, StrictBool


class _Closed(BaseModel):
    model_config = ConfigDict(extra="forbid")


class BindExpected(_Closed):
    device_row_id: int | None
    bed_row_id: int | None


class UnbindExpected(_Closed):
    device_row_id: int | None


class BindBody(_Closed):
    source: str
    bed_id: uuid.UUID
    expected: BindExpected
    confirm_occupied: StrictBool = False


class UnbindBody(_Closed):
    source: str
    expected: UnbindExpected
    confirm_occupied: StrictBool = False
