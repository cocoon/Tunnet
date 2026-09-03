param(
    [string]$Peer = "10.7.0.2",
    [int]$Duration = 10,
    [string]$Product = "tunnet",
    [string]$TunnetApi = "http://127.0.0.1:8899"
)

$ErrorActionPreference = "Continue"

$iperf3 = "$env:USERPROFILE\bin\iperf3\iperf3.exe"
if (-not (Test-Path $iperf3)) {
    $iperf3 = (Get-Command iperf3.exe -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Source)
}
if (-not $iperf3) {
    Write-Host "iperf3.exe not found. Download from: https://github.com/ar51an/iperf3-win-builds/releases" -ForegroundColor Red
    exit 1
}

$ResultsDir = ".\bench-results\$(Get-Date -Format 'yyyyMMdd-HHmmss')-$Product"
New-Item -ItemType Directory -Path $ResultsDir -Force | Out-Null
$Summary = @()

function Get-PathState {
    $state = [ordered]@{ product = $Product; direct = "unknown"; detail = "" }
    if ($Product -eq "tunnet") {
        try {
            $status = Invoke-RestMethod -Uri "$TunnetApi/api/status" -TimeoutSec 5
            $state.direct = "$($status.path_state)"
            $state.detail = "$($status.selected_path)"
        } catch {
            $state.detail = "tunnet api unreachable: $_"
        }
        try {
            $zt = Get-Command zerotier-cli -ErrorAction SilentlyContinue
            if ($zt) { $state.detail += " | zt: $(zerotier-cli peers 2>$null | Select-Object -First 5)" }
        } catch {}
    } else {
        try {
            $peers = zerotier-cli peers 2>$null
            $state.detail = ($peers | Select-Object -First 8) -join "`n"
            if ($peers -match "DIRECT") { $state.direct = "direct" } elseif ($peers -match "RELAY") { $state.direct = "relay" }
        } catch { $state.detail = "zerotier-cli unavailable" }
    }
    $state | ConvertTo-Json -Compress | Out-File "$ResultsDir\path-state.json" -Append
    return $state
}

function Get-Percentiles([double[]]$Samples) {
    if ($Samples.Count -eq 0) { return $null }
    $s = $Samples | Sort-Object
    function pct([double]$p) { $s[[math]::Min($s.Count - 1, [math]::Floor($p * $s.Count))] }
    return [ordered]@{
        count = $s.Count
        min = [math]::Round($s[0], 2); p50 = [math]::Round((pct 0.50), 2)
        p95 = [math]::Round((pct 0.95), 2); p99 = [math]::Round((pct 0.99), 2)
        max = [math]::Round($s[-1], 2)
    }
}

function Invoke-Iperf([string]$Args, [string]$OutFile) {
    $full = "$iperf3 $Args --json"
    cmd /c "$full" | Out-File $OutFile -Encoding utf8
    try { return Get-Content $OutFile -Raw | ConvertFrom-Json } catch { return $null }
}

Write-Host "=== Tunnet Benchmark v2 ($Product) ===" -ForegroundColor Cyan
Write-Host "Peer: $Peer | Duration: ${Duration}s | iperf3: $iperf3"
$pathState = Get-PathState
Write-Host "Path: $($pathState.direct) $($pathState.detail)"
Write-Host "Results: $ResultsDir`n"

# 0. Connectivity + idle latency (high sample count for percentiles)
Write-Host "[0] Idle latency (100x ping)..." -ForegroundColor Yellow
$pingAll = Test-Connection -ComputerName $Peer -Count 100 -ErrorAction SilentlyContinue
if (-not $pingAll) { Write-Host "  FAIL: $Peer unreachable" -ForegroundColor Red; exit 1 }
$idle = Get-Percentiles ($pingAll | ForEach-Object { [double]$_.Latency })
$idle | ConvertTo-Json | Out-File "$ResultsDir\ping-idle.json"
Write-Host "  idle: p50=$($idle.p50)ms p95=$($idle.p95)ms p99=$($idle.p99)ms max=$($idle.max)ms"
$pingAll | Export-Csv "$ResultsDir\ping-idle.csv" -NoTypeInformation

# 1. Throughput: TCP 1 / 4 streams, up / down / bidir
Write-Host "`n[1] Throughput matrix..." -ForegroundColor Yellow
$tp = @{}
$cases = @(
    @{ name = "tcp-up-1"; args = "-c $Peer -t $Duration -P 1" },
    @{ name = "tcp-up-4"; args = "-c $Peer -t $Duration -P 4" },
    @{ name = "tcp-down-1"; args = "-c $Peer -t $Duration -P 1 -R" },
    @{ name = "tcp-down-4"; args = "-c $Peer -t $Duration -P 4 -R" }
)
foreach ($c in $cases) {
    $j = Invoke-Iperf $c.args "$ResultsDir\$($c.name).json"
    if ($j -and -not $j.error) {
        $mbps = [math]::Round($j.end.sum_received.bits_per_second / 1e6, 1)
        $retr = 0; try { $retr = ($j.end.sum_sent.retransmits) } catch {}
        $tp[$c.name] = @{ mbps = $mbps; retransmits = $retr }
        Write-Host "  $($c.name): $mbps Mbps (retransmits=$retr)"
        $Summary += "$($c.name)=$mbps Mbps/retr=$retr"
    } else { Write-Host "  $($c.name): ERROR $($j.error)" -ForegroundColor Red }
}
# Bidirectional (iperf3 --bidir)
$j = Invoke-Iperf "-c $Peer -t $Duration -P 4 --bidir" "$ResultsDir\tcp-bidir.json"
if ($j -and -not $j.error) {
    Write-Host "  tcp-bidir: up=$([math]::Round($j.server_output_text.Length / 1, 1)) (see json)"
}

