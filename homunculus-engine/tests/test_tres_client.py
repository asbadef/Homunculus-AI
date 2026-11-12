# homunculus-engine/tests/test_tres_client.py
"""TRƏS-01 (spec §4, D21): the platform's client over `httpx.MockTransport` — the session, the
Bearer token, one new token on a 401, find → create / update with the two `id` rules, validate,
delete, read, the three error shapes, 429 with `Retry-After`, a failure with no answer, the
spacing hook. The platform is never contacted. Synthetic account, synthetic people."""
from __future__ import annotations

import asyncio
import base64
import json

import httpx
import pytest

from homunculus.tres.client import (
    CALL_DEADLINE_S, LOCAL_ID_EXTENSION, TOKEN_CONTENT_TYPE, TresAccount, TresClient, TresError, TresLoginRefused,
    TresSearchUnclear, TresSessionError, is_outage, read_error,
)
from homunculus.tres.ledger import _write
from tests.fake_tres import FakeTres

ACCOUNT = TresAccount("https://tres.test", "sentetik", "gizli-parola", "PRV-0001")
PATIENT = {"resourceType": "Patient", "meta": {"profile": ["http://fhir.az/StructureDefinition/az-patient"]},
           "extension": [{"url": LOCAL_ID_EXTENSION, "valueString": "hmn-p-0001"}],
           "name": [{"family": "Sentetik", "given": ["Ayşe"]}]}


def searchset(*entries, **elements) -> httpx.Response:
    """A search answer as the platform gives one: a searchset Bundle."""
    return httpx.Response(200, json={"resourceType": "Bundle", "type": "searchset", "entry": list(entries),
                                     **elements})


class Script:
    """A scripted platform. The token route always opens a session (`S-1`, `S-2`, …); every other
    request takes the next scripted answer — a Response, or a function of the request."""

    def __init__(self, *answers) -> None:
        self.answers = list(answers)
        self.calls: list[httpx.Request] = []
        self.sessions = 0

    def __call__(self, request: httpx.Request) -> httpx.Response:
        self.calls.append(request)
        if request.url.path == "/auth/token":
            self.sessions += 1
            return httpx.Response(200, json={"payload": {"sessionId": f"S-{self.sessions}"}})
        answer = self.answers.pop(0)
        return answer(request) if callable(answer) else answer

    @property
    def fhir(self) -> list[httpx.Request]:
        return [r for r in self.calls if r.url.path != "/auth/token"]

    @property
    def lines(self) -> list[tuple[str, str]]:
        return [(r.method, r.url.path) for r in self.calls]


def client_on(script) -> TresClient:
    return TresClient(ACCOUNT, transport=httpx.MockTransport(script))


def outcome(status: int, text: str) -> httpx.Response:
    return httpx.Response(status, json={"resourceType": "OperationOutcome",
                                        "issue": [{"severity": "error", "diagnostics": text}]})


# ---------------------------------------------------------------- the account and the address
def test_only_https_is_accepted_and_nothing_is_built_before_the_first_request():
    for url in ("http://tres.test", "tres.test", "", "ftp://tres.test"):
        with pytest.raises(ValueError):
            TresClient(TresAccount(url, "u", "p", "PRV"))
    client = client_on(Script())
    assert client._client is None and client.requests == 0


def test_the_password_is_not_in_the_accounts_repr():
    assert "gizli-parola" not in repr(ACCOUNT)
    assert "sentetik" in repr(ACCOUNT)


# ---------------------------------------------------------------- the session (§4.1)
async def test_the_token_request_is_basic_with_the_provider_id_and_is_asked_once():
    script = Script()
    client = client_on(script)
    assert await client.token() == "S-1"
    assert await client.token() == "S-1"
    (request,) = script.calls
    assert (request.method, str(request.url)) == ("POST", "https://tres.test/auth/token")
    basic = base64.b64encode(b"sentetik:gizli-parola").decode()
    assert request.headers["Authorization"] == f"Basic {basic}"
    assert request.headers["Content-Type"] == TOKEN_CONTENT_TYPE
    assert json.loads(request.content) == {"healthcareProviderId": "PRV-0001"}
    await client.aclose()


