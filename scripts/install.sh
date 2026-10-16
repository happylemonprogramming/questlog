#!/usr/bin/env bash
# Install Questlog for this user, so it shows up with your other apps and
# `questlog` works in a terminal. macOS and Linux; Windows has install.ps1.
#
# From anywhere, in one line:
#
#   curl -fsSL https://raw.githubusercontent.com/happylemonprogramming/questlog/main/scripts/install.sh | bash
#
# or from a checkout:
#
#   scripts/install.sh              install the latest release, or update to it
#   scripts/install.sh --yes        say yes to every question (Linux: the sandbox)
#   scripts/install.sh --uninstall  remove what it installed (your quests stay)
#
# Piped, options go after `bash -s --`. QUESTLOG_VERSION=v0.2.0 installs that
# release instead of the latest. For testing, QUESTLOG_ARCHIVE and
# QUESTLOG_SUMS install a local archive and SHA256SUMS instead of downloading.
#
# No sudo: Questlog goes under ~/.local (Linux) or ~/Applications (macOS).
# The one exception is Linux distros that stop apps from sandboxing
# themselves (Ubuntu 24.04 and later): there Electron's sandbox helper must
# belong to root, and you are asked first. See docs/install.md.
#
# Questlog does not bundle an agent: it uses Claude Code, Codex or OpenCode
# from your PATH. This only tells you which it found.
set -euo pipefail

QUESTLOG_REPO=${QUESTLOG_REPO:-happylemonprogramming/questlog}
QUESTLOG_VERSION=${QUESTLOG_VERSION:-}
QUESTLOG_ARCHIVE=${QUESTLOG_ARCHIVE:-}
QUESTLOG_SUMS=${QUESTLOG_SUMS:-}
# What `questlog update` runs again.
installer_url=https://raw.githubusercontent.com/$QUESTLOG_REPO/main/scripts/install.sh

bin_dir=$HOME/.local/bin
data=${XDG_DATA_HOME:-$HOME/.local/share}
# VERSION, the sandbox choice, and on Linux the app itself.
share=$data/questlog
desktop=$data/applications/questlog.desktop
icons=$data/icons/hicolor

say() { printf '\033[1m%s\033[0m\n' "$*"; }
warn() { printf '\033[33m%s\033[0m\n' "$*" >&2; }
die() { printf 'questlog install: %s\n' "$*" >&2; exit 1; }

yes=no
uninstall=no
for arg in "$@"; do
	case $arg in
	--yes | -y) yes=yes ;;
	--uninstall) uninstall=yes ;;
	--help | -h)
		sed -n '2,/^set -euo/p' "${BASH_SOURCE[0]:-}" 2>/dev/null | sed '$d; s/^# \{0,1\}//' ||
			echo "See https://github.com/$QUESTLOG_REPO/blob/main/docs/install.md"
		exit 0
		;;
	*) die "unknown option $arg" ;;
	esac
done

# Ask on the terminal even when this script arrives through a pipe.
confirm() {
	[ "$yes" = yes ] && return 0
	# /dev/tty exists without a terminal too, but then cannot be opened.
	{ : </dev/tty; } 2>/dev/null || return 1
	local answer
	printf '%s [Y/n] ' "$1" >/dev/tty
	read -r answer </dev/tty || return 1
	case $answer in "" | y | Y | yes) return 0 ;; *) return 1 ;; esac
}

# --- Which build --------------------------------------------------------------

arch=$(uname -m)
case $(uname -s) in
Linux)
	os=linux
	app=$share/app
	ext=tar.gz
	;;
Darwin)
	os=mac
	app=$HOME/Applications/Questlog.app
	ext=zip
	# A shell under Rosetta says x86_64 on an Apple Silicon Mac.
	[ "$(sysctl -n sysctl.proc_translated 2>/dev/null)" = 1 ] && arch=arm64
	;;
