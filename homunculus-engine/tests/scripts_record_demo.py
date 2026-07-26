import importlib.util, pathlib
_spec = importlib.util.spec_from_file_location(
    "record_demo", pathlib.Path(__file__).resolve().parents[1] / "scripts" / "record_demo.py")
record_demo = importlib.util.module_from_spec(_spec); _spec.loader.exec_module(record_demo)
record = record_demo.record
