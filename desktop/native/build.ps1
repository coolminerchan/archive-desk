param([switch]$TestHost, [ValidateSet('shared','server','client','capture')][string]$Product = 'shared')
$ErrorActionPreference = 'Stop'
$project = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
$nativeTools = Join-Path $project '.tools/native'
$output = Join-Path $nativeTools 'build'
$nativeDefine = if ($TestHost) { '/DOVERFIELD_TEST_HOST ' } else { '' }
$destination = if ($TestHost) { 'DesktopHost.Test.exe' } elseif ($Product -eq 'shared') { 'DesktopHost.exe' } else { 'DesktopHost.' + $Product + '.exe' }
$icon = if ($Product -eq 'shared') { 'assets/app.ico' } else { 'assets/app-' + $Product + '.ico' }
New-Item -ItemType Directory -Force -Path $output | Out-Null
$vcvars = 'C:/Program Files (x86)/Microsoft Visual Studio/2022/BuildTools/VC/Auxiliary/Build/vcvars64.bat'
$stageParent = [IO.Path]::GetFullPath([IO.Path]::GetTempPath())
$stage = Join-Path $stageParent ('of-native-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $stage | Out-Null
try {
    Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'host.cpp') -Destination (Join-Path $stage 'host.cpp')
    Copy-Item -LiteralPath (Join-Path $PSScriptRoot $icon) -Destination (Join-Path $stage 'app.ico')
    Copy-Item -LiteralPath (Join-Path $nativeTools 'json.hpp') -Destination (Join-Path $stage 'json.hpp')
    Copy-Item -LiteralPath (Join-Path $nativeTools 'webview2/build/native/include/WebView2.h') -Destination (Join-Path $stage 'WebView2.h')
    Copy-Item -LiteralPath (Join-Path $nativeTools 'webview2/build/native/x64/WebView2LoaderStatic.lib') -Destination (Join-Path $stage 'WebView2LoaderStatic.lib')
    [IO.File]::WriteAllText((Join-Path $stage 'host.rc'), '101 ICON "app.ico"', [Text.Encoding]::ASCII)
    $lines = @(
        '@echo off',
        ('call "' + $vcvars + '" >nul'),
        'if errorlevel 1 exit /b %errorlevel%',
        'rc /nologo /fo host.res host.rc',
        'if errorlevel 1 exit /b %errorlevel%',
        ('cl /nologo ' + $nativeDefine + '/std:c++17 /EHsc /utf-8 /O2 /MT /DUNICODE /D_UNICODE /I. host.cpp /Fohost.obj /FeDesktopHost.exe /link /SUBSYSTEM:WINDOWS WebView2LoaderStatic.lib host.res user32.lib gdi32.lib ole32.lib shell32.lib shlwapi.lib comdlg32.lib advapi32.lib dwmapi.lib version.lib')
    )
    [IO.File]::WriteAllLines((Join-Path $stage 'compile.cmd'), $lines, [Text.Encoding]::ASCII)
    Push-Location -LiteralPath $stage
    try { & cmd.exe /d /c compile.cmd; $code = $LASTEXITCODE } finally { Pop-Location }
    if ($code -ne 0) { throw 'Native host compilation failed' }
    Copy-Item -LiteralPath (Join-Path $stage 'DesktopHost.exe') -Destination (Join-Path $output $destination) -Force
    Write-Output (Join-Path $output $destination)
} finally {
    $resolved = [IO.Path]::GetFullPath($stage)
    if ($resolved.StartsWith($stageParent.TrimEnd('\') + '\', [StringComparison]::OrdinalIgnoreCase) -and
        [IO.Path]::GetFileName($resolved).StartsWith('of-native-')) {
        Remove-Item -LiteralPath $resolved -Recurse -Force
    }
}
