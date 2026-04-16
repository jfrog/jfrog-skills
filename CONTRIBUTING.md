# Contributing to JFrog Skills

Guidelines for agents and humans contributing to this repository.

## Skill Naming Convention

All skill names must have a `jfrog-` prefix and be named by the **functionality they solve**, not by the JFrog service that implements it.

- Good: `jfrog-artifact-operations`, `jfrog-security-scanning`, `jfrog-build-operations`
- Bad: `artifactory`, `xray`, `access`, `pipelines` (service names)
- Bad: `artifact-operations` (missing `jfrog-` prefix)

The name should describe what the user is trying to do, not which backend service handles it.

## Command Naming Convention

Any command or script added to this repository must start with `jfrog` (e.g., `jfrog-validate-skill`, `jfrog-run-tests`). This ensures clear namespacing and avoids collisions with other tools.

## Directory Structure

All skills live directly under `skills/<name>/` -- flat structure, never nested into subdirectories like `skills/base/` or `skills/workflows/`. Layering (base vs workflow) is expressed through SKILL.md metadata and prerequisites, not through directory hierarchy.

## Base vs Workflow Skills

- **`jfrog`** is the base skill. It provides foundational JFrog knowledge, CLI setup instructions, and routes to workflow skills via internal references.
- **All other skills** are workflow skills. They declare `jfrog` as a prerequisite in their SKILL.md header.
- The base skill references workflow skills for routing; workflow skills reference the base for foundational context.
- **The base skill must never use `load skill` to reference workflow skills.** It must be fully self-contained — users may install only the base skill. Use `references/` files within the base skill for any content that needs to be accessible without workflow skills installed. This is enforced by CI validation.

## Skill Structure

Every skill lives in `skills/<name>/` and must contain at least a `SKILL.md`. Optional: a `references/` subdirectory for CLI command patterns and API reference docs.

## No Internal Test Data

No references to internal JFrog environments, instance names, or specific internal projects/repos/packages/builds are allowed anywhere in this repo. Specifically:

- Never use real internal server names or any specific `*.jfrog.io` instance
- Use generic public packages: `lodash`, `spring-boot-starter-web`, `commons-lang3`, `guava`
- Use placeholder names for repos: `libs-release-local`, `npm-remote`, `docker-local`
- Use placeholder instance URLs: `https://mycompany.jfrog.io`

This applies to skills, reference files, test prompts, and all documentation.

## Commit Messages

Write clear, concise commit messages that describe what the change does. Start
with a capital letter, use imperative mood.

Examples:
- `Add package safety workflow skill`
- `Fix credential extraction for non-default servers`
- `Update AQL syntax reference with date-range examples`

## Versioning

This project uses `0.x` versioning while in beta. The `1.0` release will be tagged once skills graduate from beta after sufficient validation and customer feedback.

## Contributor License Agreement

Contributions to this project require signing the [JFrog CLA](https://jfrog.com/cla/) before your first pull request can be merged.
