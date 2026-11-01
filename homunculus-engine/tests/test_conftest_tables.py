# homunculus-engine/tests/test_conftest_tables.py
"""`db_session` drops every table `Base.metadata` knows (A-22 I2). A table whose model no import had reached
yet was not dropped, so a killed run left `device_beds` behind and the next `drop_all` failed on `beds`
("constraint device_beds_bed_id_fkey depends on table beds"). `conftest.py` therefore imports every
`homunculus.*.models` module; this file says so. Run it ALONE to see what conftest by itself provides."""
from __future__ import annotations

import pkgutil
import sys

import homunculus
from homunculus.db import Base


def test_every_models_module_of_the_package_is_imported_by_conftest():
    models = sorted(m.name for m in pkgutil.walk_packages(homunculus.__path__, "homunculus.")
                    if m.name.rsplit(".", 1)[-1] == "models")
    assert models, "no models module found: the walk is broken"
    assert [name for name in models if name not in sys.modules] == []


def test_the_metadata_drop_all_works_from_knows_the_editors_table_and_the_scope_table():
    assert {"device_beds", "staff_scopes"} <= set(Base.metadata.tables)
