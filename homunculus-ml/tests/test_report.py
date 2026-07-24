# tests/test_report.py
from homunculus_ml.report import render_report


def test_report_states_setting_and_metrics_and_caveat():
    text = render_report(
        data_dir="/local/physionet",
        n_patients=40336, n_hours=1552210,
        splits={"train": 28000, "val": 6000, "test": 6336},
        test_metrics={"auroc": 0.79, "brier": 0.05, "prevalence": 0.018},
        ablation={"auroc_delta": 0.06},
    )
    assert "AUROC" in text and "0.79" in text
    assert "generalis" in text.lower() or "setting" in text.lower()   # the caveat is present
    assert "ablation" in text.lower()
    assert "/local/physionet" in text   # provenance of the (out-of-repo) data
