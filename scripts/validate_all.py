#!/usr/bin/env python3
"""Validate the Eastechs plugin marketplace and every bundled skill."""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path
from typing import Any
from urllib.parse import unquote, urlparse

import yaml


ROOT = Path(__file__).resolve().parent.parent
PLUGINS_ROOT = ROOT / "plugins"
MARKETPLACE_PATH = ROOT / ".agents" / "plugins" / "marketplace.json"
LICENSE_PATH = ROOT / "LICENSE"
NAME_RE = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")
SEMVER_RE = re.compile(
    r"^(0|[1-9]\d*)\."
    r"(0|[1-9]\d*)\."
    r"(0|[1-9]\d*)"
    r"(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?"
    r"(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$"
)
MARKDOWN_LINK_RE = re.compile(r"\]\(([^)]+)\)")
ALLOWED_INSTALLATION = {"NOT_AVAILABLE", "AVAILABLE", "INSTALLED_BY_DEFAULT"}
ALLOWED_AUTHENTICATION = {"ON_INSTALL", "ON_USE"}
ALLOWED_SKILL_FRONTMATTER = {
    "name",
    "description",
    "license",
    "allowed-tools",
    "metadata",
}


def load_json(path: Path, errors: list[str]) -> dict[str, Any] | None:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError:
        errors.append(f"missing {path.relative_to(ROOT)}")
        return None
    except json.JSONDecodeError as exc:
        errors.append(f"invalid JSON in {path.relative_to(ROOT)}: {exc}")
        return None
    if not isinstance(value, dict):
        errors.append(f"{path.relative_to(ROOT)} must contain a JSON object")
        return None
    return value


def require_string(payload: dict[str, Any], key: str, label: str, errors: list[str]) -> str | None:
    value = payload.get(key)
    if not isinstance(value, str) or not value.strip():
        errors.append(f"{label}.{key} must be a non-empty string")
        return None
    return value.strip()


def validate_skill(skill_root: Path, plugin_root: Path, errors: list[str]) -> None:
    label = str(skill_root.relative_to(ROOT))
    skill_md = skill_root / "SKILL.md"
    try:
        contents = skill_md.read_text(encoding="utf-8")
    except FileNotFoundError:
        errors.append(f"{label} is missing SKILL.md")
        return

    match = re.match(r"^---\n(.*?)\n---(?:\n|$)", contents, re.DOTALL)
    if match is None:
        errors.append(f"{label}/SKILL.md has invalid YAML frontmatter boundaries")
        return
    try:
        frontmatter = yaml.safe_load(match.group(1))
    except yaml.YAMLError as exc:
        errors.append(f"{label}/SKILL.md has invalid YAML: {exc}")
        return
    if not isinstance(frontmatter, dict):
        errors.append(f"{label}/SKILL.md frontmatter must be an object")
        return

    unexpected = set(frontmatter) - ALLOWED_SKILL_FRONTMATTER
    if unexpected:
        errors.append(f"{label}/SKILL.md has unsupported frontmatter keys: {sorted(unexpected)}")
    name = require_string(frontmatter, "name", f"{label}/SKILL.md", errors)
    description = require_string(frontmatter, "description", f"{label}/SKILL.md", errors)
    if name is not None:
        if name != skill_root.name:
            errors.append(f"{label} folder name does not match frontmatter name {name!r}")
        if NAME_RE.fullmatch(name) is None or len(name) > 64:
            errors.append(f"{label} has an invalid skill name")
    if description is not None:
        if len(description) > 1024:
            errors.append(f"{label} description exceeds 1024 characters")
        if "<" in description or ">" in description:
            errors.append(f"{label} description contains angle brackets")

    for raw_target in MARKDOWN_LINK_RE.findall(contents):
        target = raw_target.strip().split(maxsplit=1)[0].strip("<>")
        target = unquote(target.split("#", 1)[0])
        if not target or target == "url" or target.startswith("#"):
            continue
        parsed = urlparse(target)
        if parsed.scheme or target.startswith("//"):
            continue
        resolved = (skill_root / target).resolve()
        if not resolved.is_relative_to(plugin_root.resolve()):
            errors.append(f"{label}/SKILL.md link escapes its plugin: {raw_target}")
        elif not resolved.exists():
            errors.append(f"{label}/SKILL.md has a missing relative link: {raw_target}")

    agent_yaml = skill_root / "agents" / "openai.yaml"
    if agent_yaml.exists():
        try:
            agent = yaml.safe_load(agent_yaml.read_text(encoding="utf-8"))
        except yaml.YAMLError as exc:
            errors.append(f"{agent_yaml.relative_to(ROOT)} has invalid YAML: {exc}")
            return
        if not isinstance(agent, dict) or not isinstance(agent.get("interface"), dict):
            errors.append(f"{agent_yaml.relative_to(ROOT)} must contain an interface object")
        policy = agent.get("policy") if isinstance(agent, dict) else None
        if policy is not None and (
            not isinstance(policy, dict)
            or not isinstance(policy.get("allow_implicit_invocation", True), bool)
        ):
            errors.append(f"{agent_yaml.relative_to(ROOT)} has an invalid policy")