@pytest.mark.parametrize("response, status, words", [
    (httpx.Response(401, json={"message": "Invalid credentials"}), 401, "Invalid credentials"),
    (httpx.Response(200, json={"payload": {}}), 200, "the platform's answer carries no session id"),
    (httpx.Response(200, text="<html>"), 200, "the platform's answer carries no session id"),
    (httpx.Response(200, json={"payload": {"sessionId": "oturum ç"}}), 200,
     "the platform's answer carries no session id"),        # no header could carry it
    (httpx.Response(503, text=""), 503, "HTTP 503"),
    (httpx.Response(403, json={"error": "Provider blocked"}), 403, "Provider blocked"),
])
async def test_a_refused_or_malformed_token_answer_is_a_session_error(response, status, words):
    """Nothing in it is about one resource: the ledger must count it against none (review #1)."""
    client = TresClient(ACCOUNT, transport=httpx.MockTransport(lambda request: response))
    with pytest.raises(TresSessionError) as raised:
        await client.token()
    assert (raised.value.status, raised.value.message) == (status, words)
    assert isinstance(raised.value, TresError) and is_outage(raised.value)
    await client.aclose()


async def test_a_429_from_the_token_route_is_a_session_error_that_keeps_retry_after():
    client = TresClient(ACCOUNT, transport=httpx.MockTransport(
        lambda request: httpx.Response(429, headers={"Retry-After": "90"}, json={"message": "Slow down"})))
    with pytest.raises(TresSessionError) as raised:
        await client.find("Patient", "hmn-p-0001")
    assert (raised.value.status, raised.value.message, raised.value.retry_after) == (429, "Slow down", 90.0)
    await client.aclose()


@pytest.mark.parametrize("response, refused", [
    (httpx.Response(401, json={"message": "Invalid credentials"}), True),
    (httpx.Response(403, json={"error": "Provider blocked"}), True),
    (httpx.Response(400, json={"error": "Bad provider id"}), True),
    (httpx.Response(404, text=""), True),
    (httpx.Response(408, text=""), False),
    (httpx.Response(429, text=""), False),
    (httpx.Response(503, text=""), False),
    (httpx.Response(200, json={"payload": {}}), False),
])
async def test_only_a_4xx_of_the_token_route_is_a_refused_login(response, refused):
    """Review I3: what the worker parks a tenant for — the platform said no to the account."""
    client = TresClient(ACCOUNT, transport=httpx.MockTransport(lambda request: response))
    with pytest.raises(TresSessionError) as raised:
        await client.token()
    assert isinstance(raised.value, TresLoginRefused) is refused
    await client.aclose()


async def test_a_second_401_on_a_fhir_call_is_no_refused_login():
    client = client_on(Script(httpx.Response(401, json={"error": "Session expired"}),
                              httpx.Response(401, json={"error": "Session expired"})))
    with pytest.raises(TresSessionError) as raised:
        await client.find("Patient", "hmn-p-0001")
    assert not isinstance(raised.value, TresLoginRefused)
    await client.aclose()


async def test_every_fhir_request_carries_the_session_as_a_bearer_token():
    script = Script(searchset())
    client = client_on(script)
    await client.find("Patient", "hmn-p-0001")
    assert script.fhir[0].headers["Authorization"] == "Bearer S-1"
    assert script.lines == [("POST", "/auth/token"), ("GET", "/fhir/Patient")]
    await client.aclose()


async def test_a_401_asks_one_new_token_and_sends_the_request_once_more():
    script = Script(httpx.Response(401, json={"error": "Session expired"}),
                    searchset())
    client = client_on(script)
    assert await client.find("Patient", "hmn-p-0001") is None
    assert script.lines == [("POST", "/auth/token"), ("GET", "/fhir/Patient"),
                            ("POST", "/auth/token"), ("GET", "/fhir/Patient")]
    assert [r.headers["Authorization"] for r in script.fhir] == ["Bearer S-1", "Bearer S-2"]
    await client.aclose()


async def test_a_second_401_is_the_error_and_the_next_call_asks_a_token_again():
    script = Script(httpx.Response(401, json={"error": "Session expired"}),
                    httpx.Response(401, json={"error": "Session expired"}),
                    searchset())
    client = client_on(script)
    with pytest.raises(TresSessionError) as raised:
        await client.find("Patient", "hmn-p-0001")
    assert (raised.value.status, raised.value.message) == (401, "Session expired")
    assert len(script.fhir) == 2 and script.sessions == 2
    assert await client.find("Patient", "hmn-p-0001") is None
    assert script.sessions == 3
    await client.aclose()


