param([Parameter(Mandatory=$true)][string]$RuntimePackage, [string]$NativeInputs)
$ErrorActionPreference='Stop'
$root=Split-Path $PSScriptRoot -Parent
$spec=Get-Content -LiteralPath (Join-Path $root 'capture-build-inputs.json') -Raw -Encoding UTF8 | ConvertFrom-Json
if ((Get-FileHash -LiteralPath $RuntimePackage -Algorithm SHA256).Hash.ToLowerInvariant() -ne $spec.runtime_package_sha256) { throw 'Runtime package checksum mismatch' }
Add-Type -AssemblyName System.IO.Compression.FileSystem
$tools=Join-Path $root '.tools'
New-Item -ItemType Directory -Force -Path $tools | Out-Null
function Write-ZipEntry($entry,[string]$destination) {
    New-Item -ItemType Directory -Force -Path (Split-Path $destination -Parent) | Out-Null
    $inputStream=$entry.Open(); $outputStream=[IO.File]::Create($destination)
    try { $inputStream.CopyTo($outputStream) } finally { $inputStream.Dispose(); $outputStream.Dispose() }
}
$zip=[IO.Compression.ZipFile]::OpenRead((Resolve-Path -LiteralPath $RuntimePackage).Path)
try {
    $prefix='OverField-Capture-'+$spec.version+'-Windows-x64/'
    foreach ($entry in $zip.Entries) {
        if (-not $entry.FullName.StartsWith($prefix) -or $entry.FullName.EndsWith('/')) { continue }
        $rel=$entry.FullName.Substring($prefix.Length); $dest=$null
        if ($rel.StartsWith('resources/dependencies/')) { $dest=Join-Path $tools ('capture-toolkit/'+$rel.Substring('resources/dependencies/'.Length)) }
        elseif ($rel -eq 'runtime/node.exe') { $dest=Join-Path $tools 'node/node.exe' }
        elseif ($rel -eq 'licenses/Node.txt') { $dest=Join-Path $tools 'native/Node-LICENSE.txt' }
        if ($dest) {
            $absolute=[IO.Path]::GetFullPath($dest)
            if (-not $absolute.StartsWith([IO.Path]::GetFullPath($tools)+'\',[StringComparison]::OrdinalIgnoreCase)) { throw 'Invalid dependency path' }
            Write-ZipEntry $entry $absolute
        }
    }
} finally { $zip.Dispose() }
$sdkArchive=$null
try {
    foreach ($file in $spec.native_files) {
        $dest=Join-Path $tools ('native/'+$file.path)
        New-Item -ItemType Directory -Force -Path (Split-Path $dest -Parent) | Out-Null
        if ($NativeInputs) { Copy-Item -LiteralPath (Join-Path $NativeInputs $file.path) -Destination $dest }
        elseif ($file.url) { Invoke-WebRequest -Uri $file.url -OutFile $dest -UseBasicParsing }
        else {
            if (-not $sdkArchive) {
                $sdk=Join-Path $tools 'webview2.nupkg'
                Invoke-WebRequest -Uri $spec.webview2_url -OutFile $sdk -UseBasicParsing
                if ((Get-FileHash -LiteralPath $sdk -Algorithm SHA256).Hash.ToLowerInvariant() -ne $spec.webview2_sha256) { throw 'SDK checksum mismatch' }
                $sdkArchive=[IO.Compression.ZipFile]::OpenRead($sdk)
            }
            $entry=$sdkArchive.GetEntry($file.path.Substring('webview2/'.Length))
            if (-not $entry) { throw 'Missing SDK entry' }
            Write-ZipEntry $entry $dest
        }
        if ((Get-FileHash -LiteralPath $dest -Algorithm SHA256).Hash.ToLowerInvariant() -ne $file.sha256) { throw ('Native input checksum mismatch: '+$file.path) }
    }
} finally { if ($sdkArchive) { $sdkArchive.Dispose() } }
$env:OVERFIELD_CAPTURE_TOOLKIT=Join-Path $tools 'capture-toolkit'
$env:OVERFIELD_NODE_RUNTIME=Join-Path $tools 'node/node.exe'
$env:PATH=(Join-Path $env:OVERFIELD_CAPTURE_TOOLKIT 'tools/python')+';'+$env:PATH
$env:ELECTRON_SKIP_BINARY_DOWNLOAD='1'
Push-Location -LiteralPath $root
try {
    & npm.cmd --prefix desktop ci --registry=https://registry.npmjs.org
    if ($LASTEXITCODE -ne 0) { throw 'npm install failed' }
    Push-Location -LiteralPath (Join-Path $root 'desktop')
    try {
        & $env:OVERFIELD_NODE_RUNTIME node_modules/vite/bin/vite.js build
        if ($LASTEXITCODE -ne 0) { throw 'UI build failed' }
    } finally { Pop-Location }
    & $env:OVERFIELD_NODE_RUNTIME desktop/package.mjs --role=capture ('--version='+$spec.version)
    if ($LASTEXITCODE -ne 0) { throw 'Capture packaging failed' }
} finally { Pop-Location }
