# Installing Questlog

Questlog installs for your user only, with no admin rights, from the latest
GitHub release.

**macOS and Linux**, in a terminal:

```sh
curl -fsSL https://raw.githubusercontent.com/happylemonprogramming/questlog/main/scripts/install.sh | bash
```

**Windows**, in PowerShell:

```powershell
irm https://raw.githubusercontent.com/happylemonprogramming/questlog/main/scripts/install.ps1 | iex
```

The installer downloads the build for your system, checks it against the
release's `SHA256SUMS` (and refuses it if it doesn't match), and adds Questlog
to your apps along with a `questlog` command. To install a particular release
instead of the latest, set `QUESTLOG_VERSION`:

```sh
curl -fsSL .../install.sh | QUESTLOG_VERSION=v0.2.0 bash
```

```powershell
$env:QUESTLOG_VERSION = 'v0.2.0'; irm .../install.ps1 | iex
```

Options for `install.sh` go after `bash -s --`, for example
`curl -fsSL .../install.sh | bash -s -- --yes`. `--yes` answers yes to
every question.

Questlog doesn't bundle an agent. It uses whichever of Claude Code, Codex or
OpenCode it finds on your PATH. If you have none of them, OpenCode comes with
free models:

```sh
curl -fsSL https://opencode.ai/install | bash
```

## The `questlog` command

```
questlog              open Questlog (arguments are passed on to it)
questlog update       update to the latest release
questlog uninstall    remove Questlog; your workspace and app data stay
questlog --version    the version installed
questlog help
```

`questlog` opens the app and returns right away. You can also run the
installer again to update: it replaces the app in place. On Linux and macOS,
`~/.local/bin` has to be on your PATH. If it isn't, the installer tells you
the line to add. On Windows the installer adds its `bin` folder to your user
PATH, so `questlog` works in new terminals.

## Uninstalling

`questlog uninstall`, or:

```sh
curl -fsSL .../install.sh | bash -s -- --uninstall
```

```powershell
$env:QUESTLOG_UNINSTALL = 1; irm .../install.ps1 | iex
```

Uninstalling never touches your quests. Delete these yourself if you want
them gone too:

|                  | Your workspace           | App data                                 |
| ---------------- | ------------------------ | ---------------------------------------- |
| Linux            | `~/Documents/Questlog`   | `~/.config/questlog`                     |
| macOS            | `~/Documents/Questlog`   | `~/Library/Application Support/questlog` |
| Windows          | `Documents\Questlog`     | `%APPDATA%\questlog`                     |

## Where things go

| | Linux | macOS | Windows |
| --- | --- | --- | --- |
| The app | `~/.local/share/questlog/app` | `~/Applications/Questlog.app` | `%LOCALAPPDATA%\Programs\Questlog\app` |
| The command | `~/.local/bin/questlog` | `~/.local/bin/questlog` | `%LOCALAPPDATA%\Programs\Questlog\bin\questlog.cmd` |
| Version | `~/.local/share/questlog/VERSION` | `~/.local/share/questlog/VERSION` | `%LOCALAPPDATA%\Programs\Questlog\VERSION` |
| In your apps | `~/.local/share/applications/questlog.desktop`, icons in `~/.local/share/icons/hicolor` | Applications in your home folder | Start Menu shortcut |

Updates unpack the new version next to the old one and then swap it in, so if
an update fails, the copy you already had still works.

## The Linux sandbox

Like every Electron app, Questlog sandboxes the pages it shows, and on Linux
that sandbox uses user namespaces. Some distros don't let ordinary programs
create them. Ubuntu 23.10 and later restrict them through AppArmor
(`kernel.apparmor_restrict_unprivileged_userns=1`), and some older kernels
use `kernel.unprivileged_userns_clone=0`. On those, the sandbox helper
(`chrome-sandbox` in the app folder) has to be owned by root with the setuid
bit set.

The installer checks for this. If the helper needs to be changed, it explains
why and asks before running these two commands with sudo:

```sh
sudo chown root:root ~/.local/share/questlog/app/chrome-sandbox
sudo chmod 4755 ~/.local/share/questlog/app/chrome-sandbox
```

If you say no, or the installer is piped without a terminal and without
`--yes`, Questlog opens with `--no-sandbox` instead. It still works, but the
pages it shows are less isolated from your system, and the installer prints a
warning. The installer records this choice as
`~/.local/share/questlog/no-sandbox`, and the `questlog` command reads it.
Each update brings a fresh `chrome-sandbox`, so if the sandbox needs this
setting, the installer asks again.

## macOS signing

Questlog isn't notarized because there's no Apple Developer certificate. The
app is signed ad hoc, which Apple Silicon requires before it will run anything.
Files that `curl` downloads aren't quarantined, so Gatekeeper doesn't block
them, and the installer removes the `com.apple.quarantine` flag anyway. If you
download a zip from the releases page in a browser instead, macOS will refuse
to open it. Right-click Questlog.app and choose Open, or run
`xattr -dr com.apple.quarantine Questlog.app`.

## Cutting a release

Bump `version` in `package.json` and `desktop/package.json`, commit, then:

```sh
git tag v0.1.0 && git push --tags
```

`.github/workflows/release.yml` typechecks the web app, then builds these on
GitHub's runners:

- `Questlog-linux-x64.tar.gz` and `Questlog-linux-arm64.tar.gz`
- `Questlog-mac-arm64.zip` and `Questlog-mac-x64.zip`
- `Questlog-win-x64.zip`

It writes `SHA256SUMS` for those files and publishes everything as the
release for the tag. These are the names the installers download. To try a
build without releasing it, run the workflow by hand from the Actions tab: it
keeps the files as artifacts of the run.

To build one locally, for this machine's platform:

```sh
npm --prefix desktop run dist -- --linux --publish never   # or --mac, --win
```

The archives end up in `desktop/dist/`. To try the installer on one without a
release, point it at the archive and a checksum file:

```sh
cd desktop/dist && sha256sum Questlog-linux-x64.tar.gz > SHA256SUMS
QUESTLOG_ARCHIVE=$PWD/Questlog-linux-x64.tar.gz QUESTLOG_SUMS=$PWD/SHA256SUMS ../../scripts/install.sh
```
