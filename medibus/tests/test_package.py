def test_package_and_engine_modules_import():
    import medibus  # noqa: F401
    from homunculus.canonical import Observation, SignalCode  # noqa: F401
    from homunculus.edge.serialize import observation_to_fhir  # noqa: F401
