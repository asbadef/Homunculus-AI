# homunculus-engine/tests/test_fake_tres.py
"""The stand-in itself (tests/fake_tres.py, spec §9): each rule of spec §4 it enforces is proved
here through the real client, so a test that passes against it passed against those rules. No
network, no database. Synthetic account, synthetic people."""
from __future__ import annotations

import httpx
import pytest

from homunculus.tres.client import LOCAL_ID_EXTENSION, TresAccount, TresClient, TresError
from tests.fake_tres import (
    BASE_URL, ID_MISMATCH, LOCAL_ID_CHANGED, MALFORMED_REFERENCE, NO_ID, NO_REFERENCE, REFERRED, UNCHECKED_PROFILE,
    FakeTres, local_id_of, references_of,
)

def resource(resource_type: str, local_id: str, **elements) -> dict:
    return {"resourceType": resource_type, "meta": {"profile": [UNCHECKED_PROFILE]},
            "extension": [{"url": LOCAL_ID_EXTENSION, "valueString": local_id}], **elements}


def patient(local_id: str = "hmn-p-0001") -> dict:
    return resource("Patient", local_id, name=[{"family": "Sentetik", "given": ["Ayşe"]}])


@pytest.fixture
async def platform():
    fake = FakeTres()
    client = TresClient(fake.account, transport=fake.transport)
    yield fake, client
    await client.aclose()


async def raw(fake: FakeTres, method: str, path: str, **kwargs) -> httpx.Response:
    """A request the client would never make (no `id`, a wrong `id`, another search), with a session."""
    async with httpx.AsyncClient(transport=fake.transport, base_url=BASE_URL) as http:
        token = TresClient(fake.account, transport=fake.transport)
        session = await token.token()
        await token.aclose()
        return await http.request(method, path, headers={"Authorization": f"Bearer {session}"}, **kwargs)


def said(response: httpx.Response) -> str:
    return response.json()["issue"][0]["diagnostics"]


# ---------------------------------------------------------------- the session
async def test_one_account_opens_a_session_and_any_other_is_refused(platform):
    fake, client = platform
    assert (await client.token()).startswith("session-")
    for wrong in (TresAccount(BASE_URL, "sentetik", "yanlis", "PRV-0001"),
                  TresAccount(BASE_URL, "baskasi", "gizli-parola", "PRV-0001"),
                  TresAccount(BASE_URL, "sentetik", "gizli-parola", "PRV-9999")):
        other = TresClient(wrong, transport=fake.transport)
        with pytest.raises(TresError) as raised:
            await other.token()
        assert (raised.value.status, raised.value.message) == (401, "Invalid credentials")
        await other.aclose()


async def test_a_fhir_request_without_an_open_session_is_a_401(platform):
    fake, _ = platform
    async with httpx.AsyncClient(transport=fake.transport, base_url=BASE_URL) as http:
        assert (await http.get("/fhir/Patient", params={"local-system-unique-id": "x"})).status_code == 401
        bad = {"Authorization": "Bearer session-999"}
        assert (await http.get("/fhir/Patient", params={"local-system-unique-id": "x"}, headers=bad)).status_code == 401


async def test_an_expired_session_is_replaced_by_the_client_without_the_caller_knowing(platform):
    fake, client = platform
    assert await client.find("Patient", "hmn-p-0001") is None
    fake.expire_session()
    assert await client.find("Patient", "hmn-p-0001") is None
    assert fake.requests == [("POST", "/auth/token"), ("GET", "/fhir/Patient"),
                             ("GET", "/fhir/Patient"), ("POST", "/auth/token"), ("GET", "/fhir/Patient")]


async def test_throttle_answers_429_for_the_next_n_requests_with_retry_after(platform):
    fake, client = platform
    fake.throttle(2, retry_after=120)
    for _ in range(2):
        with pytest.raises(TresError) as raised:
            await client.find("Patient", "hmn-p-0001")
        assert (raised.value.status, raised.value.retry_after) == (429, 120.0)
    assert await client.find("Patient", "hmn-p-0001") is None
    fake.throttle(1)
    with pytest.raises(TresError) as raised:
        await client.find("Patient", "hmn-p-0001")
    assert (raised.value.status, raised.value.retry_after) == (429, None)


