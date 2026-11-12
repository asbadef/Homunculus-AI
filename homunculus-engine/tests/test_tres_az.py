# homunculus-engine/tests/test_tres_az.py
"""TRƏS-01 (spec D20): a person's values in the platform's form, or the catalogue's reason they are
not — FİN, name, sex, phone, birth date. No database; every value synthetic."""
from __future__ import annotations

import pytest

from homunculus.tres import az


@pytest.mark.parametrize("typed, expected", [
    ("AB12C3D", ("AB12C3D", None)),
    ("  ab12c3d ", ("AB12C3D", None)),                       # trimmed and upper-cased
    ("0000001", ("0000001", None)),
    (None, (None, "fin_missing")), ("", (None, "fin_missing")), ("   ", (None, "fin_missing")),
    ("AB12C3", (None, "fin_format")), ("AB12C3DE", (None, "fin_format")),
    ("AB 12C3D", (None, "fin_format")), ("ƏB12C3D", (None, "fin_format")),   # never transliterated
    ("AB-12C3", (None, "fin_format")),
])
def test_the_fin_is_seven_latin_capitals_or_digits(typed, expected):
    assert az.normal_fin(typed) == expected


@pytest.mark.parametrize("typed", [
    "ß123456",      # str.upper() would make it «SS123456»-shaped: ß → SS
    "ß12345",       # …and «SS12345», seven characters: an invented FİN
    "ﬀ12345",       # the ff ligature → FF
    "ſ123456",      # the long s → S
    "ı123456",      # the dotless i → I
    "AB12C3Ｄ",  # a full-width D
])
def test_a_fin_that_is_not_ascii_is_refused_before_it_is_upper_cased(typed):
    """D20 forbids transliteration: `str.upper()` maps ß to SS, ﬀ to FF, ſ to S and ı to I, which is
    one — so the value is judged as typed, and any character outside ASCII is `fin_format`."""
    assert az.normal_fin(typed) == (None, "fin_format")


@pytest.mark.parametrize("typed, expected", [
    ("Sentetik Ayşe", (("Sentetik", ["Ayşe"]), None)),
    ("  Sentetikova   Leyla  Nur ", (("Sentetikova", ["Leyla", "Nur"]), None)),
    ("Sentetik", (None, "name_single")), ("", (None, "name_single")), (None, (None, "name_single")),
])
def test_the_name_is_family_first_then_the_given_names(typed, expected):
    assert az.split_name(typed) == expected


@pytest.mark.parametrize("sex, expected", [
    ("male", ("K", None)), ("female", ("Q", None)), (" Female ", ("Q", None)),
    ("other", (None, "sex_unmapped")), ("unknown", (None, "sex_unmapped")), (None, (None, "sex_unmapped")),
])
def test_sex_has_the_platforms_two_codes_only(sex, expected):
    assert az.sex_code(sex) == expected


@pytest.mark.parametrize("typed, expected", [
    ("+994501234567", "+994501234567"), ("994501234567", "+994501234567"),
    ("050 123 45 67", "+994501234567"), ("(050) 123-45-67", "+994501234567"), ("501234567", "+994501234567"),
    ("+90 532 123 45 67", None), ("12345", None), ("", None), (None, None), ("05012345678", None),
    # only ASCII digits: Arabic-Indic, Persian and full-width digits are `\d` to Python, not to the platform
    ("+٩٩٤٥٠١٢٣٤٥٦٧", None), ("٠٥٠١٢٣٤٥٦٧", None), ("۰۵۰۱۲۳۴۵۶۷", None), ("+994５０１２３４５６７", None),
    ("+99450123456٧", None),
    # batch-3 review (B): a national number never begins with the trunk prefix 0 — a domestic number
    # missing a digit («050 123 456», nine characters) must not go as «+994050123456», in any form
    ("050123456", None), ("050 123 456", None), ("+994050123456", None), ("994050123456", None),
    ("0050123456", None),
])
def test_a_phone_is_plus_994_and_nine_digits_or_not_sent(typed, expected):
    assert az.phone(typed) == expected


def test_the_birth_date_is_a_date_or_its_reason():
    assert az.birth_date("1980-01-31") == ("1980-01-31", None)
    for bad in (None, "", "31.01.1980", "1980-02-30"):
        assert az.birth_date(bad) == (None, "birth_date_invalid"), bad
