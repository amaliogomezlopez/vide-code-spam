"""CLI entry point for the bundled backend executable."""

from __future__ import annotations

import argparse
import ipaddress


def main() -> None:
    from backend.app.config import get_settings

    settings = get_settings()
    parser = argparse.ArgumentParser()
    parser.add_argument("--host", default=settings.host)
    parser.add_argument("--port", type=int, default=settings.port)
    parser.add_argument(
        "--install-models",
        action="store_true",
        help="Download and warm up configured local STT models, then exit.",
    )
    args = parser.parse_args()

    if args.install_models:
        from backend.app.tools.install_models import main as install_models_main

        install_models_main([])
        return

    try:
        is_loopback = ipaddress.ip_address(args.host).is_loopback
    except ValueError:
        is_loopback = args.host.lower() == "localhost"
    if not is_loopback and not settings.vibe_spam_api_token and not settings.trusted_proxy_mode:
        parser.error(
            "Refusing a non-loopback bind without VIBE_SPAM_API_TOKEN or TRUSTED_PROXY_MODE"
        )

    import uvicorn

    # Ensure PyInstaller bundles the whole backend package.
    import backend.app.main  # noqa: F401

    uvicorn.run(
        "backend.app.main:app",
        host=args.host,
        port=args.port,
        log_level=settings.log_level,
    )


if __name__ == "__main__":
    main()
