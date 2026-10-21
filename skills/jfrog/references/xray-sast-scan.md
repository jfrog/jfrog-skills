# SAST scan (`jf audit --sast`)

Source-code SAST only; needs JFrog Advanced Security. Local secrets / IaC:
`jf audit --secrets` / `--iac`; stored-artifact results → `xray-entities.md`.

```bash
jf audit --sast --server-id <SID>
```

Scans the working directory; if blocked, request approval, never another
scanner.

- `401` → re-login same server; `403` → permissions; never switch servers.
- Not entitled / JAS unavailable → check Advanced Security on `<SID>`.
- Error before results → quote it, stop; error after results → report them, quote it.

Report by severity (Critical, High, Medium, Low): rule / type, `file:line`,
why exploitable.
