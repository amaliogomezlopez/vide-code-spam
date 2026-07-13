# Contributing to Vibe Spam

Thanks for helping improve Vibe Spam. Keep changes focused, cross-platform and
safe for a desktop application that can launch local processes.

By participating, you agree to follow the [Code of Conduct](CODE_OF_CONDUCT.md).
Use the issue templates for reproducible bugs and proposals. Security findings
must follow [SECURITY.md](SECURITY.md), never a public issue.

## Development setup

1. Create a Python 3.11 or 3.12 virtual environment.
2. Install backend tooling with `pip install -e "backend[dev]"`.
3. Run `npm ci` in `frontend/`.
4. Copy `.env.example` to `.env` only when local overrides are needed.

## Required checks

```powershell
python -m ruff check backend
python -m mypy --config-file backend\pyproject.toml backend\app
python -m pytest backend\tests
cd frontend
npm run lint
npm test
npm run build
npm run electron:compile
```

Do not commit `.env`, API keys, model weights, generated installers, portable
folders or backend bundles. Document user-visible changes in `CHANGELOG.md`.

Security-sensitive changes should include a regression test covering both the
rejected unsafe input and the preserved legitimate behavior.

## Pull requests

- Start from an issue for substantial behavior or architecture changes.
- Keep one concern per pull request and explain the user impact.
- Preserve strict TypeScript and Python type hints.
- Add tests for fixes and update documentation for changed workflows.
- Do not claim stable Linux/macOS support based only on CI compilation.
- Never commit `.env`, credentials, recordings, model caches or generated
  installers.

Maintainers may request smaller scope, additional evidence or platform testing
before merging. All contributions are accepted under the repository's MIT
license.
