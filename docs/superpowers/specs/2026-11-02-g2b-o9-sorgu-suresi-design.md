# One wall-clock bound on the bridge's patient query — design as built (G2-B1d O9)

**Date:** 2026-11-02 · **Lane:** B · **Branch:** `feat/g2b-o9-sorgu-suresi`, off `main` `c72cbe5`. **Source:** open item O9 of the
B1d spec (§12), found by the local walk W-1. Code: `edge/pdq_client.py`; tests: `tests/test_edge_pdq_client.py`
(commit `7639c06`).

## 1. The problem

The bridge answers a device's patient query (`QBP^Q22`) by asking the API (`PatientQueryClient.ask`, B1d D8); when the API
cannot answer it answers from its local mirror. NCE gives its patient-query host 10 s, and the client's own bound is 2 s —
but that 2 s was urllib's socket timeout, which bounds **each socket operation**, not the ask:

- **Name resolution is not covered.** With the api container stopped, Docker's DNS failed `api` after about 4 s, so the
  device waited about 4 s for the mirror's answer (0.37 s with the API up). On the hospital VM the upstream DNS is the
  hospital's, and the stall could be longer.
- **A slow answer is not covered either.** An answer dripped slowly enough that no single read times out can take longer
  than 2 s in total.

Inside 10 s, so nothing was lost — but the fallback exists exactly for «API down», and its timing should not depend on
how the resolver fails.

## 2. The design as built

| # | Decision | Why |
|---|---|---|
| D1 | **`ask` returns or raises within `timeout` seconds of wall-clock time**, whatever blocks (resolution, connect, send, a slow read). The exchange — open, status, read, exactly what `ask` did before — runs on a **daemon thread** (`pdq-exchange`); `ask` waits for it at most `timeout` (`threading.Event.wait`). Past that: `QueryUnavailable("the API did not answer in time")`. Building the request and parsing the answer stay on the caller's thread, unchanged. | The only bound that covers a blocking `getaddrinfo`: it cannot be interrupted, but it can be left behind. |
| D2 | **The socket timeout is still passed** to the opener (`timeout=self.timeout`), so an abandoned exchange ends by itself — DNS apart, which ends when the resolver gives up. | The thread is a leftover, not a leak, once the network answers or fails. |
| D3 | **The threads are bounded.** A `BoundedSemaphore` (`max_pending`, constructor argument, default `MAX_PENDING` = 8) counts the exchanges still in flight. A slot is taken **without waiting**; with none free `ask` raises at once, `QueryUnavailable("earlier queries are still waiting on the API")`, and the mirror answers at once. The slot is given back **by the exchange thread itself**, when its exchange ends (before it wakes the caller, so a fast answer never leaves the next ask facing a full cap). | `ask` runs on asyncio's default worker threads (`edge/mllp.py`, `asyncio.to_thread`), several at once; a ward has a few dozen devices, of which a handful ask at any moment. 8 is ample for a healthy API (an exchange is well under a second) and a hard ceiling for a hung resolver — one blocked thread per query would otherwise pile up for as long as it hangs. A full cap gives the answer the mirror would have given at the deadline, up to two seconds sooner. |
| D4 | **A late result is discarded.** An exchange that finishes after the deadline stores its answer or failure where nobody reads it. Nothing is logged, printed or raised; the next ask gets its own answer. | PHI: this module logs nothing (the answer holds a name). |
| D5 | **Inside the deadline nothing changes.** What the exchange raises in time (`HTTPError`, `OSError`, `http.client.HTTPException`, anything else) is re-raised on the caller's thread and mapped by `ask` to the same words as before. A thread that cannot be started (`RuntimeError`, «can't start new thread») gives its slot back and is `QueryUnavailable("the query could not be started")`. The `opener` and `clock` seams and the constructor are as they were, plus `max_pending`. | Byte-for-byte behaviour for every answer that arrives in time. |

## 3. Errors

All three new failures are `QueryUnavailable`, which the bridge already treats as «cannot answer» (counts `queries_api_failed`,
logs the class name, answers from the mirror — `bridge._lookup`). None names the id. Nothing else about the bridge's
reply changes.

## 4. Testing

`tests/test_edge_pdq_client.py`, no network and no DNS. Every thread a test blocks is released in a fixture and joined with a
bound; the opener that blocks waits on an `Event` the test sets.

- A **blocking opener** with `timeout=0.2`: `ask` raises «did not answer in time» within 0.2 s + slack, without the id, and the
  socket timeout was still passed.
- The **real opener** with `socket.getaddrinfo` stalled (the reported symptom itself), and a **local server that drips** a
  16-byte answer a byte per 0.1 s (no single read times out): both end at the deadline.
- **The cap** (`max_pending=1`): a first ask times out while its thread is blocked; a second raises at once with «still
  waiting» and never reaches the opener; once the thread has ended a third succeeds. The default is 8: eight timed-out asks,
  the ninth refused. Back-to-back fast asks with one slot all reach the API. A refused thread start gives the slot back.
- **A late answer** (found) and **a late failure** (refused): `ask` had already raised; afterwards no log record, no output, no
  unhandled thread exception, and the next ask gets its own answer.
- Every in-time failure keeps its exact words. The existing tests, including the bridge's no-stall test (B1d E26), are unchanged.
- **A cap below one** (0, -1) is refused at construction with a `ValueError` naming `max_pending`: 0 would build a client that never
  asks the API (added after the review).

**Gates (2026-11-02):** at `7639c06`, `test_edge_pdq_client.py` + `test_edge_bridge_query.py` 53 passed (3.12 and 3.14) and the whole
engine suite without a database 3167 passed / 1110 skipped / 0 failed (main `c72cbe5`: 3153 / 1109 / 0; the 15 new tests, and one
environment-dependent skip that varies from run to run). With the review's cap guard (two more tests) the pair is 55 passed (3.12
and 3.14) and the whole suite 3169 / 1110 / 0.

## 5. Not in this slice

- **A thread per ask is accepted** over an async client: the bridge is stdlib-only and the responder already runs on a worker
  thread. A pool of long-lived exchange threads would only save a thread start per query, which is small against the API's
  round trip (0.37 s in the walk).
- **Abandoning a blocked `getaddrinfo` does not stop it;** it holds one of the 8 slots until the resolver gives up. That is the
  cap's job, and the only cost is that further queries meet the mirror at once.
- **The mirror's own answer time** and the API route are untouched.
