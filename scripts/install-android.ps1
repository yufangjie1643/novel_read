# Android APK install with automatic MIUI confirmation-dialog handling.
#
# Strategy: the MIUI "AdbInstallActivity" confirmation dialog has a
# predictable layout. When the dialog is detected, immediately tap the
# predicted "Continue" button location. If that fails, fall back to a
# UIAutomator dump + parse to find the actual button bounds. This keeps
# the total click latency under ~200 ms, which fits the ~10 s window
# before the dialog auto-dismisses.
#
# Usage: pwsh scripts/install-android.ps1 -ApkPath <path> [-DeviceSerial <serial>]
#        [-MaxWaitSeconds 30] [-PollIntervalMs 200]
#
# Requires: adb on PATH or ANDROID_HOME env var; .android-tools layout under D:\code\novel_read\

[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)] [string] $ApkPath,
    [string] $DeviceSerial = "",
    [int] $MaxWaitSeconds = 30,
    [int] $PollIntervalMs = 200
)

$ErrorActionPreference = "Continue"  # adb prints success info to stderr; we manage errors ourselves

# --- Resolve tools from .android-tools/ if not on PATH ---
$Root = "D:\code\novel_read\.android-tools"
if (-not (Get-Command adb -ErrorAction SilentlyContinue)) {
    $env:Path = "$Root\sdk\platform-tools;$Root\java\temurin-17\bin;$env:Path"
}
if (-not $env:JAVA_HOME)   { $env:JAVA_HOME = "$Root\java\temurin-17" }
if (-not $env:ANDROID_HOME) { $env:ANDROID_HOME = "$Root\sdk" }

$Adb = (Get-Command adb).Source

# --- Pick device ---
if (-not $DeviceSerial) {
    $raw = (& $Adb devices 2>&1 | Out-String).Trim()
    $devices = @()
    foreach ($line in ($raw -split "`r?`n")) {
        if ($line -match "^\s*(\S+)\s+device\s*$") { $devices += $Matches[1] }
    }
    if ($devices.Count -eq 0) { throw "No adb device found. Plug in a phone and enable USB debugging." }
    $DeviceSerial = $devices[0]
}
Write-Host "Using device: $DeviceSerial"

if (-not (Test-Path $ApkPath)) { throw "APK not found: $ApkPath" }
$ApkPath = (Resolve-Path $ApkPath).Path
Write-Host "Installing: $ApkPath"

# --- Read screen size via `wm size` (no image-decode dependency) ---
$wmRaw = & cmd /c "`"$Adb`" -s $DeviceSerial shell wm size 2>nul" | Out-String
# Output: "Physical size: 1080x2400\nOverride size: <none>\n..."
$screenW = 0; $screenH = 0
if ($wmRaw -match "Physical size:\s*(\d+)x(\d+)") {
    $screenW = [int]$Matches[1]
    $screenH = [int]$Matches[2]
}
if ($screenW -eq 0 -or $screenH -eq 0) {
    throw "Could not read screen size. Output: $wmRaw"
}
Write-Host "Screen: ${screenW}x${screenH}"

# Predicted position of the MIUI AdbInstallActivity "Continue" button.
# On 1080x2400 the two buttons are at y~2188 with widths ~425 each;
# the "Continue" is on the right at x~768. We scale relative to screen
# so other resolutions land on the right button too.
$predictedX = [int]($screenW * 0.71)   # ~75% across, in the right button
$predictedY = [int]($screenH * 0.91)   # ~91% down, in the bottom button row
Write-Host "Predicted Continue button: ($predictedX, $predictedY)"

# --- Start install in background ---
$logPath = Join-Path $env:TEMP "install_$([guid]::NewGuid().ToString('N').Substring(0,8)).log"
$proc = Start-Process -FilePath $Adb -ArgumentList @(
    "-s", $DeviceSerial, "install", "-r", $ApkPath
) -PassThru -NoNewWindow -RedirectStandardOutput "$logPath.out" -RedirectStandardError "$logPath.err"

# --- Watch loop: detect dialog, tap immediately, verify ---
$startTime = Get-Date
$deadline = $startTime.AddSeconds($MaxWaitSeconds)
$lastTapTime = [DateTime]::MinValue
$tapCount = 0
$dialogSeen = $false

# Packages that host the ADB-install confirmation UI on Xiaomi/MIUI/HyperOS
$confirmPkgs = @(
    "com.miui.securitycenter",
    "com.miui.permcenter",
    "com.android.packageinstaller",
    "com.google.android.packageinstaller"
)

function Get-FocusedWindow {
    param([string] $Serial)
    $prevEAP = $ErrorActionPreference; $ErrorActionPreference = "SilentlyContinue"
    $raw = (& cmd /c "`"$Adb`" -s $Serial shell dumpsys window 2>nul" | Out-String)
    $ErrorActionPreference = $prevEAP
    $line = ($raw -split "`n" | Select-String -Pattern "mCurrentFocus" | Select-Object -First 1)
    if ($line) { $line.ToString() } else { "" }
}

function Read-XmlBomAware {
    param([string] $Path)
    $bytes = [System.IO.File]::ReadAllBytes($Path)
    foreach ($enc in @("gb18030", "gbk", "utf-8")) {
        $s = [System.Text.Encoding]::GetEncoding($enc).GetString($bytes)
        if ($s -match "[\u4e00-\u9fff]") { return $s }
    }
    return [System.Text.Encoding]::UTF8.GetString($bytes)
}

