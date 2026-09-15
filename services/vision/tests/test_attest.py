import tempfile
import unittest

from eth_keys import keys

from scry_vision.attest import Ledger, allowed_spread, digest, objection, rule_hash, sign

KEY = "0x" + "00" * 31 + "01"
ADDRESS = "0x7E5F4552091A69125d5DfCb7b8C2659029395Bdf"
MARKET = "stream-fresno-1789421592"
ENDS = 1789422312


def settlement(value=164, winner="yes", threshold=150, **changes):
    body = {
        "marketId": MARKET,
        "chainId": 84532,
        "contractAddress": "0x" + "22" * 20,
        "resolver": "0x" + "33" * 20,
        "observedValue": value,
        "winningOutcomeId": winner,
        "evidenceRoot": "",
        "ruleHash": rule_hash(MARKET, threshold, ENDS),
        "observedAt": ENDS,
        "outcomes": [
            {"id": "yes", "minimum": threshold + 1, "maximum": None},
            {"id": "no", "minimum": None, "maximum": threshold},
        ],
    }
    body.update(changes)
    return body


class ToleranceTest(unittest.TestCase):
    def test_it_reads_the_bar_the_way_the_engine_does(self):
        self.assertEqual([allowed_spread(n) for n in (0, 5, 10, 11, 15, 164)], [2, 2, 2, 3, 3, 33])


class ObjectionTest(unittest.TestCase):
    def test_a_result_this_count_supports_is_signed(self):
        self.assertIsNone(objection(settlement(value=164), 150))

    def test_nothing_is_signed_without_a_count_of_the_window(self):
        self.assertIn("no clean count", objection(settlement(), None))

    def test_a_count_outside_the_tolerance_is_refused(self):
        self.assertIn("counted 100", objection(settlement(value=164), 100))

    def test_outcomes_the_market_did_not_commit_to_are_refused(self):
        moved = settlement(value=164)
        moved["outcomes"] = [{"id": "yes", "minimum": 101, "maximum": None},
                             {"id": "no", "minimum": None, "maximum": 100}]
        self.assertIn("committed", objection(moved, 164))

    def test_the_wrong_winner_is_refused(self):
        self.assertIn("is yes, not no", objection(settlement(value=164, winner="no"), 164))

    def test_a_market_of_another_shape_is_refused(self):
        odd = settlement()
        odd["outcomes"] = odd["outcomes"] + [{"id": "maybe", "minimum": None, "maximum": None}]
        self.assertIn("threshold market", objection(odd, 164))


class SignatureTest(unittest.TestCase):
    def test_it_signs_the_digest_itself_with_a_v_the_resolver_accepts(self):
        message = digest(settlement())
        signature = bytes.fromhex(sign(KEY, message)[2:])
        self.assertIn(signature[64], (27, 28))
        recovered = keys.Signature(signature[:64] + bytes([signature[64] - 27])) \
            .recover_public_key_from_msg_hash(message)
        self.assertEqual(recovered.to_checksum_address(), ADDRESS)

    def test_a_digest_names_its_chain_resolver_and_count(self):
        base = digest(settlement())
        self.assertNotEqual(base, digest(settlement(chainId=137)))
        self.assertNotEqual(base, digest(settlement(resolver="0x" + "44" * 20)))
        self.assertNotEqual(base, digest(settlement(observedValue=165)))


class LedgerTest(unittest.TestCase):
    def test_a_count_survives_a_restart_and_old_ones_are_dropped(self):
        with tempfile.TemporaryDirectory() as directory:
            Ledger.for_observer("vision-01", directory).record("old", 3, now=0)
            later = Ledger.for_observer("vision-01", directory)
            later.record("market-1", 164, now=3 * 24 * 3600)
            self.assertEqual(later.count("market-1"), 164)
            self.assertIsNone(later.count("old"))
            self.assertIsNone(later.count("never-counted"))


class ResolverDigestTest(unittest.TestCase):
    # Read back from ObservationResolver.digest on a local deployment at chain
    # 31337. abi_test.go in the API pins the same value.
    def test_it_is_the_digest_the_resolver_computes(self):
        body = {"marketId": "market-1", "chainId": 31337,
                "resolver": "0x9fe46736679d2d9a65f0992f2272de9f3c7fa6e0",
                "observedValue": 164, "winningOutcomeId": "yes", "evidenceRoot": "",
                "ruleHash": "0x" + "ab" * 32, "observedAt": 1789422312}
        self.assertEqual(digest(body).hex(), "c523333bb075065df99e3e7ba40aa44c6da5fc216a63647aaf334e28de5a27b6")
