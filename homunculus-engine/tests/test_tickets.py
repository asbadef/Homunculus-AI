"""Short-lived tickets for the SSE endpoints.

EventSource cannot send headers, so the credential has to travel in the URL — where it lands in
server logs, browser history and referrer headers. A JWT there is a long-lived credential leaked
into three places at once. A ticket is worthless a minute later and after one use.
"""
from __future__ import annotations

from homunculus.api.tickets import TicketStore


def test_a_ticket_resolves_to_the_hospital_it_was_issued_for():
    store = TicketStore(ttl_seconds=60)
    ticket = store.issue("demo-hastanesi", now=1000.0)
    assert store.consume(ticket, now=1001.0) == "demo-hastanesi"


def test_a_ticket_works_once():
    """A replayable ticket in a URL is just a credential in a URL again."""
    store = TicketStore(ttl_seconds=60)
    ticket = store.issue("demo-hastanesi", now=1000.0)

    assert store.consume(ticket, now=1001.0) == "demo-hastanesi"
    assert store.consume(ticket, now=1002.0) is None


def test_a_ticket_expires():
    store = TicketStore(ttl_seconds=60)
    ticket = store.issue("demo-hastanesi", now=1000.0)
    assert store.consume(ticket, now=1061.0) is None


def test_an_unknown_ticket_resolves_to_nothing():
    assert TicketStore().consume("made-up", now=1000.0) is None


def test_tickets_are_unguessable_and_distinct():
    store = TicketStore()
    tickets = {store.issue("h", now=1000.0) for _ in range(50)}
    assert len(tickets) == 50
    assert all(len(t) >= 32 for t in tickets)


def test_expired_tickets_do_not_accumulate():
    """This store lives for the life of the process; without pruning it grows forever."""
    store = TicketStore(ttl_seconds=10)
    for _ in range(100):
        store.issue("h", now=1000.0)
    store.issue("h", now=2000.0)
    assert store.size() == 1


def test_the_endpoint_issues_a_ticket_that_opens_the_stream():
    from fastapi.testclient import TestClient

    from homunculus.api.app import create_app

    app = create_app({"bridge-token": "demo-hastanesi"}, run_escalation_loop=False)
    with TestClient(app) as client:
        issued = client.post("/stream-ticket", headers={"Authorization": "Bearer bridge-token"})
        assert issued.status_code == 200
        ticket = issued.json()["ticket"]

        assert client.post("/stream-ticket").status_code == 401       # no credential, no ticket
        assert app.state.tickets.consume(ticket, now=0.0) == "demo-hastanesi"


def test_a_bad_ticket_is_refused_by_the_stream():
    from fastapi.testclient import TestClient

    from homunculus.api.app import create_app

    app = create_app({"bridge-token": "demo-hastanesi"}, run_escalation_loop=False)
    with TestClient(app) as client:
        assert client.get("/stream", params={"ticket": "made-up"}).status_code == 401


def test_a_ticket_issued_for_one_hospital_cannot_open_another_hospitals_stream():
    """A ticket must stay bound to the hospital it was minted for, or it is just a shared key."""
    from fastapi.testclient import TestClient

    from homunculus.api.app import create_app

    app = create_app({"tok1": "HOSP1", "tok2": "HOSP2"}, run_escalation_loop=False)
    with TestClient(app) as client:
        issued = client.post("/stream-ticket", headers={"Authorization": "Bearer tok1"})
        ticket = issued.json()["ticket"]

        # The ticket resolves to the hospital it was issued for, never the other tenant.
        assert app.state.tickets.consume(ticket, now=0.0) == "HOSP1"


def test_stream_with_neither_token_nor_ticket_is_401_not_a_traceback():
    from fastapi.testclient import TestClient

    from homunculus.api.app import create_app

    app = create_app({"tok": "HOSP1"}, run_escalation_loop=False)
    with TestClient(app) as client:
        response = client.get("/stream")
        assert response.status_code == 401