MINGW* | MSYS* | CYGWIN*) die "on Windows, in PowerShell: irm https://raw.githubusercontent.com/$QUESTLOG_REPO/main/scripts/install.ps1 | iex" ;;
*) die "Questlog runs on macOS, Linux and Windows, not $(uname -s)" ;;
esac
case $arch in
x86_64 | amd64) arch=x64 ;;
aarch64 | arm64) arch=arm64 ;;
*) die "there is no Questlog for $arch yet" ;;
esac
name=Questlog-$os-$arch.$ext

# --- The questlog command -------------------------------------------------------

# The command this installs, with the paths it was installed to. It does the
# uninstalling too, so --uninstall below and `questlog uninstall` are one.
launcher() {
	cat <<EOF
#!/usr/bin/env bash
# The questlog command, written by Questlog's installer:
#   $installer_url
set -euo pipefail
os=$(printf %q "$os")
app=$(printf %q "$app")
share=$(printf %q "$share")
bin=$(printf %q "$bin_dir/questlog")
desktop=$(printf %q "$desktop")
icons=$(printf %q "$icons")
installer=$(printf %q "$installer_url")
EOF
	cat <<'EOF'

usage() {
	cat <<USAGE
questlog              open Questlog (arguments are passed on to it)
questlog update       update to the latest release (QUESTLOG_VERSION=v0.2.0 for another)
questlog uninstall    remove Questlog; your workspace and app data stay
questlog --version    the version installed
USAGE
}

remove() {
	rm -rf "$app" "$share"
	rm -f "$desktop" "$icons/scalable/apps/questlog.svg" "$icons/512x512/apps/questlog.png"
	if [ "$os" = linux ]; then
		command -v update-desktop-database >/dev/null && update-desktop-database -q "$(dirname "$desktop")" || true
	fi
	rm -f "$bin"
	echo "Removed Questlog."
	local docs config
	docs=$(xdg-user-dir DOCUMENTS 2>/dev/null || echo "$HOME/Documents")
	if [ "$os" = mac ]; then
		config="$HOME/Library/Application Support/questlog"
	else
		config=${XDG_CONFIG_HOME:-$HOME/.config}/questlog
	fi
	echo "Your quests are kept. Delete these yourself if you want them gone too:"
	echo "  $docs/Questlog    your workspace"
	echo "  $config    app data"
}

launch() {
	if [ "$os" = mac ]; then
		open -a "$app" --args "$@"
		return
	fi
	# Chosen at install: see docs/install.md, "The Linux sandbox".
	local flags=()
	[ -f "$share/no-sandbox" ] && flags=(--no-sandbox)
	export CHROME_DESKTOP=questlog.desktop
	if command -v setsid >/dev/null; then
		setsid -f "$app/questlog" ${flags[@]+"${flags[@]}"} "$@" </dev/null >/dev/null 2>&1
	else
		nohup "$app/questlog" ${flags[@]+"${flags[@]}"} "$@" </dev/null >/dev/null 2>&1 &
	fi
}

case ${1:-} in
help | -h | --help) usage ;;
--version | -v | version) echo "Questlog $(cat "$share/VERSION" 2>/dev/null || echo unknown)" ;;
update)
	shift
	curl -fsSL "$installer" | bash -s -- "$@"
	;;
uninstall) remove ;;
*) launch "$@" ;;
esac
EOF
}

if [ "$uninstall" = yes ]; then
	bash -c "$(launcher)" questlog uninstall
	exit 0
fi

command -v curl >/dev/null || die "curl is needed to download Questlog"
if [ "$os" = linux ]; then
	command -v tar >/dev/null || die "tar is needed to unpack Questlog"
fi

# --- Download and check -----------------------------------------------------------

tmp=$(mktemp -d)
# The new copy being unpacked, and the old one being swapped out.
new=
old=
trap 'rm -rf "$tmp" ${new:+"$new"} ${old:+"$old"}' EXIT

