"""Framing rules checked against the example byte strings in the Dräger MEDIBUS protocol
definition (Rev 6.00): every example there is reproduced here byte for byte."""
import pytest

from medibus.framing import (
    CAN, DC1, DC3, ESC, NAK, SOH, Control, Frame, StreamParser, checksum, encode_command,
    encode_response,
)

# Command / response codes used by the examples.
ICC, NOP, DEVICE_ID, DATA_CP1 = 0x51, 0x30, 0x52, 0x24


@pytest.mark.parametrize("data, expected", [
    (b"\x1b\x51", b"6C"),           # ICC command
    (b"\x01\x51", b"52"),           # ICC response
    (b"\x1b\x30", b"4B"),           # NOP command
    (b"\x1b\x52", b"6D"),           # device-ID request
    (b"\x1b\x24", b"3F"),           # request measured data cp1
    (b"\x01\x24", b"25"),           # empty data response
    (b"\x01\x15", b"16"),           # NAK response
    (b"\x01\x52", b"53"),           # empty device-ID response
])
def test_checksum_matches_spec_examples(data, expected):
    assert checksum(data) == expected


def test_checksum_is_low_byte_of_sum_in_uppercase_hex():
    # Spec example: the PC's device-ID response ends in 46H 43H ("FC"). Reproducing it pins the
    # exact field layout: NNNN'Name'DD.DD:MM.MM — no spaces, a colon between the revisions.
    body = b"\x01\x52" + b"0161'My PC'01.00:03.00"
    assert checksum(body) == b"FC"
    assert checksum(b"\xff\x01") == b"00"


def test_encode_command_and_response_reproduce_spec_bytes():
    assert encode_command(ICC) == b"\x1b\x51\x36\x43\x0d"
    assert encode_command(NOP) == b"\x1b\x30\x34\x42\x0d"
    assert encode_command(DATA_CP1) == b"\x1b\x24\x33\x46\x0d"
    assert encode_response(ICC) == b"\x01\x51\x35\x32\x0d"
    assert encode_response(DATA_CP1) == b"\x01\x24\x32\x35\x0d"
    assert encode_response(NAK) == b"\x01\x15\x31\x36\x0d"
    assert (encode_response(DEVICE_ID, b"0161'My PC'01.00:03.00")
            == b"\x01\x52" + b"0161'My PC'01.00:03.00" + b"\x46\x43\x0d")


def test_command_argument_limit_is_enforced():
    encode_command(0x6A, b"x" * 251)
    with pytest.raises(ValueError):
        encode_command(0x6A, b"x" * 252)


def test_parser_reads_a_command_and_a_response():
    parser = StreamParser()
    frames = parser.feed(b"\x1b\x51\x36\x43\x0d" + b"\x01\x24\x32\x35\x0d")
    assert frames == [
        Frame("command", ICC, b"", True),
        Frame("response", DATA_CP1, b"", True),
    ]


def test_parser_returns_measured_data_payload():
    payload = b"EB 98E1 70"
    frame_bytes = b"\x01\x24" + payload
    frame_bytes += checksum(frame_bytes) + b"\x0d"
    [frame] = StreamParser().feed(frame_bytes)
    assert frame.kind == "response" and frame.code == DATA_CP1
    assert frame.payload == payload and frame.checksum_ok


def test_parser_handles_frames_split_across_feeds():
    parser = StreamParser()
    assert parser.feed(b"\x1b\x51") == []
    assert parser.feed(b"\x36") == []
    assert parser.feed(b"\x43\x0d\x1b") == [Frame("command", ICC, b"", True)]
    assert parser.feed(b"\x30\x34\x42\x0d") == [Frame("command", NOP, b"", True)]


def test_parser_drops_bytes_before_the_first_frame():
    frames = StreamParser().feed(b"junk\x00\x1b\x51\x36\x43\x0d")
    assert frames == [Frame("command", ICC, b"", True)]


def test_parser_flags_bad_checksum():
    [frame] = StreamParser().feed(b"\x1b\x51\x36\x44\x0d")
    assert frame == Frame("command", ICC, b"", False)


def test_parser_extracts_a_command_embedded_inside_a_response():
    # The documented trap: the device-ID request arrives INSIDE the ICC response. Each frame
    # carries its own checksum; the embedded bytes do not count towards the outer one.
    outer = b"\x01\x51"
    embedded = b"\x1b\x52\x36\x44\x0d"
    stream = outer + embedded + checksum(outer) + b"\x0d"
    frames = StreamParser().feed(stream)
    assert frames == [
        Frame("command", DEVICE_ID, b"", True),
        Frame("response", ICC, b"", True),
    ]


def test_parser_ignores_realtime_bytes_everywhere():
    # Realtime records use bytes >= 80H and are ignored by the checksum calculation.
    stream = b"\x1b\xc6\xc0\x51\x36\x81\x43\x0d\x9a"
    assert StreamParser().feed(stream) == [Frame("command", ICC, b"", True)]


def test_parser_surfaces_flow_control_characters_between_frames():
    parser = StreamParser()
    frames = parser.feed(DC1 + DC3 + CAN + b"\x1b\x30\x34\x42\x0d")
    assert frames == [Control(0x11), Control(0x13), Control(0x18), Frame("command", NOP, b"", True)]


def test_parser_surfaces_flow_control_inside_a_frame_without_corrupting_it():
    parser = StreamParser()
    frames = parser.feed(b"\x1b\x30" + DC1 + b"\x34\x42\x0d")
    assert frames == [Control(0x11), Frame("command", NOP, b"", True)]


def test_control_byte_constants():
    assert (ESC, SOH, NAK, DC1, DC3, CAN) == (b"\x1b", b"\x01", 0x15, b"\x11", b"\x13", b"\x18")


def test_a_new_frame_start_abandons_an_unterminated_frame_of_the_same_kind():
    # A dropped CR must not glue two commands together into one corrupt frame forever.
    parser = StreamParser()
    frames = parser.feed(b"\x1b\x51\x36" + b"\x1b\x30\x34\x42\x0d")
    assert frames == [Frame("command", NOP, b"", True)]


def test_oversized_frame_is_discarded():
    parser = StreamParser()
    frames = parser.feed(b"\x01\x24" + b"A" * 4000 + b"\x0d" + b"\x1b\x30\x34\x42\x0d")
    assert frames == [Frame("command", NOP, b"", True)]
