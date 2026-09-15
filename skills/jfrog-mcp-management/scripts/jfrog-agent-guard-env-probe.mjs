#!/usr/bin/env node
// Copyright (c) JFrog Ltd. 2026
// Licensed under the Apache License, Version 2.0
// https://www.apache.org/licenses/LICENSE-2.0
//
// JFrog Agent Guard environment probe.
//
// Safe cross-platform env dump used by the jfrog-mcp-management skill pre-flight
// (before resolving project key / server). Prints one labeled line per var so
// agents do not invent chained printenv / head probes that merge lines.
//
// Contract:
//   - Exit 0 after writing all lines (do not call process.exit — let Node
//     flush stdout, especially under pipes)
//   - Tokens (JFROG_ACCESS_TOKEN / JF_ACCESS_TOKEN): "present" or empty
//   - URLs (JFROG_URL / JF_URL): "present" or empty (prefer presence-only)
//   - JF_PROJECT / JFROG_AGENT_GUARD_REPO: real value or empty when unset
//   - Never print raw token values

import process from "node:process";

const presentOrEmpty = (value) => (value ? "present" : "");

const lines = [
  `JFROG_URL: ${presentOrEmpty(process.env.JFROG_URL)}`,
  `JFROG_ACCESS_TOKEN: ${presentOrEmpty(process.env.JFROG_ACCESS_TOKEN)}`,
  `JF_URL: ${presentOrEmpty(process.env.JF_URL)}`,
  `JF_ACCESS_TOKEN: ${presentOrEmpty(process.env.JF_ACCESS_TOKEN)}`,
  `JF_PROJECT: ${process.env.JF_PROJECT ?? ""}`,
  `JFROG_AGENT_GUARD_REPO: ${process.env.JFROG_AGENT_GUARD_REPO ?? ""}`,
];

process.stdout.write(`${lines.join("\n")}\n`);
