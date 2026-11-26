param(
    [ValidateSet('Inspect','Discover','Observe','Capture','Recover')][string]$Mode = 'Inspect',
    [string]$Directory,
    [string]$FilterPath,
    [ValidateRange(1,64)][int]$TraceFileMB = 32,
    [ValidateRange(1,448)][int]$CaptureLimitMB = 448
)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
$OutputEncoding = [Text.UTF8Encoding]::new($false)
$pktmon = Join-Path $env:SystemRoot 'System32\PktMon.exe'
$logman = Join-Path $env:SystemRoot 'System32\logman.exe'
$idlePattern = '(?im)^\s*(Packet\s+Monitor\s+is\s+not\s+running|数据包监视器\s*(没有|未在|未)运行|封包監視器\s*(未|未在|沒有)(執行|運行))[.。]?\s*$'

function Invoke-PktMon([string[]]$Arguments) {
    $info = New-Object Diagnostics.ProcessStartInfo
    $info.FileName = $pktmon
    $info.Arguments = (@($Arguments | ForEach-Object {
        '"' + [regex]::Replace([regex]::Replace($_, '(\\*)"', '$1$1\"'), '(\\+)$', '$1$1') + '"'
    })) -join ' '
    $info.UseShellExecute = $false
    $info.CreateNoWindow = $true
    $info.RedirectStandardOutput = $true
    $info.RedirectStandardError = $true
    $info.StandardOutputEncoding = [Text.UTF8Encoding]::new($false)
    $info.StandardErrorEncoding = [Text.UTF8Encoding]::new($false)
    $process = New-Object Diagnostics.Process
    $process.StartInfo = $info
    try {
        [void]$process.Start()
        $stdout = $process.StandardOutput.ReadToEndAsync()
        $stderr = $process.StandardError.ReadToEndAsync()
        if (-not $process.WaitForExit(30000)) { $process.Kill(); throw '采集组件操作超时，原始文件已保留。' }
        if ($process.ExitCode -ne 0) { throw "采集组件操作失败。$($stderr.Result) $($stdout.Result)" }
        return $stdout.Result
    } finally { $process.Dispose() }
}

function Invoke-TraceControl([string[]]$Arguments) {
    $text = & $logman @Arguments 2>&1 | Out-String
    if ($LASTEXITCODE -ne 0) { throw ('轻量记录组件操作失败: ' + $text.Trim()) }
    return $text
}

