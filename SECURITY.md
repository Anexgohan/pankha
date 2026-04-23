# Security Policy

## Reporting a Vulnerability

If you discover a security vulnerability in Pankha, please report it responsibly.

**Do not open a public issue.** Instead, use one of the following:

1. **GitHub Security Advisories** (preferred): [Report a vulnerability](https://github.com/Anexgohan/pankha/security/advisories/new)
2. **Email**: support@pankha.app

Please include:
- Description of the vulnerability
- Steps to reproduce
- Affected components (backend, frontend, agents, Docker config)
- Potential impact

## Response Timeline

- **Acknowledgment**: Within 72 hours
- **Initial assessment**: Within 1 week
- **Fix or mitigation**: Depends on severity

## Scope

The following are in scope:
- Backend API and WebSocket server
- Frontend web application
- Linux and Windows agents
- Docker deployment configuration
- Authentication and license system

Out of scope:
- Third-party dependencies (report upstream, but let us know)
- Social engineering
- Denial of service attacks

## Supported Versions

Only the latest stable release is supported with security updates. This applies to both the AGPL-3.0 and Commercial license distributions.

| Version | Supported |
|---------|-----------|
| Latest  | Yes       |
| Older   | No        |

## Disclosure Policy

- Vulnerabilities will be patched before public disclosure
- Credit will be given to reporters unless anonymity is requested
- We aim to release fixes within 90 days of confirmed vulnerabilities

## License and Legal

Pankha is dual-licensed under [AGPL-3.0](LICENSE) and a [Commercial License](LICENSE-COMMERCIAL.md). Security fixes are released under the same dual-license terms.

Contributors submitting security fixes are subject to the [Contributor License Agreement](CLA.md), which grants the project the right to include fixes in both open-source and commercial distributions.