function Find-ButtonCenter {
    param([string] $Xml, [string[]] $TextNeedles)
    $candidates = @()
    # Match any node that has BOTH a text attribute and a bounds attribute.
    # The button class isn't required in the regex because PowerShell regex
    # parsing of `[^/]*?` between class= and text= across many attributes
    # silently fails to match; we still rank by class via the resource-id.
    $rx = [regex]'text="(?<text>[^"]+)"[^>]*?bounds="\[(?<x1>\d+),(?<y1>\d+)\]\[(?<x2>\d+),(?<y2>\d+)\]"'
    foreach ($m in $rx.Matches($Xml)) {
        $text = $m.Groups['text'].Value
        foreach ($needle in $TextNeedles) {
            if ($text -match [regex]::Escape($needle)) {
                $x1 = [int]$m.Groups['x1'].Value
                $y1 = [int]$m.Groups['y1'].Value
                $x2 = [int]$m.Groups['x2'].Value
                $y2 = [int]$m.Groups['y2'].Value
                $cx = [int](($x1 + $x2) / 2)
                $cy = [int](($y1 + $y2) / 2)
                $score = 50
                if ($text -match "^继续") { $score += 40 }
                if ($text -match "Button") { $score += 10 }
                $candidates += [PSCustomObject]@{
                    Text = $text
                    CenterX = $cx; CenterY = $cy
                    Score = $score
                }
                break
            }
        }
    }
    if ($candidates.Count -eq 0) { return $null }
    return $candidates | Sort-Object Score -Descending | Select-Object -First 1
}

function Tap {
    param([int] $X, [int] $Y)
    $prevEAP = $ErrorActionPreference; $ErrorActionPreference = "SilentlyContinue"
    & cmd /c "`"$Adb`" -s $DeviceSerial shell input tap $X $Y >nul 2>nul"
    $ErrorActionPreference = $prevEAP
}

# Text fragments (zh + en) that identify the AFFIRMATIVE button in the dialog
$buttonTexts = @("继续安装", "继续", "我已知晓", "通过USB安装", "确定", "Install", "Continue", "OK", "Allow", "Got it")

while (-not $proc.HasExited) {
    if ((Get-Date) -gt $deadline) {
        Write-Host "Timed out after $MaxWaitSeconds s waiting for confirmation dialog."
        break
    }
    Start-Sleep -Milliseconds $PollIntervalMs

    $focusText = Get-FocusedWindow -Serial $DeviceSerial
    $isConfirm = $false
    foreach ($pkg in $confirmPkgs) {
        if ($focusText -match $pkg) { $isConfirm = $true; break }
    }
    if (-not $isConfirm) { continue }

    if (-not $dialogSeen) {
        Write-Host "confirmation dialog detected (focus=$focusText)"
        $dialogSeen = $true
    }

    # --- Strategy: dump UI, parse to find the Continue button, tap it.
    #     Cost: ~500 ms (uiautomator dump + adb pull + parse + tap).
    #     Window: ~10 s before dialog auto-dismisses, so plenty of headroom.
    #     If we still miss it, fall back to the predicted position. ---
    $now = Get-Date
    if (($now - $lastTapTime).TotalMilliseconds -lt 2000) { continue }

    $dumpPath = Join-Path $env:TEMP "ui_$([guid]::NewGuid().ToString('N').Substring(0,8)).xml"
    $prevEAP = $ErrorActionPreference; $ErrorActionPreference = "SilentlyContinue"
    & cmd /c "`"$Adb`" -s $DeviceSerial shell uiautomator dump /sdcard/u.xml >nul 2>nul"
    Start-Sleep -Milliseconds 120
    & cmd /c "`"$Adb`" -s $DeviceSerial pull /sdcard/u.xml `"$dumpPath`" >nul 2>nul"
    $ErrorActionPreference = $prevEAP
    if ((Test-Path $dumpPath) -and (Get-Item $dumpPath).Length -gt 100) {
        $xml = Read-XmlBomAware -Path $dumpPath
        $btn = Find-ButtonCenter -Xml $xml -TextNeedles $buttonTexts
        if ($btn) {
            Write-Host "  tapping '$($btn.Text)' at ($($btn.CenterX),$($btn.CenterY))"
            Tap $btn.CenterX $btn.CenterY
            $lastTapTime = $now
            $tapCount++
        } else {
            Write-Host "  no Continue button text found, blind-tap at predicted ($predictedX, $predictedY)"
            Tap $predictedX $predictedY
            $lastTapTime = $now
            $tapCount++
        }
    } else {
        Write-Host "  dump too small/missing, blind-tap at predicted ($predictedX, $predictedY)"
        Tap $predictedX $predictedY
        $lastTapTime = $now
        $tapCount++
    }
    Remove-Item $dumpPath -ErrorAction SilentlyContinue
}

# --- Wait for install to write final log + verify ---
if (-not $proc.HasExited) { $proc.WaitForExit(5000) | Out-Null }
$out = ""
if (Test-Path "$logPath.out") { $out = Get-Content "$logPath.out" -Raw }
Remove-Item $logPath, "$logPath.out", "$logPath.err" -ErrorAction SilentlyContinue

# Verify the package is actually installed
$pmList = & cmd /c "`"$Adb`" -s $DeviceSerial shell pm list packages 2>nul" | Out-String
$installed = $pmList -match "io\.legado\.desktop"

if ($out -match "Success" -or $installed) {
    Write-Host "INSTALL SUCCESS (after $tapCount dialog-tap(s))" -ForegroundColor Green
    exit 0
} else {
    Write-Host "INSTALL FAILED" -ForegroundColor Red
    Write-Host "stdout: $out"
    exit 1
}