if [ -n "$QUESTLOG_ARCHIVE" ]; then
	[ -n "$QUESTLOG_SUMS" ] || die "QUESTLOG_ARCHIVE needs QUESTLOG_SUMS too"
	version=${QUESTLOG_VERSION:-local}
	cp "$QUESTLOG_ARCHIVE" "$tmp/$name"
	cp "$QUESTLOG_SUMS" "$tmp/SHA256SUMS"
else
	version=$QUESTLOG_VERSION
	if [ -z "$version" ]; then
		# The latest release redirects to its tag; follow it, so the version
		# recorded is the one downloaded.
		latest=$(curl -fsSLI -o /dev/null -w '%{url_effective}' "https://github.com/$QUESTLOG_REPO/releases/latest") ||
			die "could not reach GitHub"
		version=${latest##*/}
		case $version in v*) ;; *) die "there is no Questlog release yet" ;; esac
	fi
	base=https://github.com/$QUESTLOG_REPO/releases/download/$version
	say "Downloading Questlog $version ($name)"
	curl -fL --progress-bar --proto '=https' "$base/$name" -o "$tmp/$name" ||
		die "could not download $base/$name"
	curl -fsSL --proto '=https' "$base/SHA256SUMS" -o "$tmp/SHA256SUMS" ||
		die "could not download $base/SHA256SUMS"
fi

expected=$(awk -v f="$name" '$2 == f || $2 == "*" f { print $1; exit }' "$tmp/SHA256SUMS")
[ -n "$expected" ] || die "SHA256SUMS has no line for $name"
if command -v sha256sum >/dev/null; then
	actual=$(sha256sum "$tmp/$name" | awk '{print $1}')
else
	actual=$(shasum -a 256 "$tmp/$name" | awk '{print $1}')
fi
[ "$actual" = "$expected" ] ||
	die "$name does not match its checksum (expected $expected, got $actual). Not installing it; try again, and report it if it keeps happening"

# --- The Linux sandbox ----------------------------------------------------------

# Chromium sandboxes its pages with user namespaces. Where the system does
# not allow those to ordinary programs (Ubuntu 24.04's AppArmor setting, or
# Debian's older sysctl), it needs its chrome-sandbox helper to belong to root
# with the setuid bit instead.
userns_allowed() {
	[ "$(cat /proc/sys/kernel/apparmor_restrict_unprivileged_userns 2>/dev/null)" = 1 ] && return 1
	[ "$(cat /proc/sys/kernel/unprivileged_userns_clone 2>/dev/null)" = 0 ] && return 1
	[ "$(cat /proc/sys/user/max_user_namespaces 2>/dev/null)" = 0 ] && return 1
	if command -v unshare >/dev/null; then
		unshare -Ur true 2>/dev/null || return 1
	fi
	return 0
}

# Sets up the sandbox for the app unpacked in $1, or records that Questlog
# opens without one.
sandbox() {
	rm -f "$share/no-sandbox"
	userns_allowed && return 0

	echo
	say "This system keeps apps from sandboxing themselves"
	echo "  Questlog, like every Electron app, sandboxes the pages it shows. Here that"
	echo "  needs its sandbox helper to belong to root, which takes sudo once:"
	echo "    sudo chown root:root $app/chrome-sandbox"
	echo "    sudo chmod 4755 $app/chrome-sandbox"
	if findmnt -no OPTIONS -T "$1" 2>/dev/null | grep -qw nosuid; then
		echo "  But $(dirname "$1") is on a nosuid filesystem, where that cannot work."
	elif confirm "Do that now?" &&
		sudo chown root:root "$1/chrome-sandbox" && sudo chmod 4755 "$1/chrome-sandbox"; then
		return 0
	fi
	touch "$share/no-sandbox"
	warn "Questlog will open with --no-sandbox: it works, but pages it shows are less"
	warn "isolated from your system. Run the installer again to set the sandbox up."
}

# --- Install ----------------------------------------------------------------------