$capacityUp = if ($tp["tcp-up-4"]) { $tp["tcp-up-4"].mbps } else { 50.0 }
$capacityDown = if ($tp["tcp-down-4"]) { $tp["tcp-down-4"].mbps } else { 50.0 }
Write-Host "  measured capacity: up=${capacityUp}Mbps down=${capacityDown}Mbps"

# 2. Loaded latency sweep at fractions of measured capacity
Write-Host "`n[2] Loaded-latency sweep (fraction of measured capacity)..." -ForegroundColor Yellow
$fractions = @(0.25, 0.50, 0.75, 0.90, 1.00, 1.10)
$loadResults = @()
foreach ($f in $fractions) {
    $rate = [math]::Round($capacityUp * $f, 1)
    $pct = [int]($f * 100)
    Write-Host "  ${pct}% (${rate}Mbps up)..."
    $job = Start-Job -ScriptBlock { param($exe, $p, $d, $r) & $exe -c $p -t $d -u -b "${r}M" --json 2>&1 } -ArgumentList $iperf3, $Peer, $Duration, $rate
    Start-Sleep 2
    $n = [math]::Max(10, [math]::Min($Duration * 4, 60))
    $lp = Test-Connection -ComputerName $Peer -Count $n -ErrorAction SilentlyContinue
    $loadJson = Receive-Job $job -Wait -AutoRemoveJob | Out-String
    try {
        $lj = $loadJson | ConvertFrom-Json
        $actual = [math]::Round($lj.end.sum.bits_per_second / 1e6, 1)
        $loss = [math]::Round($lj.end.sum.lost_percent, 2)
    } catch { $actual = -1; $loss = -1 }
    $lat = Get-Percentiles ($lp | ForEach-Object { [double]$_.Latency })
    $row = [ordered]@{ fraction = $f; offered_mbps = $rate; actual_mbps = $actual; loss_pct = $loss; latency = $lat }
    $loadResults += $row
    $row | ConvertTo-Json -Depth 4 -Compress | Out-File "$ResultsDir\loaded-latency.jsonl" -Append
    Write-Host "    actual=${actual}Mbps loss=${loss}% p50=$($lat.p50)ms p95=$($lat.p95)ms p99=$($lat.p99)ms max=$($lat.max)ms"
    if ($actual -gt 0 -and $actual -lt $rate * 0.7 -and $f -le 1.0) {
        Write-Host "    WARNING: load generator under-delivered (>30% shortfall); latency number is suspect" -ForegroundColor Yellow
    }
}

# 3. UDP sweep: rates x packet sizes
Write-Host "`n[3] UDP sweep..." -ForegroundColor Yellow
$udpRates = @(0.25, 0.50, 1.00) | ForEach-Object { [math]::Round($capacityUp * $_, 1) }
$udpLens = @(64, 256, 1200)
foreach ($rate in $udpRates) {
    foreach ($len in $udpLens) {
        $j = Invoke-Iperf "-c $Peer -u -b ${rate}M -l $len -t $Duration" "$ResultsDir\udp-${rate}M-${len}B.json"
        if ($j -and -not $j.error) {
            $s = $j.end.sum
            $pps = [math]::Round($s.packets_received / $Duration, 0)
            Write-Host ("  offered={0}Mbps len={1}B delivered={2}Mbps pps={3} loss={4}% jitter={5}ms" -f $rate, $len,
                [math]::Round($s.bits_per_second / 1e6, 1), $pps,
                [math]::Round($s.lost_percent, 2), [math]::Round($s.jitter_ms, 3))
        }
    }
}

# 4. Path state, repeated at end (detect migration mid-run)
$pathEnd = Get-PathState
Write-Host "`nPath end: $($pathEnd.direct)"

Write-Host "`n========================================" -ForegroundColor Cyan
Write-Host "  Product:      $Product"
Write-Host "  Idle:         p50=$($idle.p50)ms p95=$($idle.p95)ms p99=$($idle.p99)ms"
foreach ($r in $loadResults) {
    Write-Host ("  Load {0}%: actual={1}Mbps p50={2}ms p95={3}ms p99={4}ms max={5}ms" -f ([int]($r.fraction * 100)), $r.actual_mbps, $r.latency.p50, $r.latency.p95, $r.latency.p99, $r.latency.max)
}
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "Results saved: $ResultsDir" -ForegroundColor Green
