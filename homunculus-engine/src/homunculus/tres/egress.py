# homunculus-engine/src/homunculus/tres/egress.py
"""The install's lock on the national e-health feed (TRƏS-01, spec D2 (b)).

Homunculus is installed on-prem with the promise «no patient data leaves the building»
(docs/EDGE-BRIDGE-LOCAL.md). The feed is the first thing that can break it, so it is closed twice:
by each tenant's own `tres_settings.mode`, and by this switch, which belongs to whoever runs the
server. `TRES_EGRESS` unset, empty or anything but `on` means the module opens NO connection,
whatever a tenant's row says: the worker is not started, a round builds no client, the connection
test answers 409 `egress_off`, and the settings tab says the feed is closed.

It is read once, at start-up (`api/app.py` → `app.state.tres_egress`): changing it is a restart."""
from __future__ import annotations

from collections.abc import Mapping


def egress_on(env: Mapping[str, str]) -> bool:
    """True only when TRES_EGRESS, stripped and lower-cased, is exactly `on`."""
    return (env.get("TRES_EGRESS", "") or "").strip().lower() == "on"