mkdir -p "$share" "$bin_dir"

if [ "$os" = linux ]; then
	# Unpacked beside the old one and swapped in, so a failure leaves it as it was.
	new=$(mktemp -d "$share/app.new.XXXXXX")
	chmod 755 "$new"
	tar -xzf "$tmp/$name" -C "$new" --strip-components=1
	[ -x "$new/questlog" ] || die "$name has no questlog in it"
	sandbox "$new"
	old=$share/app.old.$$
	[ -e "$app" ] && mv "$app" "$old"
	mv "$new" "$app"
	new=

	install -Dm644 "$app/resources/icon.png" "$icons/512x512/apps/questlog.png"
	[ -f "$app/resources/icon.svg" ] && install -Dm644 "$app/resources/icon.svg" "$icons/scalable/apps/questlog.svg"
	mkdir -p "$(dirname "$desktop")"
	# The full path, because a launcher's PATH need not include ~/.local/bin.
	cat >"$desktop" <<EOF
[Desktop Entry]
Type=Application
Name=Questlog
GenericName=Job search
Comment=A calm quest log for your job search
Exec=$bin_dir/questlog %U
Icon=questlog
Terminal=false
Categories=Office;
StartupWMClass=questlog
EOF
	command -v update-desktop-database >/dev/null && update-desktop-database -q "$(dirname "$desktop")"
	command -v gtk-update-icon-cache >/dev/null && gtk-update-icon-cache -q -t "$icons" || true
else
	mkdir -p "$(dirname "$app")"
	new=$(mktemp -d "$(dirname "$app")/.Questlog.new.XXXXXX")
	# ditto keeps the bundle's symlinks and signature intact.
	ditto -x -k "$tmp/$name" "$new"
	[ -d "$new/Questlog.app" ] || die "$name has no Questlog.app in it"
	# A download by curl is not quarantined, but one copied over could be.
	xattr -dr com.apple.quarantine "$new/Questlog.app" 2>/dev/null || true
	old=$new/Questlog.old.app
	[ -e "$app" ] && mv "$app" "$old"
	mv "$new/Questlog.app" "$app"
fi

echo "$version" >"$share/VERSION"
launcher >"$bin_dir/questlog.new"
chmod 755 "$bin_dir/questlog.new"
mv "$bin_dir/questlog.new" "$bin_dir/questlog"

say "Installed Questlog $version"
if [ "$os" = mac ]; then
	echo "  $app"
fi
echo "  $bin_dir/questlog"
case ":$PATH:" in
*":$bin_dir:"*) ;;
*)
	# Shown to copy, so ~ stays as it is.
	# shellcheck disable=SC2088
	case ${SHELL:-} in
	*/zsh) rc='~/.zshrc' ;;
	*/fish) rc= ;;
	*) rc='~/.bashrc' ;;
	esac
	echo
	echo "  $bin_dir is not on your PATH: add it to use \`questlog\` in a terminal."
	if [ -n "$rc" ]; then
		echo "    echo 'export PATH=\"\$HOME/.local/bin:\$PATH\"' >> $rc"
	else
		echo "    fish_add_path ~/.local/bin"
	fi
	;;
esac

# --- Agents -------------------------------------------------------------------------

found=
for agent in claude codex opencode; do
	command -v "$agent" >/dev/null && found="$found $agent"
done
echo
if [ -n "$found" ]; then
	echo "Found your agent:$found. Questlog uses it from your PATH."
else
	echo "Questlog works with Claude Code, Codex or OpenCode; install any one of them."
	echo "OpenCode comes with free models:"
	echo "  curl -fsSL https://opencode.ai/install | bash"
fi

echo
if [ "$os" = mac ]; then
	echo "Open Questlog from Applications in your home folder, or: questlog"
else
	echo "Open Questlog from your app launcher, or: questlog"
fi
echo "'questlog help' lists the rest: update, uninstall, --version."
