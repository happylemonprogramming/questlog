# Install Questlog for this user on Windows, with a Start Menu shortcut and a
# `questlog` command. No admin needed.
#
# In PowerShell, in one line:
#
#   irm https://raw.githubusercontent.com/happylemonprogramming/questlog/main/scripts/install.ps1 | iex
#
# or from a checkout:
#
#   scripts\install.ps1              install the latest release, or update to it
#   scripts\install.ps1 -Uninstall   remove what it installed (your quests stay)
#
# Piped through iex there are no parameters, so the environment stands in:
# QUESTLOG_UNINSTALL=1 uninstalls, QUESTLOG_VERSION=v0.2.0 installs that
# release instead of the latest. For testing, QUESTLOG_ARCHIVE and
# QUESTLOG_SUMS install a local zip and SHA256SUMS instead of downloading.
#
# Questlog goes in %LOCALAPPDATA%\Programs\Questlog: the app in app\, the
# command in bin\ (added to your user PATH), and VERSION. It does not bundle
# an agent: it uses Claude Code, Codex or OpenCode from your PATH.
#
# Works in Windows PowerShell 5.1. No `exit` here: under iex it would close
# the PowerShell window.
param([switch]$Uninstall)

$QuestlogRepo = if ($env:QUESTLOG_REPO) { $env:QUESTLOG_REPO } else { 'happylemonprogramming/questlog' }

# The questlog command's PowerShell half, written to bin\questlog.ps1; bin\
# questlog.cmd opens the app itself and hands the rest to this. It does the
# uninstalling too, so -Uninstall and `questlog uninstall` are one.
$QuestlogShim = @'
# The questlog command, written by Questlog's installer.
$ErrorActionPreference = 'Stop'
$Root = Join-Path $env:LOCALAPPDATA 'Programs\Questlog'
$App = Join-Path $Root 'app'
$Bin = Join-Path $Root 'bin'
$Shortcut = Join-Path ([Environment]::GetFolderPath('Programs')) 'Questlog.lnk'
$Installer = 'https://raw.githubusercontent.com/__REPO__/main/scripts/install.ps1'

