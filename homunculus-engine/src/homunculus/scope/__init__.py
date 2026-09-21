"""Who may see which patient.

The dashboard has filtered its board by an assignment matrix since 21.09.2026, and the file
that does it (`patientScope.js`) says out loud what that is worth:

    ⚠️ Bu **ekran kapsamıdır.** API'ye doğrudan istek atan biri hâlâ tüm panoyu alır.

This package is the other half — the decision made where it counts.

`rules.py` holds the decision itself and imports nothing but the standard library: no FastAPI,
no SQLAlchemy, no settings. "Would this nurse see that bed" can therefore be asked in a test
without a database, a token or a server, which is the only reason the awkward cases (an
assignment that matches nothing, a bed with no unit, a patient on no known bed) have tests at
all. The rest of the package — `models.py`, `service.py`, `router.py` — is plumbing around it.
"""
from homunculus.scope.rules import (
    SCOPE_UNRESTRICTED_ROLES,
    Scope,
    ScopeReason,
    ScopeResult,
    apply_scope,
    build_scope,
    normalise_id,
    scope_report,
    sees_patient,
)

__all__ = [
    "SCOPE_UNRESTRICTED_ROLES",
    "Scope",
    "ScopeReason",
    "ScopeResult",
    "apply_scope",
    "build_scope",
    "normalise_id",
    "scope_report",
    "sees_patient",
]