# ---------------------------------------------------------------- the six calls (§4.2, §4.3)
async def test_find_searches_by_the_local_id_and_answers_the_servers_id_or_none():
    script = Script(
        searchset({"resource": {**PATIENT, "id": "7001"}}),
        httpx.Response(200, json={"resourceType": "Bundle", "type": "searchset", "total": 0}))
    client = client_on(script)
    assert await client.find("Patient", "hmn-p-0001") == "7001"
    assert await client.find("Patient", "hmn-p-0002") is None
    assert [dict(r.url.params) for r in script.fhir] == [{"local-system-unique-id": "hmn-p-0001"},
                                                        {"local-system-unique-id": "hmn-p-0002"}]
    await client.aclose()


def _with_local_id(local_id: str, server_id: str) -> dict:
    return {"resource": {**PATIENT, "id": server_id,
                         "extension": [{"url": LOCAL_ID_EXTENSION, "valueString": local_id}]}}


async def test_find_answers_only_the_entry_whose_local_id_is_exactly_the_one_asked():
    """Review #3: the search is a FHIR string search (a prefix, in any case), so the first entry
    may be another resource's. Only an exact, case-sensitive match is an answer."""
    script = Script(
        searchset(_with_local_id("hmn-p-00010", "7010"), _with_local_id("HMN-P-0001", "7011"),
                  {"resource": {**PATIENT, "id": "7012", "extension": []}}, {"resource": "?"}, "?",
                  _with_local_id("hmn-p-0001", "7001")),
        searchset(_with_local_id("hmn-p-00010", "7010"), _with_local_id("HMN-P-0001", "7011")))
    client = client_on(script)
    assert await client.find("Patient", "hmn-p-0001") == "7001"
    assert await client.find("Patient", "hmn-p-0001") is None
    await client.aclose()


async def test_find_against_the_stand_in_tells_a_local_id_from_its_prefix():
    fake = FakeTres()
    client = TresClient(fake.account, transport=fake.transport)
    lab = {**PATIENT, "resourceType": "Observation",
           "extension": [{"url": LOCAL_ID_EXTENSION, "valueString": "hmn-l-120"}]}
    remote = await client.create("Observation", {**lab, "id": "hmn-l-120"})
    assert await client.find("Observation", "hmn-l-12") is None          # the stand-in answered hmn-l-120
    assert await client.find("Observation", "HMN-L-120") is None
    assert await client.find("Observation", "hmn-l-120") == remote
    await client.aclose()


def _lab(local_id: str) -> dict:
    return {**PATIENT, "resourceType": "Observation",
            "extension": [{"url": LOCAL_ID_EXTENSION, "valueString": local_id}]}


def _labs_sharing_the_prefix_of_hmn_l_1() -> list[str]:
    """Twenty-four lab ids that `hmn-l-1` is a prefix of (spec D5: lab ids are audit row ids)."""
    return [f"hmn-l-1{n}" for n in range(10)] + [f"hmn-l-1{n:02d}" for n in range(14)]


async def test_an_exact_hit_beyond_the_first_page_is_unclear_and_nothing_is_posted():
    """Review I1: the platform answers a page of twenty; `hmn-l-1` is held, 25th of its matches."""
    fake = FakeTres()
    client = TresClient(fake.account, transport=fake.transport)
    for local_id in _labs_sharing_the_prefix_of_hmn_l_1() + ["hmn-l-1"]:
        await client.create("Observation", {**_lab(local_id), "id": local_id})
    with pytest.raises(TresSearchUnclear) as raised:
        await client.find("Observation", "hmn-l-1")
    assert (raised.value.status, raised.value.message) == (200, "the search answer has a next page")
    assert isinstance(raised.value, TresError) and not is_outage(raised.value)
    with pytest.raises(TresSearchUnclear):
        await _write(client, "Observation", "hmn-l-1", _lab("hmn-l-1"), None)
    assert len(fake.stored("Observation")) == 25                          # no second record of hmn-l-1
    assert fake.fhir_requests[-1] == ("GET", "/fhir/Observation")
    await client.aclose()


async def test_an_exact_hit_on_the_first_page_is_found_whatever_follows_it():
    fake = FakeTres()
    client = TresClient(fake.account, transport=fake.transport)
    remote = await client.create("Observation", {**_lab("hmn-l-1"), "id": "hmn-l-1"})
    for local_id in _labs_sharing_the_prefix_of_hmn_l_1():
        await client.create("Observation", {**_lab(local_id), "id": local_id})
    assert await client.find("Observation", "hmn-l-1") == remote         # page 1 of 2: found all the same
    await client.aclose()