def validate_plugin(plugin_root: Path, errors: list[str]) -> int:
    label = str(plugin_root.relative_to(ROOT))
    manifest = load_json(plugin_root / ".codex-plugin" / "plugin.json", errors)
    if manifest is None:
        return 0

    name = require_string(manifest, "name", f"{label}/plugin.json", errors)
    version = require_string(manifest, "version", f"{label}/plugin.json", errors)
    require_string(manifest, "description", f"{label}/plugin.json", errors)
    if name is not None and (name != plugin_root.name or NAME_RE.fullmatch(name) is None):
        errors.append(f"{label} folder and manifest names must match kebab-case")
    if version is not None and SEMVER_RE.fullmatch(version) is None:
        errors.append(f"{label} version is not strict semver")
    if manifest.get("license") != "MIT":
        errors.append(f"{label} manifest license must be MIT")
    if manifest.get("skills") != "./skills/":
        errors.append(f"{label} manifest skills path must be ./skills/")
    if "hooks" in manifest:
        errors.append(f"{label} manifest contains unsupported hooks")
    if any("[TODO:" in value for value in walk_strings(manifest)):
        errors.append(f"{label} manifest contains a TODO placeholder")

    author = manifest.get("author")
    if not isinstance(author, dict):
        errors.append(f"{label} manifest author must be an object")
    else:
        require_string(author, "name", f"{label}/plugin.json.author", errors)
    interface = manifest.get("interface")
    if not isinstance(interface, dict):
        errors.append(f"{label} manifest interface must be an object")
    else:
        for key in ("displayName", "shortDescription", "longDescription", "developerName", "category"):
            require_string(interface, key, f"{label}/plugin.json.interface", errors)
        prompts = interface.get("defaultPrompt")
        if not isinstance(prompts, list) or not 1 <= len(prompts) <= 3 or not all(
            isinstance(prompt, str) and prompt.strip() and len(prompt) <= 128 for prompt in prompts
        ):
            errors.append(f"{label} defaultPrompt must contain 1-3 strings of at most 128 characters")
        capabilities = interface.get("capabilities")
        if not isinstance(capabilities, list) or not all(
            isinstance(capability, str) and capability.strip() for capability in capabilities
        ):
            errors.append(f"{label} capabilities must be an array of strings")

    skills_root = plugin_root / "skills"
    if not skills_root.is_dir():
        errors.append(f"{label} is missing its skills directory")
        return 0
    skill_roots = sorted(
        path for path in skills_root.iterdir() if path.is_dir() and not path.name.startswith(".")
    )
    for skill_root in skill_roots:
        validate_skill(skill_root, plugin_root, errors)
    return len(skill_roots)


def walk_strings(value: Any):
    if isinstance(value, str):
        yield value
    elif isinstance(value, list):
        for item in value:
            yield from walk_strings(item)
    elif isinstance(value, dict):
        for item in value.values():
            yield from walk_strings(item)


def main() -> int:
    errors: list[str] = []
    if not LICENSE_PATH.is_file():
        errors.append("repository is missing LICENSE")
    marketplace = load_json(MARKETPLACE_PATH, errors)
    entries: list[Any] = []
    if marketplace is not None:
        if marketplace.get("name") != "eastechs":
            errors.append("marketplace name must be eastechs")
        interface = marketplace.get("interface")
        if not isinstance(interface, dict) or interface.get("displayName") != "Eastechs Plugins":
            errors.append("marketplace interface.displayName must be Eastechs Plugins")
        entries = marketplace.get("plugins", [])
        if not isinstance(entries, list):
            errors.append("marketplace plugins must be an array")
            entries = []

    plugin_roots = sorted(path for path in PLUGINS_ROOT.iterdir() if path.is_dir())
    plugin_names = {path.name for path in plugin_roots}
    entry_names: set[str] = set()
    for entry in entries:
        if not isinstance(entry, dict):
            errors.append("marketplace entries must be objects")
            continue
        name = entry.get("name")
        if not isinstance(name, str) or name in entry_names:
            errors.append(f"invalid or duplicate marketplace entry name: {name!r}")
            continue
        entry_names.add(name)
        if entry.get("source") != {"source": "local", "path": f"./plugins/{name}"}:
            errors.append(f"marketplace entry {name} has an invalid source")
        policy = entry.get("policy")
        if not isinstance(policy, dict):
            errors.append(f"marketplace entry {name} is missing policy")
        else:
            if policy.get("installation") not in ALLOWED_INSTALLATION:
                errors.append(f"marketplace entry {name} has invalid installation policy")
            if policy.get("authentication") not in ALLOWED_AUTHENTICATION:
                errors.append(f"marketplace entry {name} has invalid authentication policy")
            if "products" in policy:
                errors.append(f"marketplace entry {name} has an unrequested products override")
        if not isinstance(entry.get("category"), str) or not entry["category"].strip():
            errors.append(f"marketplace entry {name} is missing category")

    if entry_names != plugin_names:
        errors.append(
            f"marketplace/plugin mismatch: entries={sorted(entry_names)}, directories={sorted(plugin_names)}"
        )

    skill_count = sum(validate_plugin(plugin_root, errors) for plugin_root in plugin_roots)
    junk = sorted(path.relative_to(ROOT) for path in ROOT.rglob(".DS_Store"))
    if junk:
        errors.append(f"Finder metadata must not be committed: {junk}")
    symlinks = sorted(path.relative_to(ROOT) for path in ROOT.rglob("*") if path.is_symlink())
    if symlinks:
        errors.append(f"plugin repository must not contain symlinks: {symlinks}")

    if errors:
        print("Validation failed:")
        for error in errors:
            print(f"- {error}")
        return 1
    print(f"Validated {len(plugin_roots)} plugins and {skill_count} skills.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
