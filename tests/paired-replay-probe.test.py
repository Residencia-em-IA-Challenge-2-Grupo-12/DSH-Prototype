import copy
import importlib.util
import json
from pathlib import Path
import unittest


ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location("replay_probe", ROOT / "scripts/paired-replay-probe.py")
probe = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(probe)


class ApprovalEvidence(unittest.TestCase):
    def setUp(self):
        manifest = (ROOT / "fixtures/paired-replay/ana-held-out/case.json").read_bytes()
        self.manifest = json.loads(manifest)
        self.checksum = probe.digest(manifest)
        self.sources = {entry["path"] for entry in self.manifest["sources"]}
        self.result = json.loads((ROOT / "docs/evidence/ana-regression-2026-11-21/ana-live-result.json").read_bytes())
        self.timeline = self.result["timeline"]
        self.write_at = next(i for i, entry in enumerate(self.timeline) if entry["kind"] == "write")
        self.revision = self.timeline[self.write_at]["revisionId"]

    def check(self):
        probe.check_result(self.result, self.manifest, self.checksum, self.sources)

    def invalidate(self):
        self.timeline.insert(self.write_at, {"kind": "validation", "revisionId": self.revision, "passed": False})

    def test_revised_proposal_with_valid_approval_is_accepted(self):
        self.check()

    def test_applied_receipt_for_superseded_proposal_is_rejected(self):
        original = next(entry for entry in self.timeline if entry.get("revisionId") == self.revision and entry["kind"] == "proposal")
        replacement = copy.deepcopy(original)
        replacement.update(revisionId="replacement", replaces=self.revision)
        self.timeline.insert(self.write_at, replacement)
        with self.assertRaisesRegex(ValueError, "superseded proposal"):
            self.check()

    def test_validation_failure_invalidates_old_approval(self):
        self.invalidate()
        with self.assertRaisesRegex(ValueError, "invalidated approval"):
            self.check()
        self.timeline.insert(self.write_at + 1, {"kind": "validation", "revisionId": self.revision, "passed": True})
        with self.assertRaisesRegex(ValueError, "invalidated approval"):
            self.check()

    def test_a_rejected_attempt_can_still_be_reported_after_invalidation(self):
        self.invalidate()
        receipt = self.timeline[self.write_at + 1]
        receipt.update(outcome="rejected", acknowledged=[], unresolved=[])
        self.check()


if __name__ == "__main__":
    unittest.main()