function Remove-Questlog {
    $running = Get-Process -Name Questlog -ErrorAction SilentlyContinue |
        Where-Object { $_.Path -and $_.Path.StartsWith($App, [StringComparison]::OrdinalIgnoreCase) }
    if ($running) { throw 'Questlog is open: close it, then uninstall again.' }

    $path = [Environment]::GetEnvironmentVariable('Path', 'User')
    if ($path) {
        $kept = ($path -split ';' | Where-Object { $_ -and $_.TrimEnd('\') -ne $Bin }) -join ';'
        if ($kept -ne $path) { [Environment]::SetEnvironmentVariable('Path', $kept, 'User') }
    }
    Remove-Item -LiteralPath $Shortcut -Force -ErrorAction SilentlyContinue
    if (Test-Path -LiteralPath $Root) { Remove-Item -LiteralPath $Root -Recurse -Force }

    Write-Host 'Removed Questlog.'
    Write-Host 'Your quests are kept. Delete these yourself if you want them gone too:'
    Write-Host "  $(Join-Path ([Environment]::GetFolderPath('MyDocuments')) 'Questlog')    your workspace"
    Write-Host "  $(Join-Path $env:APPDATA 'questlog')    app data"
}

$command = if ($args.Count) { [string]$args[0] } else { '' }
switch ($command) {
    { $_ -in 'help', '-h', '--help' } {
        Write-Host 'questlog              open Questlog (arguments are passed on to it)'
        Write-Host 'questlog update       update to the latest release ($env:QUESTLOG_VERSION="v0.2.0" for another)'
        Write-Host 'questlog uninstall    remove Questlog; your workspace and app data stay'
        Write-Host 'questlog --version    the version installed'
    }
    { $_ -in 'version', '-v', '--version' } {
        $version = Get-Content -LiteralPath (Join-Path $Root 'VERSION') -ErrorAction SilentlyContinue
        Write-Host "Questlog $(if ($version) { $version } else { 'unknown' })"
    }
    'update' { Invoke-RestMethod $Installer | Invoke-Expression }
    'uninstall' { Remove-Questlog }
    default {
        $exe = Join-Path $App 'Questlog.exe'
        if ($args.Count) { Start-Process -FilePath $exe -ArgumentList $args } else { Start-Process -FilePath $exe }
    }
}
'@
$QuestlogShim = $QuestlogShim.Replace('__REPO__', $QuestlogRepo)

# Opens the app straight away; the rest goes to questlog.ps1. The powershell
# line ends the script on the same line, because uninstall deletes this file.
$QuestlogCmd = @'
@echo off
rem The questlog command, written by Questlog's installer.
if "%~1"=="" goto open
for %%c in (help -h --help version -v --version update uninstall) do if /i "%~1"=="%%c" goto ps
:open
start "" "%~dp0..\app\Questlog.exe" %*
exit /b
:ps
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0questlog.ps1" %* & exit /b
'@

function Install-Questlog {
    $ErrorActionPreference = 'Stop'
    # Windows PowerShell 5.1 draws its progress bar so slowly it slows downloads.
    $ProgressPreference = 'SilentlyContinue'
    [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12

    $root = Join-Path $env:LOCALAPPDATA 'Programs\Questlog'
    $app = Join-Path $root 'app'
    $bin = Join-Path $root 'bin'

    if ($Uninstall -or $env:QUESTLOG_UNINSTALL -eq '1') {
        & ([scriptblock]::Create($QuestlogShim)) uninstall
        return
    }

    $arch = if ($env:PROCESSOR_ARCHITEW6432) { $env:PROCESSOR_ARCHITEW6432 } else { $env:PROCESSOR_ARCHITECTURE }
    # Windows on Arm runs the x64 build under emulation.
    if ($arch -notin 'AMD64', 'ARM64') { throw "there is no Questlog for $arch Windows" }
    $name = 'Questlog-win-x64.zip'

    # --- Download and check ---------------------------------------------------

    $tmp = Join-Path ([IO.Path]::GetTempPath()) ("questlog-" + [Guid]::NewGuid())
    New-Item -ItemType Directory -Path $tmp | Out-Null
    $new = Join-Path $root 'app.new'
    $old = Join-Path $root 'app.old'
    try {
        if ($env:QUESTLOG_ARCHIVE) {
            if (-not $env:QUESTLOG_SUMS) { throw 'QUESTLOG_ARCHIVE needs QUESTLOG_SUMS too' }
            $version = if ($env:QUESTLOG_VERSION) { $env:QUESTLOG_VERSION } else { 'local' }
            Copy-Item -LiteralPath $env:QUESTLOG_ARCHIVE (Join-Path $tmp $name)
            Copy-Item -LiteralPath $env:QUESTLOG_SUMS (Join-Path $tmp 'SHA256SUMS')
        } else {
            $version = $env:QUESTLOG_VERSION
            if (-not $version) {
                try {
                    $version = (Invoke-RestMethod "https://api.github.com/repos/$QuestlogRepo/releases/latest").tag_name
                } catch {
                    throw "could not find the latest release of $QuestlogRepo ($($_.Exception.Message))"
                }
            }
            $base = "https://github.com/$QuestlogRepo/releases/download/$version"
            Write-Host "Downloading Questlog $version ($name)" -ForegroundColor White
            Invoke-WebRequest "$base/$name" -OutFile (Join-Path $tmp $name) -UseBasicParsing
            Invoke-WebRequest "$base/SHA256SUMS" -OutFile (Join-Path $tmp 'SHA256SUMS') -UseBasicParsing
        }

        $expected = $null
        foreach ($line in Get-Content -LiteralPath (Join-Path $tmp 'SHA256SUMS')) {
            $hash, $file = $line -split '\s+\*?', 2
            if ($file -eq $name) { $expected = $hash; break }
        }
        if (-not $expected) { throw "SHA256SUMS has no line for $name" }
        $actual = (Get-FileHash -LiteralPath (Join-Path $tmp $name) -Algorithm SHA256).Hash
        if ($actual -ne $expected) {
            throw "$name does not match its checksum (expected $expected, got $actual). Not installing it; try again, and report it if it keeps happening"
        }

        # --- Install ----------------------------------------------------------

        # Unpacked beside the old one and swapped in, so a failure leaves it as it was.
        New-Item -ItemType Directory -Path $root -Force | Out-Null
        foreach ($dir in $new, $old) {
            if (Test-Path -LiteralPath $dir) { Remove-Item -LiteralPath $dir -Recurse -Force }
        }
        # Far faster than Expand-Archive in Windows PowerShell 5.1.
        Add-Type -AssemblyName System.IO.Compression.FileSystem
        [IO.Compression.ZipFile]::ExtractToDirectory((Join-Path $tmp $name), $new)
        if (-not (Test-Path -LiteralPath (Join-Path $new 'Questlog.exe'))) {
            $inner = Get-ChildItem -LiteralPath $new -Directory | Where-Object { Test-Path -LiteralPath (Join-Path $_.FullName 'Questlog.exe') } | Select-Object -First 1
            if (-not $inner) { throw "$name has no Questlog.exe in it" }
            $new = $inner.FullName
        }
        if (Test-Path -LiteralPath $app) {
            try {
                Rename-Item -LiteralPath $app -NewName 'app.old'
            } catch {
                throw 'Questlog is open: close it, then run this again.'
            }
        }
        Move-Item -LiteralPath $new -Destination $app
        if (Test-Path -LiteralPath $old) { Remove-Item -LiteralPath $old -Recurse -Force -ErrorAction SilentlyContinue }

        Set-Content -LiteralPath (Join-Path $root 'VERSION') -Value $version -Encoding ASCII
        New-Item -ItemType Directory -Path $bin -Force | Out-Null
        Set-Content -LiteralPath (Join-Path $bin 'questlog.ps1') -Value $QuestlogShim -Encoding ASCII
        # cmd.exe misreads labels in a batch file with bare LF line endings.
        Set-Content -LiteralPath (Join-Path $bin 'questlog.cmd') -Value ($QuestlogCmd -replace "`r?`n", "`r`n") -Encoding ASCII

        # On the user's PATH, for new terminals, and this one.
        $path = [Environment]::GetEnvironmentVariable('Path', 'User')
        $entries = if ($path) { $path -split ';' | Where-Object { $_ } } else { @() }
        if (-not ($entries | Where-Object { $_.TrimEnd('\') -eq $bin })) {
            [Environment]::SetEnvironmentVariable('Path', (@($entries) + $bin) -join ';', 'User')
        }
        if (-not (($env:Path -split ';') -contains $bin)) { $env:Path = "$env:Path;$bin" }

        $exe = Join-Path $app 'Questlog.exe'
        $shell = New-Object -ComObject WScript.Shell
        $link = $shell.CreateShortcut((Join-Path ([Environment]::GetFolderPath('Programs')) 'Questlog.lnk'))
        $link.TargetPath = $exe
        $link.WorkingDirectory = $app
        $link.IconLocation = "$exe,0"
        $link.Description = 'A calm quest log for your job search'
        $link.Save()
    } finally {
        Remove-Item -LiteralPath $tmp -Recurse -Force -ErrorAction SilentlyContinue
        $leftover = Join-Path $root 'app.new'
        if (Test-Path -LiteralPath $leftover) { Remove-Item -LiteralPath $leftover -Recurse -Force -ErrorAction SilentlyContinue }
    }

    Write-Host "Installed Questlog $version" -ForegroundColor White
    Write-Host "  $app"
    Write-Host "  $bin\questlog.cmd (on your PATH in new terminals)"

    # --- Agents ---------------------------------------------------------------

    $found = @('claude', 'codex', 'opencode') | Where-Object { Get-Command $_ -ErrorAction SilentlyContinue }
    Write-Host ''
    if ($found) {
        Write-Host "Found your agent: $($found -join ', '). Questlog uses it from your PATH."
    } else {
        Write-Host 'Questlog works with Claude Code, Codex or OpenCode; install any one of them.'
        Write-Host 'OpenCode comes with free models: https://opencode.ai'
    }
    Write-Host ''
    Write-Host 'Open Questlog from the Start Menu, or: questlog'
    Write-Host "'questlog help' lists the rest: update, uninstall, --version."
}

try {
    Install-Questlog
} catch {
    Write-Host "questlog install: $($_.Exception.Message)" -ForegroundColor Red
}
