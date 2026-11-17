# /jfrog-init — full flow diagram

Visual companion to the numbered Steps in `SKILL.md`. Every decision
node here is also fully documented — including the exact user-facing
wording — in the corresponding Step section of `SKILL.md`; this diagram
adds nothing new, it's a compressed map of that same prose for
at-a-glance orientation. `SKILL.md`'s Step-by-step text is the
authoritative source for wording and behavior — follow it literally.

```mermaid
flowchart TD
    Start(["/jfrog-init"]) --> S1

    S1["1. Node.js >= 18 installed? (no script — node --version / npx --version)"]:::stepBox
    S1 -->|no| ASKNODE["AskUserQuestion: Install Node.js now? Yes/No"]:::fixBox
    ASKNODE -->|Yes, macOS/Linux| NVMINSTALL["Install nvm (pinned version) + nvm install --lts"]:::autoBox
    ASKNODE -->|Yes, Windows| WINGETNODE["winget install OpenJS.NodeJS.LTS"]:::autoBox
    ASKNODE -->|No| STOP0["STOP: cannot proceed without Node"]:::stopBox
    NVMINSTALL -->|failed| F1["Fall back: ask user to install Node.js >= 18 manually"]:::fixBox
    NVMINSTALL -->|ok| S2
    WINGETNODE --> F1W["Tell user: open a new terminal, re-run /jfrog-init"]:::fixBox
    S1 -->|yes| S2

    S2["2. jf CLI installed and >= 2.106.0?"]:::stepBox
    S2 -->|missing| ASKJF["AskUserQuestion: Install JFrog CLI? Yes/No"]:::fixBox
    S2 -->|outdated| ASKJFU["AskUserQuestion: Update JFrog CLI? Yes/No"]:::fixBox
    ASKJF -->|Yes| INSTJF["jfrog-install-jf-cli.mjs: Plan A npm install -g jfrog-cli-v2-jf"]:::autoBox
    ASKJFU -->|Yes| INSTJF
    ASKJF -->|No| STOP0J["STOP: cannot proceed without jf"]:::stopBox
    ASKJFU -->|No| STOP0J
    INSTJF -->|npm exited 0, but resolving jf is shadowed by an earlier install on PATH| SHADOW["Report shadowing — move npm's bin ahead on PATH, or remove the other install"]:::fixBox
    SHADOW --> PLANC
    INSTJF -->|npm failed, or exited 0 but jf still isn't resolving up to date and not shadowed, and a private registry is configured| PLANB["Plan B: retry npm install against the public registry"]:::autoBox
    PLANB -->|jf now resolves up to date| S2RE
    PLANB -->|still not up to date| PLANC
    INSTJF -->|npm missing, or Plan A/B failed to leave an up-to-date jf on PATH| PLANC["Plan C: direct binary download to ~/.jfrog/bin, checksum-verified, runs jf --version to confirm"]:::autoBox
    PLANC -->|Windows| WINPS["Print PowerShell one-liner — user runs it themselves, then re-runs /jfrog-init"]:::fixBox
    PLANC -->|macOS/Linux| S2RE
    INSTJF -->|npm succeeded and jf now resolves >= 2.106.0| S2RE["Re-check: installed and >= 2.106.0?"]:::stepBox
    S2RE -->|still missing/outdated| STOP1["STOP: show raw install error"]:::stopBox
    S2RE -->|ok| S3
    S2 -->|yes| S3

    S3["3. jf connected to a server?"]:::stepBox
    S3 -->|no| ASKMETHOD["AskUserQuestion: Web login or Access token?"]:::fixBox
    ASKMETHOD -->|Web login| WEBLOGIN["Register session, show code/link, retrieve + save credentials — all in-session, this skill's own local scripts"]:::autoBox
    WEBLOGIN --> S3ASKW["AskUserQuestion: Did you finish logging in? Yes/No"]:::fixBox
    S3ASKW -->|Yes| S3
    S3ASKW -->|No| STOP0B["STOP: user cancelled"]:::stopBox
    ASKMETHOD -->|Access token| F3["Print one command, --url pre-filled — user runs it themselves in their own terminal, pastes the token"]:::fixBox
    F3 --> S3ASK["AskUserQuestion: Did you finish running that command? Yes/No"]:::fixBox
    S3ASK -->|Yes| S3
    S3ASK -->|No| STOP0B
    S3 -->|yes| S4

    S4["4. Server reachable and credentials valid?"]:::stepBox
    S4 -->|multiple servers, no default| ASKSRV["AskUserQuestion: pick server-id"]:::fixBox
    ASKSRV --> S4
    S4 -->|reachable, but token invalid/expired| F4["Print one command, --url and --server-id pre-filled (token-only, no web option — avoids a duplicate server) — user runs it themselves"]:::fixBox
    F4 --> S4ASK["AskUserQuestion: Did you finish running that command? Yes/No"]:::fixBox
    S4ASK -->|Yes| S4
    S4ASK -->|No| STOP0C["STOP: user cancelled"]:::stopBox
    S4 -->|unreachable/timeout/other| STOP2["STOP: show raw error (network/URL hint included)"]:::stopBox
    S4 -->|yes| GET["jfrog-ai-governance-config.mjs get (corrupt: one line, it will be replaced)"]:::stepBox

    GET --> ASKGOV["AskUserQuestion: AI Governance server — saved server (if get returned another serverId), Same server or no AI Catalog, Different server"]:::fixBox
    ASKGOV -->|same server / no AI Catalog| LIST
    ASKGOV -->|saved server| PINGGOV
    ASKGOV -->|different server| ASKURL["Plain chat: AI Governance server"]:::fixBox
    ASKURL -->|the jf CLI default server| LIST
    ASKURL -->|another server in jf config| PINGGOV
    ASKURL -->|not in jf config yet| CONNECT["Web login or access token (Step 3's picker, jf CLI default server unchanged)"]:::fixBox
    CONNECT --> PINGGOV["Ping the AI Governance server (Step 4's branch table)"]:::stepBox
    PINGGOV -->|yes| LIST

    LIST["jfrog-ai-governance-config.mjs list"]:::stepBox
    LIST -->|saved project for this server| ASKKEEP["AskUserQuestion: Keep KEY as your AI Governance project? Yes/No"]:::fixBox
    LIST -->|none| ASKPROJ
    ASKKEEP -->|Yes| SET
    ASKKEEP -->|No| ASKPROJ["AskUserQuestion: first 2 projects (from enumeration), No AI Catalog, or Other to type one"]:::fixBox
    ASKPROJ -->|picked or typed| SET
    ASKPROJ -->|enumeration failed: jf missing / credentials rejected| STOPCREDS["STOP: show raw error (re-auth via the Step 3 picker)"]:::stopBox

    SET["jfrog-ai-governance-config.mjs set --force"]:::autoBox
    SET -->|exit 2, invalid project key| ASKKEY["Plain chat: ask for the project key again (once; rejected again: STOP, nothing saved)"]:::fixBox
    ASKKEY --> SET
    SET -->|exit 1, or any other exit 2| STOPSET["STOP: show its error line"]:::stopBox
    SET -->|exit 0| S5

    S5["5. Plugin mcp.json has a valid jfrog entry? (auto-substitutes a JFROG_PLATFORM_URL/JFROG_URL placeholder inline, if present)"]:::stepBox
    S5 -->|substitution needed, server-id ambiguous| ASKSRV5["AskUserQuestion: pick server-id"]:::fixBox
    ASKSRV5 --> S5
    S5 -->|missing/invalid/no entry, incl. substitution failure| F5["Note: reinstall or update the JFrog plugin, or resolve jf config (non-blocking)"]:::fixBox
    F5 --> S6
    S5 -->|yes, valid url| S5R["5b. JFrog MCP server enabled on this JPD? (jfrog-detect-jfrog-mcp-responding.mjs, anonymous GET &lt;JPD&gt;/mcp — non-blocking)"]:::stepBox
    S5R -->|not_enabled: ask admin / unreachable: couldn't confirm| F5R["Note: surface in Final Summary (non-blocking)"]:::fixBox
    S5R -->|enabled: ✅ if signed in to this JPD, else offer sign-in AFTER Final Summary| S6
    F5R --> S6

    S6["6. AI Catalog reachable and user entitled? (AI Governance server)"]:::stepBox
    S6 -->|anon 404 / connection failure / 5xx, exit 1| F6U["ℹ️ AI Catalog not available: catalogReason=unreachable — JPD may not host AI Catalog, or it's down right now (non-blocking)"]:::fixBox
    F6U --> S7CHECK
    S6 -->|authed 401 or 403, not entitled, exit 4| F6E["ℹ️ AI Catalog not available: catalogReason=not_entitled — ask JFrog admin for AI Catalog Read role (non-blocking)"]:::fixBox
    F6E --> S7CHECK
    S6 -->|jf missing / credentials rejected / unexpected response shape, exit 3| STOP6["STOP: show raw error"]:::stopBox
    S6 -->|yes, entitled, exit 0| S7CHECK

    S7CHECK{"Step 6 green AND harness == Claude Code? (detectHarness() reused from Step 5)"}:::stepBox
    S7CHECK -->|no| DONE
    S7CHECK -->|yes| S7["7. Claude agent-plugin marketplace registered? (AI Governance server and project)"]:::stepBox
    S7 -->|exit 0, success| F7OK["Final Summary: ✅ JFrog Marketplace, plus the trailing sentence"]:::autoBox
    S7 -->|exit 1 or 3, failed| F7BAD["Final Summary: ⚠️ JFrog Marketplace — not registered, no cause"]:::fixBox
    F7OK --> DONE
    F7BAD --> DONE

    DONE(["JFrog init complete"]):::doneBox

    classDef stepBox fill:#e8f0fe,stroke:#1a73e8,color:#000
    classDef fixBox fill:#fff4e5,stroke:#f9a825,color:#000
    classDef autoBox fill:#e6f4ea,stroke:#137333,color:#000
    classDef doneBox fill:#e6f4ea,stroke:#137333,color:#000
    classDef stopBox fill:#fce8e6,stroke:#c5221f,color:#000
```