@pytest.mark.parametrize("answer, said", [
    (searchset({"resource": {**PATIENT, "id": "7001", "extension": []}}), "a search entry carries no local id"),
    (searchset(_with_local_id("hmn-p-00010", "7010"), {"resource": {"resourceType": "Patient", "id": "7002"}}),
     "a search entry carries no local id"),
    (searchset(_with_local_id("hmn-p-00010", "7010"), "?"), "a search entry carries no local id"),
    (httpx.Response(200, json={"resourceType": "OperationOutcome", "issue": []}),
     "the search answer is not a searchset Bundle"),
    (httpx.Response(200, json={"resourceType": "Bundle", "type": "collection", "entry": []}),
     "the search answer is not a searchset Bundle"),
    (httpx.Response(200, json=[]), "the search answer is not a searchset Bundle"),
    (httpx.Response(200, text="<html>"), "the search answer is not a searchset Bundle"),
    (searchset(_with_local_id("hmn-p-00010", "7010"), link=[{"relation": "next", "url": "https://tres.test/x"}]),
     "the search answer has a next page"),
    (searchset(_with_local_id("hmn-p-00010", "7010"), total=2), "the search answer's total exceeds its entries"),
    (searchset(total="many"), "the search answer's total exceeds its entries"),
    (httpx.Response(200, json={"resourceType": "Bundle", "type": "searchset", "entry": {"resource": {}}}),
     "the search answer is not a searchset Bundle"),
])
async def test_an_answer_that_cannot_prove_the_absence_is_unclear(answer, said):
    client = client_on(Script(answer))
    with pytest.raises(TresSearchUnclear) as raised:
        await client.find("Patient", "hmn-p-0001")
    assert (raised.value.status, raised.value.message) == (200, said)
    await client.aclose()


@pytest.mark.parametrize("answer", [
    searchset(), searchset(_with_local_id("hmn-p-00010", "7010"), total=1),
    searchset(_with_local_id("HMN-P-0001", "7011"), link=[{"relation": "self", "url": "https://tres.test/x"}]),
    httpx.Response(200, json={"resourceType": "Bundle", "type": "searchset", "total": 0}),
])
async def test_a_complete_answer_without_the_id_is_none(answer):
    client = client_on(Script(answer))
    assert await client.find("Patient", "hmn-p-0001") is None
    await client.aclose()


async def test_a_complete_single_page_without_the_id_is_none_and_the_write_posts():
    fake = FakeTres()
    client = TresClient(fake.account, transport=fake.transport)
    held = await client.create("Observation", {**_lab("hmn-l-10"), "id": "hmn-l-10"})
    assert await client.find("Observation", "hmn-l-1") is None            # one page, every entry carries its id
    remote, operation = await _write(client, "Observation", "hmn-l-1", _lab("hmn-l-1"), None)
    assert operation == "create" and remote != held and len(fake.stored("Observation")) == 2
    await client.aclose()


async def test_create_posts_the_placeholder_id_and_answers_the_servers_own():
    script = Script(httpx.Response(201, json={**PATIENT, "id": "7001"}))
    client = client_on(script)
    assert await client.create("Patient", {**PATIENT, "id": "hmn-p-0001"}) == "7001"
    (request,) = script.fhir
    assert (request.method, request.url.path) == ("POST", "/fhir/Patient")
    assert request.headers["Content-Type"] == "application/json"
    sent = json.loads(request.content)
    assert sent["id"] == "hmn-p-0001" and sent["name"] == [{"family": "Sentetik", "given": ["Ayşe"]}]
    assert "Ayşe".encode() in request.content          # UTF-8, not \u escapes
    await client.aclose()


async def test_create_without_an_id_is_refused_here_and_nothing_is_sent():
    script = Script()
    client = client_on(script)
    with pytest.raises(ValueError):
        await client.create("Patient", PATIENT)
    assert script.calls == []
    await client.aclose()


async def test_create_whose_answer_carries_no_id_is_an_error():
    client = client_on(Script(httpx.Response(201, json={"resourceType": "Patient"})))
    with pytest.raises(TresError) as raised:
        await client.create("Patient", {**PATIENT, "id": "hmn-p-0001"})
    assert raised.value.message == "the platform's answer carries no resource id"
    await client.aclose()