# ---------------------------------------------------------------- writing (§4.2)
async def test_create_stores_under_a_server_id_and_find_answers_it(platform):
    fake, client = platform
    remote = await client.create("Patient", {**patient(), "id": "hmn-p-0001"})
    assert remote != "hmn-p-0001" and remote.isdigit()
    assert await client.find("Patient", "hmn-p-0001") == remote
    assert await client.find("Patient", "hmn-p-0002") is None
    assert await client.find("Practitioner", "hmn-p-0001") is None       # the id space is per type
    assert (await client.read("Patient", remote))["name"][0]["family"] == "Sentetik"
    assert fake.stored("Patient")[0]["id"] == remote


async def test_a_post_without_an_id_is_refused(platform):
    fake, _ = platform
    response = await raw(fake, "POST", "/fhir/Patient", json=patient())
    assert (response.status_code, said(response)) == (400, NO_ID)
    assert fake.stored("Patient") == []


async def test_a_put_whose_body_id_is_not_the_urls_is_refused(platform):
    fake, client = platform
    remote = await client.create("Patient", {**patient(), "id": "hmn-p-0001"})
    response = await raw(fake, "PUT", f"/fhir/Patient/{remote}", json={**patient(), "id": "hmn-p-0001"})
    assert (response.status_code, said(response)) == (400, ID_MISMATCH)
    await client.update("Patient", remote, {**patient(), "active": True})
    assert fake.resources["Patient"][remote]["active"] is True
    with pytest.raises(TresError) as raised:
        await client.update("Patient", "9999", patient())
    assert raised.value.status == 404


async def test_a_resource_without_a_profile_or_without_the_local_id_extension_is_refused(platform):
    fake, client = platform
    bare = {**patient(), "id": "hmn-p-0001"}
    for broken in ({k: v for k, v in bare.items() if k != "meta"}, {**bare, "meta": {"profile": []}},
                   {k: v for k, v in bare.items() if k != "extension"},
                   {**bare, "extension": [{"url": "http://example.org/other", "valueString": "x"}]}):
        with pytest.raises(TresError) as raised:
            await client.create("Patient", broken)
        assert raised.value.status == 400
    assert fake.stored("Patient") == []


async def test_only_the_local_id_search_exists(platform):
    fake, _ = platform
    for params in ({"name": "Sentetik"}, {}, {"local-system-unique-id": "x", "name": "y"}):
        response = await raw(fake, "GET", "/fhir/Patient", params=params)
        assert response.status_code == 400, params


async def test_the_search_answers_a_page_at_a_time_with_its_total_and_a_next_link():
    assert FakeTres().page_size == 20
    fake = FakeTres(page_size=3)
    client = TresClient(fake.account, transport=fake.transport)
    for local_id in ("hmn-p-1", "hmn-p-10", "hmn-p-11", "hmn-p-12"):
        await client.create("Patient", {**patient(local_id), "id": local_id})
    paged = (await raw(fake, "GET", "/fhir/Patient", params={"local-system-unique-id": "hmn-p-1"})).json()
    assert (paged["type"], paged["total"], len(paged["entry"])) == ("searchset", 4, 3)
    assert [link["relation"] for link in paged["link"]] == ["self", "next"]
    whole = (await raw(fake, "GET", "/fhir/Patient", params={"local-system-unique-id": "hmn-p-12"})).json()
    assert (whole["total"], len(whole["entry"]), [link["relation"] for link in whole["link"]]) == (1, 1, ["self"])
    await client.aclose()


async def test_the_search_is_a_fhir_string_search_case_insensitive_and_by_prefix(platform):
    """Review #3: a FHIR `string` parameter matches what STARTS with the value, in any case — so the
    search alone cannot tell `hmn-l-12` from `hmn-l-120`; the client must."""
    fake, client = platform
    for local_id in ("hmn-l-120", "hmn-l-12", "HMN-L-1200"):
        await client.create("Observation", {**resource("Observation", local_id), "id": local_id})
    response = await raw(fake, "GET", "/fhir/Observation", params={"local-system-unique-id": "hmn-l-12"})
    hits = [local_id_of(entry["resource"]) for entry in response.json()["entry"]]
    assert sorted(hits) == ["HMN-L-1200", "hmn-l-12", "hmn-l-120"]
    response = await raw(fake, "GET", "/fhir/Observation", params={"local-system-unique-id": "hmn-l-121"})
    assert response.json()["entry"] == []


