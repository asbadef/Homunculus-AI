# G2-B1d follow-up O8 — the protocol number on an inter-unit transfer

**Date:** 2026-11-02 · **Lane:** B (B1d follow-up; run by session homunculus-ai-0a) · **Branch:**
`feat/g2b-o8-nakil-protokol`, cut from main `c72cbe5` · **Closes:** B1d spec
(`2026-11-01-g2b-b1d-protokol-barkod-design.md`) §12 open item **O8**.

## 1. The problem

B1d gives every new admission a 12-digit protocol number. The number is the card's key on the board, the
id typed or scanned into a bedside device, and the barcode on the label. A transfer between units is
written by `admission/service.py` `confirm_transfer_arrival`:
- the source admission becomes `TRANSFERRED`;
- a new `ACTIVE` admission is created at the target bed.

That new row is built without `protocol_no`. Its board key would therefore fall back to the H-number,
while the card, the label and the devices still carry the protocol: E3's split, the card and its
admission under two different keys.

The new row cannot simply copy the number either. The partial unique index
`uq_admissions_tenant_protocol` (tenant, protocol_no WHERE protocol_no IS NOT NULL) allows one row per
protocol.

The transfer routes are closed today, so this is unreachable. Both routes answer 409
`transfer_unavailable`; that is amendment A-37, the owner's decision of 2026-10-27. Reopening them is
its own slice (B1b). This follow-up only makes the service do the right thing, so B1b finds it done.

## 2. Decisions (the owner, 2026-11-02)

- **D1 — Scope:** the protocol only. The transfer routes stay closed. No route, screen or migration
  changes, and nothing reaches the VM.
- **D2 — The rule:** a transfer keeps the protocol. A transfer happens inside one visit, and a protocol
  number belongs to a visit (each visit gets its own, as in the hospital's HIS). The label, the number
  on the devices and the card's key do not change, and no new label is needed.
- **D3 — The mechanism:** the number MOVES from the source row to the arriving row (approach 1, chosen
  over "both rows keep it", which needs migration 0016 and a weaker index, and over a separate
  visit table, which is HBYS-roadmap work).
  - The source (`TRANSFERRED`) row is left without a protocol.
  - The reopening slice records the moved number in the arrival's audit row.

## 3. Design

`confirm_transfer_arrival`, after the source has become `TRANSFERRED`:

1. `moved = admission.protocol_no`.
2. If `moved` is not None: `admission.protocol_no = None`, then **`await db.flush()`**. The
   order matters:
   - SQLAlchemy may otherwise flush the new row's INSERT before the source's UPDATE, and Postgres
     checks the unique index per statement;
   - the same reason makes A-37 ask for `identity_digest` to be flushed once the source has left its
     open state.
3. The new `Admission(...)` carries `protocol_no=moved`.

The F-34 warning comment at the new row is replaced by a comment saying the number moves and why it
moves before the insert.

**Behaviour:**
- A legacy admission (no protocol) transfers as before: both rows have `protocol_no` NULL, and the
  key stays the H-number.
- `board_key(new.protocol_no, patient_number)` equals the source's key, so the card's key does not
  change. One of A-37's reopening conditions becomes simpler as a result: "the card moved with
  `put_identity`" means the same key at a new bed and unit.
- No lookup by `protocol_no` exists in the product code, so moving the value breaks no read.
  - The label route reads the admission it is given. A reprint for a `TRANSFERRED` row would answer
    `no_protocol`, which is right: the label belongs to the open admission.

**A-37's list** (the comment above `_transfer_closed` in `admission/router.py`) gains two items:
- the arrival's audit row carries the moved `protocol_no` (the source row no longer has it);
- the card keeps its key across the transfer (the protocol moved with it).

## 4. Errors

None new. A unique-index violation can only mean the flush order was lost. It surfaces as the
IntegrityError it is, never as a silent second number. The test pins that it does not happen.

## 5. Testing

The tests are database tests in `tests/test_admission_workflow.py`, beside
`test_transfer_creates_new_active_and_closes_source`, and run against the shared Postgres test
database:

- **A protocol admission is transferred.**
  - The arriving row's `protocol_no` is the source's (`202600000001`, synthetic) and the source's is
    NULL.
  - `board_key` of the arriving row equals the source's key before the transfer.
  - No IntegrityError is raised.
- **A legacy admission is transferred:** both rows have `protocol_no` NULL, and the arriving row's
  key is the H-number.
- **The routes stay closed:** the existing route tests (409 `transfer_unavailable`) pass unchanged.

Red first: before the change, the first test fails on the arriving row's `protocol_no` being None.

**Gates:**
- the whole engine suite, without the database and with it (in parts, as B1d's gates ran);
- the 3.14 check of the touched files;
- the dashboard is untouched, so no dashboard gate.

## 6. Docs

- **The B1d spec §12 O8:** marked decided and done ("a transfer keeps the protocol: it moves to the
  arriving row; this follow-up").
- **The roadmap:** the G2-B1d row's «Açık» list drops O8.
- **The Turkish guide §3.10:** one sentence ("nakil açıldığında protokol aynı kalır; numara yeni
  kayda taşınır").
- **No PHI:** synthetic numbers and names only.

## 7. Not in this follow-up

- Reopening transfers (B1b, with A-37's conditions and a transfer screen).
- The arriving row's `identity_digest` (A-37), which belongs to B1b.
- A visit (encounter) table owning the protocol, which belongs to the HBYS roadmap.
