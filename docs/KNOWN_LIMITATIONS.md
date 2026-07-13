# Known limitations

These limitations apply to the first public Windows release unless its release
notes explicitly say otherwise.

## Microphone permissions

Windows must allow desktop applications to use the microphone. The first use
may display a permission prompt. Corporate policies, privacy settings or an
exclusive audio device can prevent recording. Vibe Spam cannot override those
operating-system controls.

## Windows SmartScreen and unsigned binaries

The initial open-source builds are intentionally published without an
Authenticode certificate. Windows may show an “unknown publisher” or
SmartScreen warning. Download releases only from the official GitHub Releases
page and compare the file's SHA-256 checksum before running it. Never disable
SmartScreen globally.

## First model download and warmup

The `large-v3-turbo` speech model is not bundled. The first run needs internet
access and enough free disk space to download it into the user's cache. Later
runs can work offline. Dictation remains disabled while the model is loading;
CPU warmup can take several seconds and CUDA is normally much faster.

## CPU and CUDA are different downloads

The CPU build is the universal default and does not contain NVIDIA libraries.
It cannot switch to CUDA after installation. The CUDA build includes the
required runtime, is approximately 2.55 GiB unpacked, requires a compatible
NVIDIA GPU and falls back to CPU if its CUDA runtime cannot initialize.

## External coding CLIs

Vibe Spam orchestrates third-party CLIs but does not install, authenticate or
guarantee them. Their command names, login flows, terminal behavior and output
can change independently. Install and authenticate each CLI using its official
documentation. A custom executable path can be added when automatic detection
does not find it.

## Experimental platforms

Linux and macOS are experimental. CI compilation does not yet prove microphone,
PTY, packaging or process lifecycle behavior on real machines. Global dictation
into other applications currently depends on the Windows UI Automation helper
and is not supported equivalently on X11, Wayland or macOS Accessibility.

