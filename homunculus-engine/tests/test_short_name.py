# homunculus-engine/tests/test_short_name.py
"""The one form a bed screen names its patient by (G2-B3a, D3, R7). The ward writes the surname
first («Soyad Ad Ata adı», the user, 2026-11-09), so the screen shows the SECOND word in full and
the FIRST word's initial: "Əli M.". Never more than one word and one initial. No database;
synthetic names only."""
from __future__ import annotations

import pytest

from homunculus.tenant.shortname import short_name


@pytest.mark.parametrize(("name", "short"), [
    ("Məmmədov Əli Rauf oğlu", "Əli M."),
    ("Kaya Ayşe", "Ayşe K."),
    ("  İsmayılov   İlkin  ", "İlkin İ."),      # spaces around and between; dotted capital kept
    ("ışık Ömer", "Ömer ı."),                   # case is kept, never folded
    ("Sentetik", "Sentetik"),                   # one word: shown as it is
    ("", None),
    ("   ", None),
    (None, None),
])
def test_the_second_word_and_the_first_words_initial(name, short):
    assert short_name(name) == short


def test_it_never_carries_more_than_one_word_and_one_initial():
    assert short_name("Sentetik Hasta Üçüncü Dördüncü").split(" ") == ["Hasta", "S."]
