# Security policy

## Supported version

Security fixes are applied to the latest stable release and the current
revision of `main`. Experimental Linux/macOS artifacts do not imply the same
functional support level, but security reports affecting their shared code are
still accepted.

## Reporting a vulnerability

Do not open a public issue for a vulnerability that could launch commands,
expose terminal output, capture audio or inject text into another application.
Use GitHub private vulnerability reporting for this repository (**Security →
Advisories → Report a vulnerability**). Include the affected version, platform,
reproduction steps, expected impact and a minimal proof of concept. Do not
include real API keys, private terminal output or recordings.

The maintainers will acknowledge a valid report as soon as practical, keep the
reporter informed during triage and coordinate disclosure after a fix is
available. This volunteer project does not currently offer a bug bounty or a
guaranteed response SLA.

## Local security model

Vibe Spam intentionally launches user-selected executables. The backend must
remain local-only unless protected by an explicit API token. Electron creates
an ephemeral token for every launch. Never expose the backend port directly to
an untrusted network.

Official release notes publish SHA-256 checksums. Initial Windows releases are
unsigned and may trigger SmartScreen; this is a known distribution limitation,
not a request to disable operating-system protections.