async def test_update_puts_the_servers_id_in_the_url_and_in_the_body():
    script = Script(httpx.Response(200, json={**PATIENT, "id": "7001"}))
    client = client_on(script)
    await client.update("Patient", "7001", {**PATIENT, "id": "hmn-p-0001"})
    (request,) = script.fhir
    assert (request.method, request.url.path) == ("PUT", "/fhir/Patient/7001")
    assert json.loads(request.content)["id"] == "7001"
    await client.aclose()


async def test_validate_posts_to_the_validate_operation_and_reads_an_error_issue_in_a_200():
    script = Script(
        httpx.Response(200, json={"resourceType": "OperationOutcome",
                                  "issue": [{"severity": "information", "diagnostics": "No issues"}]}),
        httpx.Response(200, json={"resourceType": "OperationOutcome", "issue": [
            {"severity": "warning", "diagnostics": "a display differs"},
            {"severity": "error", "diagnostics": "Patient.name: minimum required = 1"}]}))
    client = client_on(script)
    await client.validate("Patient", {**PATIENT, "id": "hmn-p-0001"})
    with pytest.raises(TresError) as raised:
        await client.validate("Patient", {**PATIENT, "id": "hmn-p-0001"})
    assert raised.value.message == "Patient.name: minimum required = 1"
    assert [r.url.path for r in script.fhir] == ["/fhir/Patient/$validate"] * 2
    await client.aclose()


async def test_delete_and_read():
    script = Script(httpx.Response(204), outcome(409, "There are other resources referencing this resource"),
                    httpx.Response(200, json={**PATIENT, "id": "7001"}), outcome(404, "Resource not found"))
    client = client_on(script)
    await client.delete("Patient", "7001")
    with pytest.raises(TresError) as raised:
        await client.delete("Patient", "7002")
    assert (raised.value.status, raised.value.message) == (
        409, "There are other resources referencing this resource")
    assert (await client.read("Patient", "7001"))["id"] == "7001"
    assert await client.read("Patient", "7002") is None
    assert [(r.method, r.url.path) for r in script.fhir] == [
        ("DELETE", "/fhir/Patient/7001"), ("DELETE", "/fhir/Patient/7002"),
        ("GET", "/fhir/Patient/7001"), ("GET", "/fhir/Patient/7002")]
    await client.aclose()


# ---------------------------------------------------------------- the three error shapes (§4.5)
@pytest.mark.parametrize("body, words", [
    ({"resourceType": "OperationOutcome", "issue": [{"severity": "error", "diagnostics": "Resource ID mismatch"}]},
     "Resource ID mismatch"),
    ({"resourceType": "OperationOutcome", "issue": [{"details": {"text": {"value": "Non-existent reference"}}}]},
     "Non-existent reference"),
    ({"resourceType": "OperationOutcome", "issue": [{"details": {"text": "Yanlış kod"}}]}, "Yanlış kod"),
    ({"error": "Bad request"}, "Bad request"),
    ({"message": "Daxili xəta"}, "Daxili xəta"),
    ({"issue": [{"diagnostics": "birinci"}, {"diagnostics": "ikinci"}]}, "birinci; ikinci"),
])
async def test_the_platforms_words_are_read_from_each_shape(body, words):
    assert read_error(json.dumps(body)) == words
    client = client_on(Script(httpx.Response(400, json=body)))
    with pytest.raises(TresError) as raised:
        await client.update("Patient", "7001", PATIENT)
    assert (raised.value.status, raised.value.message, raised.value.retry_after) == (400, words, None)
    await client.aclose()


def test_any_other_body_is_its_own_text_and_never_longer_than_500_characters():
    assert read_error("") == ""
    assert read_error("Bad Gateway") == "Bad Gateway"
    assert read_error("[1, 2]") == "[1, 2]"
    assert read_error(json.dumps({"issue": []})) == '{"issue": []}'
    assert len(read_error("x" * 2000)) == 500
    assert len(read_error(json.dumps({"message": "y" * 2000}))) == 500


