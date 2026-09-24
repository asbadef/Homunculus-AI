"""
Flatten an application's routes into its `APIRoute`s, for tests that inspect every endpoint.

FastAPI 0.139 no longer copies an included router's routes into `app.routes`: it puts an
`_IncludedRouter` wrapper there, whose `.original_router.routes` hold the real `APIRoute`s. A plain
`isinstance(r, APIRoute)` over `app.routes` therefore misses every router route. This walks the
wrappers recursively, and still works where a FastAPI copies plain APIRoutes into `app.routes`.

Each returned route's `path` and `dependant` are the router's own. That is the whole route only
when the include adds no prefix and no dependencies of its own (true of `api/app.py`). An include
that does is refused rather than reported with a partial path or a partial set of guards.
"""
from __future__ import annotations

from fastapi.routing import APIRoute


def api_routes(app) -> list[APIRoute]:
    found: list[APIRoute] = []

    def walk(routes) -> None:
        for route in routes:
            inner = getattr(route, "original_router", None)
            if inner is not None:
                context = getattr(route, "include_context", None)
                if getattr(context, "prefix", "") or getattr(context, "dependencies", None):
                    raise ValueError(
                        f"router {inner.prefix!r} is included with its own prefix or "
                        f"dependencies; api_routes cannot report its full paths and guards"
                    )
                walk(inner.routes)
            elif isinstance(route, APIRoute):
                found.append(route)

    walk(app.routes)
    return found
