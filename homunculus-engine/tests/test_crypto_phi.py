"""PHI encryption roundtrip (§5.2 PHI rule). No DB required."""
from homunculus.crypto import decrypt_phi, encrypt_phi


def test_encrypt_roundtrip_unicode():
    plaintext = "Ayşe Öztürk"
    ct = encrypt_phi(plaintext)
    assert ct != plaintext
    assert ct.startswith("enc::v1::")
    assert decrypt_phi(ct) == plaintext


def test_encrypt_none_passthrough():
    assert encrypt_phi(None) is None
    assert decrypt_phi(None) is None


def test_ciphertext_is_not_plaintext_substring():
    plaintext = "1990-05-14"
    ct = encrypt_phi(plaintext)
    assert plaintext not in ct


def test_legacy_plaintext_is_returned_asis():
    # A value stored before encryption was enabled (no prefix) is returned verbatim.
    assert decrypt_phi("plain-legacy-value") == "plain-legacy-value"
