# jfrog-install-jf-cli.mjs — installation internals

Background for Step 2 of `/jfrog-init` (`SKILL.md`). The model doesn't
need this to execute the step — `jfrog-install-jf-cli.mjs` handles all
of it and reports success/failure on stdout and its exit code — but it
explains what the script actually does, for debugging or when a user
asks how the install works.

**Deliberately does not use** the base skill's
[`../jfrog/references/jfrog-cli-install-upgrade.md`](../../jfrog/references/jfrog-cli-install-upgrade.md)
(`brew install jfrog-cli` / a Linux-only curl one-liner, no Windows
guidance). This walk's primary method is one command that behaves
identically across macOS, Linux, and Windows without branching on OS —
`npm install -g jfrog-cli-v2-jf` — so it uses that instead. If npm
itself can't complete the install (missing, or a permissions error like
a global prefix that needs `sudo`), the script falls back to a
checksum-verified direct binary download with its own Windows handling.

`jfrog-install-jf-cli.mjs` tries progressively more self-contained
install methods, falling through only when one genuinely fails:

1. **Plan A — npm** (JFrog's own documented method:
   docs.jfrog.com/integrations/docs/download-and-install-the-jfrog-cli#npm):
   `npm install -g jfrog-cli-v2-jf` against whatever registry npm is
   already configured for. No PATH/shell-rc changes here: npm's global
   bin directory is expected to already be on PATH. This works
   identically on macOS, Linux, and Windows, so there's no OS-specific
   branch for this plan.
2. **Plan B — public registry retry**: triggered whenever Plan A's `npm`
   command itself fails, *or* it exits 0 but the `jf` that resolves on
   PATH afterward still isn't at the required version — provided that
   stale `jf` is npm's own install and not a different, older `jf`
   earlier on PATH shadowing it. Shadowing is reported directly and
   skips straight to Plan C instead: retrying against a different
   registry can't fix a PATH-ordering problem. If npm is configured for
   a registry other than the
   public one (common on a company machine, pointed at a
   private/corporate mirror), the exact same install is retried with
   `--registry=https://registry.npmjs.org/` — this one command only,
   never touching the user's saved npm config. `jfrog-cli-v2-jf` is a
   public package, so a private registry's own (possibly stale) auth
   says nothing about whether the package itself is reachable.
3. **Plan C — direct binary download**: if npm is missing, or both A
   and B failed for any other reason (observed in practice: a global
   npm prefix that requires `sudo`), downloads the first-party `jf`
   binary from `releases.jfrog.io` straight to `~/.jfrog/bin` — a
   user-owned prefix that never needs elevated permissions — and
   verifies it against the SHA-256 checksum Artifactory reports for that
   same artifact (catches a truncated/corrupted transfer, not an
   independent signature). Unlike Plans A/B, `~/.jfrog/bin` isn't on
   PATH by default, so a successful Plan C also appends a PATH line to
   the user's shell rc file (idempotent) and prints one for the caller
   to `eval` immediately, so `jf` resolves both in future terminals and
   in the *current* process without the user doing anything.
   **Windows**: Plan C's direct-download path isn't reliable there, so
   it instead prints a PowerShell one-liner — installing to a user-owned
   path and prepending to the user-scope `Path` via
   `[Environment]::SetEnvironmentVariable(..., 'User')`, no elevation
   needed. Reads the existing user-scope value first rather than using
   `setx PATH "...;$env:Path"`, which would copy the *combined*
   machine+user PATH into the user variable (duplicating every
   machine-level entry into it, permanently) and silently truncate past
   `setx`'s 1024-character limit. The whole script exits 1 so Step 2 can
   relay it to the user.

Only if all three plans fail does the script print the plain
`npm install -g jfrog-cli-v2-jf` command and exit 1, for the user to
diagnose and run themselves.

**Known trade-off of Plans A/B, called out in JFrog's own docs and not
something this script can detect or fix**: if the user relies on a
shim-based version manager (`nvm` / Volta) alongside another `jf`
install (Homebrew, curl, or Plan C itself), the version manager's
`bin/` takes PATH priority, so the npm-installed `jf` silently wins
regardless of what those other installs report.