# ---------------------------------------------------------------- 429 and no answer (D21)
@pytest.mark.parametrize("headers, expected", [
    ({"Retry-After": "120"}, 120.0), ({"Retry-After": " 2.5 "}, 2.5), ({}, None),
    ({"Retry-After": "Wed, 11 Nov 2026 10:00:00 GMT"}, None), ({"Retry-After": "-5"}, None),
])
async def test_a_429_is_not_retried_and_carries_what_retry_after_said(headers, expected):
    script = Script(httpx.Response(429, headers=headers, json={"message": "Too many requests"}))
    client = client_on(script)
    with pytest.raises(TresError) as raised:
        await client.find("Patient", "hmn-p-0001")
    assert (raised.value.status, raised.value.retry_after) == (429, expected)
    assert len(script.fhir) == 1
    await client.aclose()


async def test_a_failure_with_no_answer_is_an_error_named_by_its_class_never_by_the_address():
    def refuse(request):
        raise httpx.ConnectError("connection refused to https://tres.test/fhir/Patient", request=request)

    client = TresClient(ACCOUNT, transport=httpx.MockTransport(refuse))
    with pytest.raises(TresError) as raised:
        await client.token()
    assert (raised.value.status, raised.value.message) == (None, "ConnectError")
    # No answer is not a refusal of the session: it counts towards the round's five in a row.
    assert not isinstance(raised.value, TresSessionError) and is_outage(raised.value)
    await client.aclose()


@pytest.mark.parametrize("error, outage", [
    # the platform's state or the line's: the row is left as it was
    (TresError(None, "ConnectError"), True), (TresError(None, "TimeoutError"), True),
    (TresError(429, "Too many"), True), (TresError(408, "x"), True), (TresError(301, "x"), True),
    (TresError(302, "x"), True), (TresError(307, "x"), True), (TresError(502, "x"), True),
    (TresError(503, "x"), True), (TresError(504, "x"), True), (TresSessionError(401, "x"), True),
    (TresSessionError(500, "x"), True), (TresSessionError(200, "x"), True),
    # about the resource sent — a 5xx the platform answers for this input among them (review I2)
    (TresError(500, "x"), False), (TresError(501, "x"), False), (TresError(505, "x"), False),
    (TresError(400, "x"), False), (TresError(403, "x"), False), (TresError(404, "x"), False),
    (TresError(409, "x"), False), (TresError(422, "x"), False),
    (TresError(200, "Patient.name: minimum required = 1"), False),
    (TresSearchUnclear(200, "the search answer has a next page"), False),
])
def test_an_outage_is_the_platforms_or_the_lines_and_a_refusal_is_one_resources(error, outage):
    assert is_outage(error) is outage


async def _never(request: httpx.Request) -> httpx.Response:
    await asyncio.Event().wait()                     # a platform that takes the request and never answers


@pytest.mark.parametrize("token_answers", [False, True], ids=["token-never-answers", "fhir-never-answers"])
async def test_a_call_that_never_answers_ends_at_the_deadline_as_no_answer(token_answers):
    async def platform(request: httpx.Request) -> httpx.Response:
        if token_answers and request.url.path == "/auth/token":
            return httpx.Response(200, json={"payload": {"sessionId": "S-1"}})
        return await _never(request)

    client = TresClient(ACCOUNT, transport=httpx.MockTransport(platform), deadline_s=0.05)
    started = asyncio.get_running_loop().time()
    with pytest.raises(TresError) as raised:
        await client.find("Patient", "hmn-p-0001")
    assert asyncio.get_running_loop().time() - started < 5
    assert (raised.value.status, raised.value.message) == (None, "TimeoutError")
    assert not isinstance(raised.value, TresSessionError) and is_outage(raised.value)
    await client.aclose()


def test_every_call_has_an_overall_deadline_by_default():
    assert CALL_DEADLINE_S == 60.0 and TresClient(ACCOUNT).deadline_s == CALL_DEADLINE_S


# ---------------------------------------------------------------- the spacing hook, and the end
async def test_the_pace_hook_is_awaited_before_every_request_the_tokens_included():
    script = Script(searchset(), searchset())
    client = client_on(script)
    waits = []

    async def pace():
        waits.append(len(script.calls))

    client.pace = pace
    await client.find("Patient", "a")
    await client.find("Patient", "b")
    assert waits == [0, 1, 2] and client.requests == 3
    await client.aclose()


async def test_closing_forgets_the_session_and_may_be_done_twice():
    script = Script(httpx.Response(200, json={"entry": []}))
    client = client_on(script)
    await client.token()
    await client.aclose()
    await client.aclose()
    assert client._client is None and client._session is None
