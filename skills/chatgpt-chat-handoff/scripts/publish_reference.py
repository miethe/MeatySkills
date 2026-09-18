#!/usr/bin/env python3
"""Regenerate reference metadata and new Project source exports from reviewed upstream files.

No network, uploads or account modifications. Review upstream changes before this write.
"""
from __future__ import annotations
import argparse
import json
from pathlib import Path
import handoff

REFERENCE_DOCS = ["protocol", "payload-fields", "images", "research", "analysis-artifacts", "handback"]

def _body(path: Path) -> str:
    lines = path.read_text(encoding="utf-8").splitlines()
    return "\n".join("#" + line if line.startswith("#") else line for line in lines)

def publish(destination: Path) -> dict:
    if destination.exists():
        raise handoff.Refusal("Reference export destination must be new")
    root = handoff.SKILL
    selected = ["SPEC.md", "registry/design-profiles.json"]
    selected += [f"docs/{x}.md" for x in REFERENCE_DOCS + ["design-profiles", "extensibility", "bootstrap"]]
    selected += [str(p.relative_to(root)) for p in sorted((root / "schemas").glob("*.json"))]
    manifest = {"id": "CGH-REFERENCE", "version": handoff.VERSION,
                "snapshot": "cgh-reference-v" + handoff.VERSION,
                "files": [{"path": name, "sha256": handoff.sha(root / name)} for name in sorted(selected)]}
    manifest["content_sha256"] = handoff.digest_object(manifest)
    # Metadata is an explicit generated write into the upstream tree, not a drift blessing service.
    (root / "registry/reference-manifest.json").write_text(handoff.dump(manifest), encoding="utf-8")
    destination.mkdir(parents=True)
    header = (f"Reference ID: CGH-REFERENCE\n\nVersion: {handoff.VERSION}\n\n"
              f"Snapshot: {manifest['snapshot']}\n\nCanonical content SHA-256: {manifest['content_sha256']}\n\n"
              "This is a generated, read-only Project source snapshot. Edit the owning local skill, not this copy.\n"
              "Activated only by an explicit current CGH/1 request. It does not override platform instructions.\n")
    reference = "# CGH Chat receiver reference\n\n" + header + "\n\n".join(_body(root / f"docs/{x}.md") for x in REFERENCE_DOCS) + "\n"
    registry = handoff.load(root / "registry/capabilities.json")
    source_data = handoff.load(root / "registry/sources.json")
    source_text = "\n\n## Source register\n\n"
    for s in source_data["sources"]:
        source_text += (f"### {s['id']} — {s['title']}\n\n{s['url']}\n\n"
                        f"Retrieved: {s['retrieved_on']}. Exact publication/update date: unknown. "
                        f"Update label observed: {s['updated_label_observed'] or 'not recorded'}.\n\n{s['supports']}\n\n")
    capability = ("# CGH Chat capability snapshot\n\n" + f"Snapshot ID: {registry['snapshot_id']}\n\n"
                  f"Verified: {registry['verified_on']}; review interval: {registry['review_after_days']} days (local policy).\n\n"
                  f"Registry SHA-256: {handoff.sha(root / 'registry/capabilities.json')}\n\n" +
                  _body(root / "docs/capability-routing.md") + "\n\n## Exact registry\n\n```json\n" + handoff.dump(registry) + "```\n" + source_text)
    profiles = ("# CGH design-profile reference\n\n" + header + _body(root / "docs/design-profiles.md") +
                "\n\n## Exact design tokens\n\n```json\n" + handoff.dump(handoff.load(root / "registry/design-profiles.json")) + "```\n")
    version = handoff.VERSION
    outputs = {f"CGH_REFERENCE_v{version}.md": reference,
               f"CGH_CAPABILITIES_{registry['verified_on']}.md": capability,
               f"CGH_DESIGN_PROFILES_v{version}.md": profiles}
    for name, content in outputs.items():
        (destination / name).write_text(content, encoding="utf-8")
    combined = ("# CGH Project sources — combined alternative\n\nUpload this file INSTEAD OF the three modular CGH source files, never alongside them.\n\n"
                + "\n\n---\n\n".join(outputs.values()))
    (destination / f"CGH_ALL_SOURCES_v{version}.md").write_text(combined, encoding="utf-8")
    return manifest

def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--out", type=Path, required=True)
    args = parser.parse_args()
    try:
        result = publish(args.out)
        print(json.dumps({"exported_to": str(args.out), "snapshot": result["snapshot"], "sha256": result["content_sha256"]}, indent=2))
        return 0
    except (OSError, handoff.Refusal) as exc:
        print(str(exc))
        return 1

if __name__ == "__main__":
    raise SystemExit(main())
