# homunculus-engine/tests/test_conftest_tables.py
"""`db_session` drops every table `Base.metadata` knows (A-22 I2). A table whose model no import had reached
yet was not dropped, so a killed run left `device_beds` behind and the next `drop_all` failed on `beds`
("constraint device_beds_bed_id_fkey depends on table beds"). `conftest.py` therefore imports every
`homunculus.*.models` module; this file says so. Run it ALONE to see what conftest by itself provides."""
from __future__ import annotations

import pkgutil
import sys

import pytest

import homunculus
from homunculus.db import Base
from tests.conftest import raise_on_package_error


def test_every_models_module_of_the_package_is_imported_by_conftest():
    models = sorted(m.name for m in pkgutil.walk_packages(homunculus.__path__, "homunculus.",
                                                          onerror=raise_on_package_error)
                    if m.name.rsplit(".", 1)[-1] == "models")
    assert models, "no models module found: the walk is broken"
    assert [name for name in models if name not in sys.modules] == []


def test_the_metadata_drop_all_works_from_knows_the_editors_table_and_the_scope_table():
    assert {"device_beds", "staff_scopes"} <= set(Base.metadata.tables)


@pytest.mark.parametrize("failure", [ImportError("gone"), RuntimeError("boom")])
def test_a_package_that_fails_to_import_fails_the_walk_instead_of_being_skipped(tmp_path, monkeypatch, failure):
    """`walk_packages` imports each package to look inside it and, with no `onerror`, passes over one that raises
    (an ImportError) — its models, and so its tables, would silently be missing from `drop_all`."""
    package = tmp_path / "esleme_broken_package"
    package.mkdir()
    (package / "__init__.py").write_text(f"raise {type(failure).__name__}({str(failure)!r})\n", encoding="utf-8")
    monkeypatch.syspath_prepend(str(tmp_path))
    if isinstance(failure, ImportError):                   # the silent skip this guards against
        assert [m.name for m in pkgutil.walk_packages([str(tmp_path)], "")] == ["esleme_broken_package"]
    with pytest.raises(ImportError, match="esleme_broken_package") as caught:
        list(pkgutil.walk_packages([str(tmp_path)], "", onerror=raise_on_package_error))
    assert caught.value.__cause__ is not None and str(failure) in str(caught.value.__cause__)