# ---------------------------------------------------------------- references (§4.2, §4.3)
async def test_a_reference_to_a_resource_the_server_does_not_hold_is_refused(platform):
    fake, client = platform
    encounter = resource("Encounter", "hmn-e-0001", subject={"reference": "Patient/7001"},
                         serviceProvider={"reference": "Organization/ORG-1"})
    with pytest.raises(TresError) as raised:
        await client.create("Encounter", {**encounter, "id": "hmn-e-0001"})
    assert (raised.value.status, raised.value.message) == (409, NO_REFERENCE)
    remote = await client.create("Patient", {**patient(), "id": "hmn-p-0001"})
    assert remote == "7001"
    with pytest.raises(TresError):                       # the Organization is still missing
        await client.create("Encounter", {**encounter, "id": "hmn-e-0001"})
    fake.seed("Organization", "ORG-1", {"name": "Sentetik Hastane"})
    assert await client.create("Encounter", {**encounter, "id": "hmn-e-0001"}) == "7002"


async def test_a_referred_resource_is_not_deleted_until_what_refers_to_it_is_gone(platform):
    fake, client = platform
    patient_id = await client.create("Patient", {**patient(), "id": "hmn-p-0001"})
    encounter = resource("Encounter", "hmn-e-0001", subject={"reference": f"Patient/{patient_id}"})
    encounter_id = await client.create("Encounter", {**encounter, "id": "hmn-e-0001"})
    with pytest.raises(TresError) as raised:
        await client.delete("Patient", patient_id)
    assert (raised.value.status, raised.value.message) == (409, REFERRED)
    await client.delete("Encounter", encounter_id)
    await client.delete("Patient", patient_id)
    assert fake.stored("Patient") == [] and fake.stored("Encounter") == []
    with pytest.raises(TresError) as raised:
        await client.delete("Patient", patient_id)
    assert raised.value.status == 404


async def test_a_malformed_reference_is_refused(platform):
    fake, client = platform
    remote = await client.create("Patient", {**patient(), "id": "hmn-p-0001"})
    for reference in ("Patient/", "Patient", f"/Patient/{remote}", f"Patient/{remote}/_history/1", "#p1",
                      f"patient /{remote}", ""):
        encounter = resource("Encounter", "hmn-e-0001", subject={"reference": reference})
        with pytest.raises(TresError) as raised:
            await client.create("Encounter", {**encounter, "id": "hmn-e-0001"})
        assert (raised.value.status, raised.value.message) == (400, MALFORMED_REFERENCE), reference
        with pytest.raises(TresError) as raised:
            await client.validate("Encounter", {**encounter, "id": "hmn-e-0001"})
        assert raised.value.status == 400, reference
    assert fake.stored("Encounter") == []


async def test_a_put_that_would_change_the_local_id_is_refused(platform):
    fake, client = platform
    remote = await client.create("Patient", {**patient("hmn-p-0001"), "id": "hmn-p-0001"})
    with pytest.raises(TresError) as raised:
        await client.update("Patient", remote, patient("hmn-p-0002"))
    assert (raised.value.status, raised.value.message) == (400, LOCAL_ID_CHANGED)
    assert local_id_of(fake.resources["Patient"][remote]) == "hmn-p-0001"
    await client.update("Patient", remote, {**patient("hmn-p-0001"), "active": True})
    assert fake.resources["Patient"][remote]["active"] is True


# ---------------------------------------------------------------- validate
async def test_validate_runs_the_same_checks_and_stores_nothing(platform):
    fake, client = platform
    await client.validate("Patient", {**patient(), "id": "hmn-p-0001"})
    with pytest.raises(TresError) as raised:
        await client.validate("Encounter", {**resource("Encounter", "hmn-e-0001",
                                                       subject={"reference": "Patient/1"}), "id": "hmn-e-0001"})
    assert (raised.value.status, raised.value.message) == (409, NO_REFERENCE)
    response = await raw(fake, "POST", "/fhir/Patient/$validate", json=patient())
    assert (response.status_code, said(response)) == (400, NO_ID)
    assert fake.resources == {}


# ---------------------------------------------------------------- the helpers and the record
def test_the_helpers_read_the_local_id_and_every_reference():
    assert local_id_of(patient("hmn-p-0009")) == "hmn-p-0009"
    assert local_id_of({"extension": [{"url": "http://example.org/other", "valueString": "x"}]}) is None
    assert local_id_of({}) is None
    nested = {"subject": {"reference": "Patient/1"}, "participant": [{"individual": {"reference": "Practitioner/2"}}],
              "text": {"reference": "not a reference"}, "contained": [{"reference": "#local"}]}
    assert references_of(nested) == {"Patient/1", "Practitioner/2"}


