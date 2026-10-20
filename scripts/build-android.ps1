param(
    [switch]$NativeOnly,
    [ValidateSet('release', 'debug')][string]$Profile = 'release',
    [ValidateSet('aarch64', 'armv7', 'i686', 'x86_64')][string]$Target = 'aarch64'
)
$ErrorActionPreference = 'Stop'
$repo = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$android = Join-Path $repo 'src-tauri/gen/android'

function Run-Checked([string]$Command, [string[]]$Arguments) {
    & $Command @Arguments
    if ($LASTEXITCODE -ne 0) { throw "$Command failed with exit code $LASTEXITCODE" }
}

function Get-Sha256([string]$Path) {
    $stream = [IO.File]::OpenRead($Path)
    $sha = [Security.Cryptography.SHA256]::Create()
    try { return [BitConverter]::ToString($sha.ComputeHash($stream)).Replace('-', '') }
    finally { $stream.Dispose(); $sha.Dispose() }
}

Push-Location $repo
try {
    if ($NativeOnly) {
        if (!$env:NDK_HOME) { throw 'NDK_HOME must point to the Android NDK' }
        $triples = @{ aarch64 = 'aarch64-linux-android'; armv7 = 'armv7-linux-androideabi'; i686 = 'i686-linux-android'; x86_64 = 'x86_64-linux-android' }
        $abis = @{ aarch64 = 'arm64-v8a'; armv7 = 'armeabi-v7a'; i686 = 'x86'; x86_64 = 'x86_64' }
        $triple = $triples[$Target]
        $prefix = if ($Target -eq 'armv7') { 'armv7a-linux-androideabi' } else { $triple }
        $bin = Join-Path $env:NDK_HOME 'toolchains/llvm/prebuilt/windows-x86_64/bin'
        $clang = Join-Path $bin ($prefix + '24-clang.cmd')
        if (!(Test-Path -LiteralPath $clang)) { throw "Missing compiler: $clang" }
        $suffix = $triple.Replace('-', '_')
        [Environment]::SetEnvironmentVariable("CC_$suffix", $clang, 'Process')
        [Environment]::SetEnvironmentVariable("CXX_$suffix", (Join-Path $bin ($prefix + '24-clang++.cmd')), 'Process')
        [Environment]::SetEnvironmentVariable("AR_$suffix", (Join-Path $bin 'llvm-ar.exe'), 'Process')
        [Environment]::SetEnvironmentVariable("CARGO_TARGET_$($suffix.ToUpper())_LINKER", $clang, 'Process')
        $tempDir = Join-Path $repo '.build-temp'
        New-Item -ItemType Directory -Path $tempDir -Force | Out-Null
        $env:TEMP = $tempDir
        $env:TMP = $tempDir
        if ($Profile -eq 'debug') { $env:TAURI_DEBUG = 'true' } else { Remove-Item Env:TAURI_DEBUG -ErrorAction SilentlyContinue }
        Run-Checked 'npm.cmd' @('run', 'build')
        $targetDir = Join-Path $repo 'src-tauri/target'
        if (Test-Path -LiteralPath $targetDir) {
            # New Cargo releases require a cache marker for caches created by older toolchains.
            $resolvedTarget = (Resolve-Path -LiteralPath $targetDir).Path
            if ($resolvedTarget -ne [IO.Path]::GetFullPath($targetDir)) { throw 'Unexpected Cargo target directory' }
            $marker = Join-Path $targetDir 'CACHEDIR.TAG'
            if (!(Test-Path -LiteralPath $marker)) {
                if (!(Test-Path -LiteralPath (Join-Path $targetDir '.rustc_info.json'))) { throw 'Refusing to clean a directory without Cargo cache metadata' }
                [IO.File]::WriteAllText($marker, "Signature: 8a477f597d28d172789f06886806bc55`n", [Text.Encoding]::ASCII)
            }
        }
        $cargoArgs = @('--manifest-path', (Join-Path $repo 'src-tauri/Cargo.toml'), '--target', $triple, '--target-dir', $targetDir)
        $profileArgs = if ($Profile -eq 'release') { @('--release') } else { @() }
        # Clean only this app, retaining dependency caches. This also rebuilds embedded dist assets.
        if (Test-Path -LiteralPath $targetDir) {
            Run-Checked 'cargo' (@('clean', '--package', 'Answer_Test') + $cargoArgs + $profileArgs)
        }
        Run-Checked 'cargo' (@('build', '--features', 'custom-protocol') + $cargoArgs + $profileArgs)
        $source = Join-Path $targetDir "$triple/$Profile/libanswer_test_lib.so"
        $destinationDir = Join-Path $android "app/src/main/jniLibs/$($abis[$Target])"
        New-Item -ItemType Directory -Path $destinationDir -Force | Out-Null
        $destination = Join-Path $destinationDir 'libanswer_test_lib.so'
        Copy-Item -LiteralPath $source -Destination $destination -Force
        if ((Get-Sha256 $source) -ne (Get-Sha256 $destination)) { throw 'JNI library hash mismatch' }
        Write-Host "Fresh native library: $destination"
    } else {
        if ($Target -ne 'aarch64') { throw 'This app currently packages arm64 only' }
        # Run native compilation outside the JVM (some Windows hosts deny Java child processes).
        & $PSCommandPath -NativeOnly -Target $Target -Profile $Profile
        $source = Join-Path $repo "src-tauri/target/aarch64-linux-android/$Profile/libanswer_test_lib.so"
        $nativeHash = Get-Sha256 $source
        $variant = if ($Profile -eq 'release') { 'Release' } else { 'Debug' }
        Run-Checked (Join-Path $android 'gradlew.bat') @('-p', $android, ":app:assembleArm64$variant", "-PverifiedNativeSha256=$nativeHash", '--no-daemon', '--no-build-cache', '--console=plain')
        [Reflection.Assembly]::LoadWithPartialName('System.IO.Compression.FileSystem') | Out-Null
        $outputDir = Join-Path $android "app/build/outputs/apk/arm64/$Profile"
        $appVersion = (Get-Content -LiteralPath (Join-Path $repo 'src-tauri/tauri.conf.json') -Raw -Encoding UTF8 | ConvertFrom-Json).version
        $apks = @(Get-ChildItem -LiteralPath $outputDir -Filter "Answer_Test_v$appVersion-arm64-$Profile.apk")
        if ($apks.Count -ne 1) { throw "Expected exactly one APK in $outputDir" }
        $source = Join-Path $repo "src-tauri/target/aarch64-linux-android/$Profile/libanswer_test_lib.so"
        $zip = [IO.Compression.ZipFile]::OpenRead($apks[0].FullName)
        try {
            $entry = $zip.GetEntry('lib/arm64-v8a/libanswer_test_lib.so')
            if (!$entry) { throw 'APK is missing its arm64 native library' }
            $stream = $entry.Open()
            $sha = [Security.Cryptography.SHA256]::Create()
            try { $hash = [BitConverter]::ToString($sha.ComputeHash($stream)).Replace('-', '') }
            finally { $stream.Dispose(); $sha.Dispose() }
            if ($hash -ne (Get-Sha256 $source)) { throw 'APK contains a stale or altered native library' }
        } finally { $zip.Dispose() }
        Write-Host "Verified APK (native SHA256 $hash): $($apks[0].FullName)"
    }
} finally { Pop-Location }
