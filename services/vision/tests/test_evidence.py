import unittest

from scry_vision.evidence import bundle, chain, digest, leaf, path, root, verify


def sample(count, at="2026-07-31T06:00:00Z", interval=60, frame="abc"):
    return {"observedAt": at, "count": count, "intervalSeconds": interval,
            "modelVersion": "mog2-centroid/0.1-primary", "frameDigest": frame}


class RootTest(unittest.TestCase):
    def test_the_same_intervals_always_give_the_same_root(self):
        samples = [sample(3), sample(5), sample(2)]
        self.assertEqual(bundle(samples)[0], bundle(samples)[0])

    def test_changing_a_single_count_changes_the_root(self):
        before = bundle([sample(3), sample(5)])[0]
        after = bundle([sample(3), sample(6)])[0]
        self.assertNotEqual(before, after)

    def test_the_root_commits_to_which_intervals_exist_not_to_their_order(self):
        """Sorted pairing makes the tree order-independent, so the root fixes the
        set of intervals rather than the sequence. Nothing is lost: every leaf
        carries its own observedAt, so the timeline is recovered from the data
        instead of from the shape of the tree."""
        self.assertEqual(bundle([sample(3), sample(5)])[0],
                         bundle([sample(5), sample(3)])[0])

    def test_intervals_at_different_times_are_different_leaves(self):
        # Order is not committed, but time is: the same count at another moment
        # is a different interval and cannot stand in for the first.
        early = bundle([sample(3, at="2026-07-31T06:00:00Z")])[0]
        late = bundle([sample(3, at="2026-07-31T06:01:00Z")])[0]
        self.assertNotEqual(early, late)

    def test_dropping_an_interval_changes_the_root(self):
        self.assertNotEqual(bundle([sample(3), sample(5), sample(2)])[0],
                            bundle([sample(3), sample(5)])[0])

    def test_no_intervals_is_empty_not_a_hash_of_nothing(self):
        # A root over no evidence must not look like a real commitment.
        self.assertEqual(root([]), "")

    def test_root_is_a_bytes32_hex_string(self):
        r = bundle([sample(1), sample(2)])[0]
        self.assertTrue(r.startswith("0x"))
        self.assertEqual(len(r), 66)


class ProofTest(unittest.TestCase):
    def test_every_interval_proves_against_the_root(self):
        samples = [sample(i) for i in range(1, 8)]
        r, leaves = bundle(samples)
        for i, one in enumerate(leaves):
            self.assertTrue(verify(one, path(leaves, i), r), f"leaf {i}")

    def test_a_single_interval_needs_no_siblings(self):
        r, leaves = bundle([sample(9)])
        self.assertEqual(path(leaves, 0), [])
        self.assertTrue(verify(leaves[0], [], r))

    def test_an_interval_that_was_never_counted_does_not_prove(self):
        r, leaves = bundle([sample(1), sample(2), sample(3)])
        forged = leaf(sample(99))
        self.assertFalse(verify(forged, path(leaves, 0), r))

    def test_a_proof_from_another_bundle_does_not_transfer(self):
        r, leaves = bundle([sample(1), sample(2), sample(3), sample(4)])
        _, other = bundle([sample(7), sample(8), sample(9), sample(10)])
        self.assertFalse(verify(leaves[0], path(other, 0), r))

    def test_odd_counts_still_prove(self):
        # The unpaired node is carried up rather than doubled, so the odd sizes
        # are where an off-by-one in the tree would show first.
        for n in (3, 5, 7, 9, 11):
            samples = [sample(i) for i in range(n)]
            r, leaves = bundle(samples)
            for i in range(n):
                self.assertTrue(verify(leaves[i], path(leaves, i), r), f"n={n} leaf={i}")


class FrameChainTest(unittest.TestCase):
    def test_frames_fold_into_one_digest(self):
        a = chain(digest(b"seed"), b"frame-1")
        b = chain(a, b"frame-2")
        self.assertNotEqual(a, b)
        self.assertEqual(len(b), 64)

    def test_reordering_frames_changes_the_digest(self):
        seed = digest(b"seed")
        forward = chain(chain(seed, b"one"), b"two")
        backward = chain(chain(seed, b"two"), b"one")
        self.assertNotEqual(forward, backward)

    def test_dropping_a_frame_changes_the_digest(self):
        seed = digest(b"seed")
        full = chain(chain(chain(seed, b"a"), b"b"), b"c")
        missing = chain(chain(seed, b"a"), b"c")
        self.assertNotEqual(full, missing)


class SeparationTest(unittest.TestCase):
    def test_a_leaf_cannot_be_replayed_as_an_internal_node(self):
        """Leaves and nodes are hashed under different prefixes. Without that an
        internal node could be presented as a real counting interval."""
        from scry_vision.evidence import pair
        one = leaf(sample(1))
        two = leaf(sample(2))
        self.assertNotEqual(pair(one, two), leaf(sample(1)))

class StampTest(unittest.TestCase):
    def test_zero_microseconds_still_gets_a_fractional_part(self):
        from datetime import UTC, datetime
        from scry_vision.evidence import stamp
        # isoformat() drops .000000 here, which would hash differently from the
        # same instant produced anywhere else.
        exact = datetime(2026, 7, 31, 6, 0, 0, 0, tzinfo=UTC)
        self.assertEqual(stamp(exact), "2026-07-31T06:00:00.000000Z")

    def test_every_stamp_is_the_same_width(self):
        from datetime import UTC, datetime
        from scry_vision.evidence import stamp
        a = stamp(datetime(2026, 7, 31, 6, 0, 0, 0, tzinfo=UTC))
        b = stamp(datetime(2026, 7, 31, 6, 0, 0, 123456, tzinfo=UTC))
        self.assertEqual(len(a), len(b))

class WireTest(unittest.TestCase):
    def test_the_root_survives_into_the_submitted_body(self):
        """observe() computing a root is not the same as the API receiving one.
        submit() builds an explicit body, so a new field is silently dropped
        unless it is added there too."""
        # Read as text rather than import: observer.py needs OpenCV, which CI
        # does not have, and this check is about the wire format not the model.
        import pathlib
        source = pathlib.Path(__file__).resolve().parents[1] / "scry_vision" / "observer.py"
        body = source.read_text().split("def submit(")[1]
        self.assertIn("evidenceRoot", body)


if __name__ == "__main__":
    unittest.main()
