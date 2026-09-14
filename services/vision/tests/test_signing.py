import unittest

from eth_hash.auto import keccak
from eth_keys import keys

from scry_vision.signing import message_for, sign_report

KEY = "0x" + "00" * 31 + "01"
ADDRESS = "0x7E5F4552091A69125d5DfCb7b8C2659029395Bdf"

# services/api-go/internal/httpapi/observations_test.go verifies this exact
# body and signature, so the two languages cannot drift apart on the message.
BODY = (b'{"observerId": "vision-01", "role": "primary_vision", "observedValue": 42, '
        b'"confidence": 0.9, "modelVersion": "yolov8s-bytetrack/1.0-primary", "uptime": 0.97, '
        b'"maximumTimestampDriftMs": 0.0, "averageVisibility": 1.0, "longestFrozenSeconds": 0.0, '
        b'"invalidReasons": []}')
SIGNATURE = ("0x1631e2133f984a9a20f1f9b5b6e4d6c18334945292b974612d12029e23d0519e"
             "35d78a77316a16f3ada5eaeaea468cee1c8a198ace894b734ddf6e9045fac15e01")


def signer(market: str, body: bytes, signature: str) -> str:
    message = message_for(market, body)
    digest = keccak(b"\x19Ethereum Signed Message:\n" + str(len(message)).encode() + message)
    recovered = keys.Signature(bytes.fromhex(signature[2:])).recover_public_key_from_msg_hash(digest)
    return recovered.to_checksum_address()


class SignedReportTest(unittest.TestCase):
    def test_the_signature_names_the_observer_key(self):
        self.assertEqual(signer("market-1", BODY, sign_report(KEY, "market-1", BODY)), ADDRESS)

    def test_it_matches_the_signature_the_api_is_tested_against(self):
        self.assertEqual(sign_report(KEY, "market-1", BODY), SIGNATURE)

    def test_a_changed_count_no_longer_names_the_observer(self):
        signature = sign_report(KEY, "market-1", BODY)
        altered = BODY.replace(b'"observedValue": 42', b'"observedValue": 420')
        self.assertNotEqual(signer("market-1", altered, signature), ADDRESS)

    def test_a_signature_for_one_market_does_not_name_the_observer_on_another(self):
        self.assertNotEqual(signer("market-2", BODY, sign_report(KEY, "market-1", BODY)), ADDRESS)