$principal = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
$admin = $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if ($Mode -in @('Discover','Observe')) {
    $processes = @(Get-CimInstance Win32_Process | Where-Object {
        $_.Name -match '^(launcher|OverField|OverFieldClient|HD-Player|MuMuPlayer|MuMuVMMHeadless|NoxVMHandle|Ld9BoxHeadless)\.exe$'
    } | Where-Object { $_.ExecutablePath -and $_.ExecutablePath -notmatch '\\runtime\\OverField\.exe$' })
    if ($Mode -eq 'Observe') {
        @{ processes=@($processes | ForEach-Object { @{ pid=$_.ProcessId; path=$_.ExecutablePath; name=$_.Name } }) } | ConvertTo-Json -Depth 4 -Compress
        return
    }
    $ids = @($processes | ForEach-Object { $_.ProcessId })
    $connections = @(Get-NetTCPConnection -State Established -ErrorAction SilentlyContinue | Where-Object {
        $ids -contains $_.OwningProcess -and $_.RemoteAddress -notin @('0.0.0.0','::','127.0.0.1','::1') -and
        $_.RemotePort -notin @(80,443,53)
    } | ForEach-Object { @{ pid=$_.OwningProcess; ip=$_.RemoteAddress; port=$_.RemotePort } })
    $steamRoots=@(); $gameRoots=@()
    if ($Mode -eq 'Discover') {
    foreach ($key in @('HKCU:\Software\Valve\Steam','HKLM:\SOFTWARE\WOW6432Node\Valve\Steam')) {
        $entry=Get-ItemProperty -LiteralPath $key -ErrorAction SilentlyContinue
        if ($entry.SteamPath) { $steamRoots+=,$entry.SteamPath }
        if ($entry.InstallPath) { $steamRoots+=,$entry.InstallPath }
    }
    foreach ($drive in @(Get-CimInstance Win32_LogicalDisk -Filter 'DriveType=3' -ErrorAction SilentlyContinue)) {
        foreach ($leaf in @('TapTap\PC Games','Program Files\TapTap\PC Games','Program Files (x86)\TapTap\PC Games','Games','Bilibili\Games','bilibili Game','SteamLibrary\steamapps\common','Steam\steamapps\common')) {
            $path=Join-Path ($drive.DeviceID+'\') $leaf
            if (Test-Path -LiteralPath $path -PathType Container) { $gameRoots+=,$path }
        }
    }
    foreach ($registry in @('HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*','HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\*','HKLM:\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*')) {
        foreach ($entry in @(Get-ItemProperty -Path $registry -ErrorAction SilentlyContinue | Where-Object { $_.DisplayName -match 'TapTap|开放空间|Over.?Field|Bilibili' })) {
            if ($entry.InstallLocation -and (Test-Path -LiteralPath $entry.InstallLocation -PathType Container)) {
                $gameRoots+=,$entry.InstallLocation
                $gameRoots+=,(Join-Path $entry.InstallLocation 'PC Games')
            }
        }
    }
    }
    @{ steamRoots=$steamRoots; gameRoots=$gameRoots; processes=@($processes | ForEach-Object { @{ pid=$_.ProcessId; path=$_.ExecutablePath; name=$_.Name } }); connections=$connections } | ConvertTo-Json -Depth 5 -Compress
    return
}
if (-not (Test-Path -LiteralPath $pktmon -PathType Leaf)) { throw '当前 Windows 缺少系统采集组件。仍可离线分析已有账号 ZIP。' }
if ($Mode -eq 'Inspect') {
    if (-not $admin) { @{ admin=$false; pktmon=$true; idle=$false; filtersEmpty=$false } | ConvertTo-Json -Compress; return }
    $status = Invoke-PktMon @('status')
    $filters = Invoke-PktMon @('filter','list')
    $empty = $filters -match '(?im)^\s*(none|无|無|no (packet )?filters( configured)?)\s*[.。]?\s*$'
    @{ admin=$admin; pktmon=$true; idle=($status -match $idlePattern); filtersEmpty=$empty } | ConvertTo-Json -Compress
    return
}
if (-not $admin) { throw '实时采集需要管理员权限。请右键采集工具，选择「以管理员身份运行」。离线分析不需要提权。' }
if (-not (Test-Path -LiteralPath $Directory -PathType Container)) { throw '采集目录不存在。' }
if ($Mode -eq 'Recover') {
    if ((Invoke-PktMon @('status')) -notmatch $idlePattern) { throw '采集组件仍在运行，请先在所属窗口结束采集。恢复不会停止任何活动会话。' }
} else {
    $options = Get-Content -LiteralPath $FilterPath -Raw -Encoding UTF8 | ConvertFrom-Json
    if (@($options.filters).Count -lt 1 -or @($options.filters).Count -gt 32) { throw '采集筛选范围无效。' }
    $mutex = New-Object Threading.Mutex($false, 'Global\OverFieldBackupCapture')
    $owned=$false; $started=$false; $names=@(); $compact=$false; $traceCreated=$false
    $trace='OFBackup_'+[guid]::NewGuid().ToString('N')
    $etl = Join-Path $Directory 'capture.etl'
    try {
        try { $owned=$mutex.WaitOne(0) } catch [Threading.AbandonedMutexException] { $owned=$true }
        if (-not $owned) { throw '另一个备份工具正在采集，请在原窗口结束。' }
        if ((Invoke-PktMon @('status')) -notmatch $idlePattern -or
            (Invoke-PktMon @('filter','list')) -notmatch '(?im)^\s*(none|无|無|no (packet )?filters( configured)?)\s*[.。]?\s*$') {
            throw '采集组件已有会话或筛选器。请在所属工具结束，不会清理其他工具的会话。'
        }
        foreach ($filter in $options.filters) {
            $name='OFDesktop_'+[guid]::NewGuid().ToString('N').Substring(0,12)
            $arguments=@('filter','add',$name,'-t','TCP')
            if ($filter.ip) {
                $address=$null
                if (-not [Net.IPAddress]::TryParse($filter.ip,[ref]$address) -or $filter.ip.Contains('%')) { throw 'IP 格式无效。' }
                $arguments+=@('-i',"$($filter.ip)")
            }
            if ($filter.port) {
                if ($filter.port -lt 1 -or $filter.port -gt 65535) { throw '端口范围无效。' }
                $arguments+=@('-p',"$($filter.port)")
            }
            if (-not $filter.ip -and -not $filter.port) { throw '禁止空筛选器。' }
            [void](Invoke-PktMon $arguments)
            $names+=,$name
        }
        # Share buffers across processors: a timed flush otherwise writes one
        # mostly empty 128-KiB buffer per active CPU. Keep the buffer large enough
        # for full-size ETW events, and keep the continuous newfile session.
        try {
            $storage='shared-buffer'
            try {
                # NEWFILE | NO_PER_PROCESSOR_BUFFERING. No circular overwrite.
                New-EtwTraceSession -Name $trace -LogFileMode 0x10000008 -LocalFilePath (Join-Path $Directory 'capture%d.etl') -MaximumFileSize $TraceFileMB -BufferSize 128 -MinimumBuffers 16 -MaximumBuffers 256 -FlushTimer 1 | Out-Null
                $traceCreated=$true
                Add-EtwTraceProvider -SessionName $trace -Guid '{4d4f80d9-c8bd-4d73-bb5b-19c90402c5ac}' -MatchAnyKeyword 0x12 -Level 255 | Out-Null
            } catch {
                if ($traceCreated) {
                    [void](Invoke-TraceControl @('stop',$trace,'-ets'))
                    $traceCreated=$false
                }
                $storage='per-cpu-buffer'
                [void](Invoke-TraceControl @('create','trace',$trace,'-ets','-p','Microsoft-Windows-PktMon','0x12','-bs','128','-nb','16','256','-ft','00:00:01','-mode','newfile','-max',"$TraceFileMB",'-o',(Join-Path $Directory 'capture%d.etl')))
                $traceCreated=$true
            }
            $compact=$true
            [IO.File]::WriteAllText((Join-Path $Directory 'trace-session.json'), (@{ logger=$trace; backend='compact-etw'; storage=$storage; buffer_kib=128; flush_seconds=1 } | ConvertTo-Json -Compress))
            [Console]::WriteLine('CAPTURE_STORAGE_'+$storage)
        } catch {
            if ($traceCreated) { throw }
            [Console]::WriteLine('CAPTURE_BACKEND_BUFFERED')
        }
        if ($compact) {
            # This small circular bootstrap configures the driver. The separate
            # ETW session above is the continuous, lossless packet record.
            [void](Invoke-PktMon @('start','--capture','--comp','nics','--pkt-size','0','--file-size','1','--log-mode','circular','--file-name',(Join-Path $Directory 'bootstrap.etl')))
            [Console]::WriteLine('CAPTURE_BACKEND_COMPACT')
        } else {
            [void](Invoke-PktMon @('start','--capture','--comp','nics','--pkt-size','0','--file-size','64','--log-mode','multi-file','--file-name',$etl))
        }
        $started=$true
        [Console]::WriteLine('CAPTURE_STARTED')
        # Console.In is a synchronized TextReader on Windows PowerShell 5.1:
        # ReadLineAsync can block synchronously, preventing all limit checks.
        $stopByte=New-Object byte[] 1
        $read=[Console]::OpenStandardInput().ReadAsync($stopByte,0,1)
        $clock=[Diagnostics.Stopwatch]::StartNew()
        while (-not $read.IsCompleted -and -not (Test-Path -LiteralPath (Join-Path $Directory 'stop.flag'))) {
            $size=(Get-ChildItem -LiteralPath $Directory -Filter 'capture*.etl' | Measure-Object -Property Length -Sum).Sum
            if ($size -ge ($CaptureLimitMB * 1MB) -or $clock.Elapsed.TotalMinutes -ge 30) { [Console]::WriteLine('CAPTURE_LIMIT'); break }
            Start-Sleep -Milliseconds 500
        }
    } finally {
        try { [IO.File]::WriteAllText((Join-Path $Directory 'live-progress-stop.flag'), '') } catch {}
        try {
            if ($started) {
                $current=Invoke-PktMon @('status')
                if ($current.Contains($Directory)) { [void](Invoke-PktMon @('stop')) }
                elseif ($current -notmatch $idlePattern) { throw '采集任务归属改变，已保留原始文件，请在原诊断工具处理。' }
            }
            if ((Invoke-PktMon @('status')) -match $idlePattern) {
                foreach ($name in $names) { [void](Invoke-PktMon @('filter','remove',$name)) }
            }
        } finally {
            try {
                if ($traceCreated) {
                    # This unique session name was created by this process only.
                    # No wildcard stop/delete and no persistent collector set.
                    [void](Invoke-TraceControl @('stop',$trace,'-ets'))
                }
            } finally {
                if ($owned) { $mutex.ReleaseMutex() }
                $mutex.Dispose()
            }
        }
    }
}
[Console]::WriteLine('CAPTURE_CONVERTING')
$parts=@(Get-ChildItem -LiteralPath $Directory -Filter 'capture*.etl' | Sort-Object LastWriteTimeUtc,Name)
if ($parts.Count -eq 0) { throw '未找到原始 ETL，无法恢复。' }
$pcap=Join-Path $Directory 'capture.pcapng'
$pending=$pcap+'.tmp'
$target=[IO.File]::Create($pending)
try {
    foreach ($part in $parts) {
        [Console]::WriteLine('CAPTURE_CONVERT_PART '+($parts.IndexOf($part)+1)+'/'+$parts.Count)
        $converted=Join-Path $Directory ($part.BaseName+'.converted.pcapng')
        [void](Invoke-PktMon @('etl2pcap',$part.FullName,'--out',$converted))
        $source=[IO.File]::OpenRead($converted)
        try { $source.CopyTo($target) } finally { $source.Dispose() }
    }
} finally { $target.Dispose() }
Move-Item -LiteralPath $pending -Destination $pcap -Force
[Console]::WriteLine('CAPTURE_SAVED')
