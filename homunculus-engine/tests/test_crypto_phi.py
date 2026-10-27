"""PHI encryption roundtrip (§5.2 PHI rule). No DB required."""
import hashlib

from homunculus.crypto import decrypt_phi, encrypt_phi, phi_digest


def test_a_phi_digest_is_stable_keyed_and_tells_texts_apart():
    """G2-B1a (A-19): what compares two sends of one admission form. Equal texts, equal digests;
    any change, another digest; and it is keyed — not the plain SHA-256 a reader of the database
    could recompute to check a guessed name against it."""
    text = '{"patient":{"display_name":"Sentetik Hasta"}}'
    digest = phi_digest(text)
    assert digest == phi_digest(text)
    assert len(digest) == 64 and int(digest, 16) >= 0
    assert digest != phi_digest(text.replace("Hasta", "Hastа"))     # a Cyrillic а
    assert digest != hashlib.sha256(text.encode("utf-8")).hexdigest()


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
