#!/usr/bin/env python3
"""Independent stdlib probe for the paired-replay v1 wire format."""

import argparse
import hashlib
import json
import os
import re
import time
import uuid
from pathlib import Path


IDENTIFIER = re.compile(r"[A-Za-z0-9][A-Za-z0-9._-]{0,127}")
SOURCE_PATH = re.compile(r"(?:[A-Za-z0-9_-][A-Za-z0-9._-]*/)*[A-Za-z0-9_-][A-Za-z0-9._-]*")


def require(condition, message):
    if not condition:
        raise ValueError(message)


def digest(data):
    return hashlib.sha256(data).hexdigest()


def read_file(file):
    require(file.is_file() and file.resolve() == file and file.stat().st_size <= 5_000_000,
            f"Expected a regular replay file within the size limit: {file.name}")
    return file.read_bytes()


def read_bundle(directory):
    directory = directory.resolve(strict=True)
    raw = read_file(directory / "case.json")
    manifest = json.loads(raw)
    require(type(manifest["version"]) is int and manifest["version"] == 1
            and IDENTIFIER.fullmatch(manifest["id"]), "Unsupported case version or ID")
    calendar = read_file(directory / "calendar.json")
    require(digest(calendar) == manifest["calendar"]["sha256"], "Calendar hash differs")
    fixture = json.loads(calendar)
    student = manifest["student"]
    require(student == manifest["calendar"]["student"] == fixture["users"][0]["id"]
            == fixture["calendars"][0]["userId"], "Calendar student differs")
    workspace = directory / "workspace"
    sources = set()
    for source in manifest["sources"]:
        relative = source["path"]
        require(len(relative) <= 180 and SOURCE_PATH.fullmatch(relative) and relative not in sources,
                f"Invalid or duplicate source path: {relative}")
        sources.add(relative)
        require(digest(read_file(workspace / relative)) == source["sha256"],
                f"Source hash differs: {relative}")
    actual = {path.relative_to(workspace).as_posix() for path in workspace.rglob("*")
              if path.is_symlink() or not path.is_dir()}
    require(sources and actual == sources and manifest["expect"]["deadline"]["source"] in sources,
            "Workspace files and expected source must match the manifest")
    return manifest, digest(raw), sources


def check_result(result, manifest, checksum, sources):
    # This independent check covers portable identities, references and the
    # reported sequence of review and approval. Provider observations remain separate.
    # The JSON Schemas supplied with the bundle describe the full wire format.
    require(type(result["version"]) is int and result["version"] == manifest["version"]
            and result["caseId"] == manifest["id"] and result["inputSha256"] == checksum,
            "Result does not reference this case version and exact input")
    require(IDENTIFIER.fullmatch(result["runId"]), "Invalid result run ID")
    questions, revisions = set(), {}
    validation, approvals, applicable_approvals, applied = {}, set(), set(), set()
    active_revision = None
    requests = []
    for entry in result["timeline"]:
        kind = entry["kind"]
        if kind == "request":
            requests.append(entry["text"])
        elif kind == "question":
            require(IDENTIFIER.fullmatch(entry["id"]) and entry["id"] not in questions,
                    "Invalid or duplicate question ID")
            questions.add(entry["id"])
        elif kind == "answer":
            require(entry["questionId"] in questions, "Answer refers to a question not yet observed")
        elif kind == "advice":
            require(all(cite["path"] in sources for cite in entry["sources"]), "Advice cites an undeclared source")
        elif kind == "proposal":
            revision = entry["revisionId"]
            require(IDENTIFIER.fullmatch(revision) and revision not in revisions,
                    "Invalid or duplicate proposal revision")
            require(entry["replaces"] is None or entry["replaces"] in revisions,
                    "Proposal replaces a revision not yet observed")
            require(all(source["citation"]["path"] in sources for source in entry["sources"]),
                    "Proposal cites an undeclared source")
            revisions[revision] = entry["sections"]
            active_revision = revision
        elif kind == "validation":
            require(entry["revisionId"] in revisions, "Validation refers to an unknown proposal revision")
            validation[entry["revisionId"]] = entry["passed"]
            if entry["passed"] is not True:
                applicable_approvals = {key for key in applicable_approvals if key[0] != entry["revisionId"]}
        elif kind in ("decision", "write"):
            key = entry["revisionId"], entry["section"]
            require(key[0] in revisions and key[1] in ("near", "future"),
                    "Approval or write refers to an unknown proposal section")
            if kind == "decision":
                if entry["approved"] is True:
                    require(validation.get(key[0]) is True, "Approval follows no successful validation of this revision")
                    approvals.add(key)
                    applicable_approvals.add(key)
                else:
                    approvals.discard(key)
                    applicable_approvals.discard(key)
            if kind == "write":
                require(key in approvals, "Write has no previous explicit approval")
                intended = {action["eventId"] for action in revisions[key[0]][key[1]]}
                require(set(entry["intended"]) == intended, "Write intent differs from the approved section")
                if entry["outcome"] == "applied":
                    require(key[0] == active_revision, "Applied outcome refers to a superseded proposal")
                    require(validation.get(key[0]) is True and key in applicable_approvals,
                            "Applied outcome follows an invalidated approval")
                    require(key not in applied, "Proposal section was applied more than once")
                    applied.add(key)
        else:
            require(kind in ("context_review", "observation"), f"Unknown timeline event: {kind}")
    require(not requests or requests[0] == manifest["request"], "Opening request differs from the manifest")


def mock_result(manifest, checksum):
    started = time.monotonic()
    answer = manifest["operator"]["answers"][0]
    question = ("Teste de interoperabilidade: informe a primeira resposta preparada."
                if manifest["locale"] == "pt-BR" else
                "Interoperability mock: provide the first prepared answer.")
    return {
        "version": 1, "caseId": manifest["id"], "inputSha256": checksum, "runId": str(uuid.uuid4()),
        "engine": {"name": "Python interoperability mock", "revision": "1", "mode": "scripted",
                   "model": None, "harness": None, "tools": [], "simulator": None},
        "durationMs": int((time.monotonic() - started) * 1000), "usage": {"availability": "not_applicable"},
        "timeline": [
            {"kind": "request", "text": manifest["request"]},
            {"kind": "question", "id": answer["id"], "text": question, "choices": []},
            {"kind": "answer", "questionId": answer["id"], "text": answer["text"]},
        ],
        "checks": [{"id": "bundle_hashes", "outcome": "pass", "detail": "Read the exact case, calendar and source bytes."},
                   {"id": "calendar_workflow", "outcome": "not_observed", "detail": "No planner or calendar executed."}],
        "retirement": "not_observed",
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check-result", action="store_true", help="Read and check an existing result instead of creating a mock.")
    parser.add_argument("bundle", type=Path)
    parser.add_argument("result", type=Path)
    args = parser.parse_args()
    try:
        manifest, checksum, sources = read_bundle(args.bundle)
        if args.check_result:
            result = json.loads(read_file(args.result.absolute()))
        else:
            result = mock_result(manifest, checksum)
        check_result(result, manifest, checksum, sources)
        if not args.check_result:
            descriptor = os.open(args.result, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
            with os.fdopen(descriptor, "w", encoding="utf-8") as output:
                json.dump(result, output, ensure_ascii=False, indent=2)
                output.write("\n")
    except (OSError, ValueError, TypeError, KeyError, IndexError) as error:
        parser.exit(1, f"Replay probe: {error}\n")
    print(f"Checked case {manifest['id']} ({checksum}), result {result['runId']}.")


if __name__ == "__main__":
    main()
