# homunculus-engine/src/homunculus/admission/numbers.py
"""The Homunculus patient number (Group 2 · B1a, spec D4 and §4.2).

`H` + the two-digit year + a five-digit sequence: `H2600042`. One sequence per tenant and calendar
year, the year in UTC, starting again at 1 each year. The number is the board's key for a patient
admitted here and what the nurse types into the bedside device, so:

* the `H` keeps it out of the HIS protocol-number namespace — a generated number equal to a HIS
  number would put two patients on one card (the pseudo-patient "X" incident);
* it holds no `/` (a path segment), no `_` (the NCE device splits the PID there) and no HL7
  delimiter (`| ^ ~ \\ &`) — letters and digits only.

It is taken from `patient_number_counters` with one UPDATE … RETURNING inside the admission's own
transaction: the row stays locked until that transaction ends, so two admissions can never share a
number, and an admission that is refused or rolled back gives its number back. At 99 999 in one
year the admission is refused (`patient_number_exhausted`) rather than given a number that would
not fit.
"""
from __future__ import annotations

import uuid
from datetime import datetime, timezone

from sqlalchemy import update
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from homunculus.admission.errors import PATIENT_NUMBER_EXHAUSTED, Refusal
from homunculus.admission.models import PatientNumberCounter

PREFIX = "H"
SEQUENCE_MAX = 99_999


def format_patient_number(year: int, sequence: int) -> str:
    """`H` + the year's last two digits + the sequence on five digits."""
    return f"{PREFIX}{year % 100:02d}{sequence:05d}"


async def next_patient_number(db: AsyncSession, tenant_id: uuid.UUID, *,
                              now: datetime | None = None) -> str:
    """The next number of this tenant's year. Call it inside the transaction that writes the
    patient: the counter row stays locked until that transaction commits or rolls back."""
    year = (now or datetime.now(timezone.utc)).astimezone(timezone.utc).year
    # A tenant's first admission of a year makes the row; two first admissions at once both
    # reach the UPDATE below, one after the other, and get 1 and 2.
    await db.execute(insert(PatientNumberCounter)
                     .values(tenant_id=tenant_id, year=year, last=0)
                     .on_conflict_do_nothing(index_elements=["tenant_id", "year"]))
    last = (await db.execute(
        update(PatientNumberCounter)
        .where(PatientNumberCounter.tenant_id == tenant_id, PatientNumberCounter.year == year)
        .values(last=PatientNumberCounter.last + 1)
        .returning(PatientNumberCounter.last)
        .execution_options(synchronize_session=False)
    )).scalar_one()
    if last > SEQUENCE_MAX:
        raise Refusal(409, PATIENT_NUMBER_EXHAUSTED,
                      f"No patient number is left for {year}: {SEQUENCE_MAX} have been issued.")
    return format_patient_number(year, last)