async def test_every_request_is_kept_as_method_and_path(platform):
    fake, client = platform
    remote = await client.create("Patient", {**patient(), "id": "hmn-p-0001"})
    await client.validate("Patient", {**patient(), "id": "hmn-p-0001"})
    assert fake.requests == [("POST", "/auth/token"), ("POST", "/fhir/Patient"),
                             ("POST", "/fhir/Patient/$validate")]
    assert fake.fhir_requests == fake.requests[1:]
    assert remote == "7001"


# ---------------------------------------------------------------- the profiles of phase F1 (plan F1, N6)
def _f1_resources():
    """Phase F1's four resources as its mappers build them (tests/test_tres_mapping.py's stay)."""
    from homunculus.tres.mapping.encounter import encounter
    from homunculus.tres.mapping.patient import patient as map_patient
    from homunculus.tres.mapping.practitioner import practitioner
    from homunculus.tres.mapping.vitals import vitals
    from tests.test_tres_mapping import PERSON, ROOT, stay
    built = stay()
    return (map_patient(PERSON, ROOT), practitioner(built.clinicians[0]),
            encounter(built, patient_id="7001", practitioner_ids=["7002"], organization_id="ORG-0001"),
            vitals(built, patient_id="7001", encounter_id="7003")[0])


def _without(resource: dict, path: str) -> dict:
    """A deep copy of `resource` with every value at `path` (REQUIRED's syntax) emptied."""
    import copy
    from tests.fake_tres import steps
    copied = copy.deepcopy(resource)
    *walk, (last, _) = steps(path)
    nodes = [copied]
    for name, selector in walk:
        nodes = [x for node in nodes if isinstance(node, dict)
                 for x in (node.get(name) if isinstance(node.get(name), list) else [node.get(name)])]
        if selector is not None:
            nodes = [x for x in nodes if isinstance(x, dict) and selector in (x.get("url"), x.get("system"))]
    for node in nodes:
        if isinstance(node, dict):
            node.pop(last, None)
    return copied


async def test_phase_f1s_resources_are_taken_and_each_required_element_is_held(platform):
    from tests.fake_tres import REQUIRED
    fake, client = platform
    fake.seed("Patient", "7001")
    fake.seed("Practitioner", "7002")
    fake.seed("Encounter", "7003")
    fake.seed("Organization", "ORG-0001")
    resources = _f1_resources()
    assert {r.resource["meta"]["profile"][0] for r in resources} == set(REQUIRED)       # one test per profile
    for built in resources:
        await client.validate(built.fhir_type, {**built.resource, "id": built.local_id})
        for path in REQUIRED[built.resource["meta"]["profile"][0]]:
            with pytest.raises(TresError) as raised:
                await client.validate(built.fhir_type, {**_without(built.resource, path), "id": built.local_id})
            assert (raised.value.status, raised.value.message) == (
                400, f"{built.fhir_type}.{path}: minimum required = 1"), path


async def test_a_sex_code_the_platform_has_not_and_an_inactive_practitioner_are_refused(platform):
    from tests.fake_tres import ALLOWED
    _, client = platform
    patient_, practitioner_, _, _ = _f1_resources()
    other_sex = {**patient_.resource, "extension": [
        {**ext, "valueCode": "M"} if ext.get("valueCode") else ext for ext in patient_.resource["extension"]]}
    inactive = {**practitioner_.resource, "active": False}
    for built, body in ((patient_, other_sex), (practitioner_, inactive)):
        (path,) = ALLOWED[built.resource["meta"]["profile"][0]]
        with pytest.raises(TresError) as raised:
            await client.create(built.fhir_type, {**body, "id": built.local_id})
        assert (raised.value.status, raised.value.message) == (400, f"{built.fhir_type}.{path}: value not allowed")


def test_values_at_walks_lists_and_selects_by_url_or_system():
    from tests.fake_tres import values_at
    body = {"identifier": [{"system": "x", "value": "1"}, {"system": "http://fhir.az/sid/fin", "value": "AB12C3D"}],
            "name": [{"family": "S", "given": ["A", "B"]}], "extension": [{"url": "u", "valueCode": ""}]}
    assert values_at(body, "identifier(http://fhir.az/sid/fin).value") == ["AB12C3D"]
    assert values_at(body, "name.given") == ["A", "B"]
    assert values_at(body, "extension(u).valueCode") == [] and values_at(body, "missing.path") == []


async def test_a_profile_the_table_does_not_name_is_held_to_section_4_alone(platform):
    _, client = platform
    assert await client.create("Patient", {**patient(), "id": "hmn-p-0001"}) == "7001"   # UNCHECKED_PROFILE
