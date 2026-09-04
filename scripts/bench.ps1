param(
    [string]$Peer = "10.7.0.2",
    [int]$Duration = 10,
    [string]$Product = "tunnet",
    [string]$TunnetApi = "http://127.0.0.1:8899",
    [int]$Repeats = 2,
    [int]$Mtu = 0,
    # Independent iperf3 server ports per direction: two simultaneous
    # clients against one default port conflict (single active test per
    # listener). The server side must listen on both ports.
    [int]$ServerPortUp = 5201,
    [int]$ServerPortDown = 5202
)

# Tunnet Benchmark v3 — structured, repeatable, hard to lie with.
# Schema (shared with bench.sh): every scenario appends one JSON object per
# line to results.jsonl with fields:
#   {ts, product, scenario, direction, fraction, offered_mbps, actual_mbps,
#    loss_pct, retransmits, latency:{n,p50,p95,p99,p999,max}, path:{...},
#    meta:{...}, note, valid}
# Throughput matrix (TCP 1/4, up/down/bidir with explicit JSON parse),
# loaded-latency sweeps per direction plus full-duplex bidir at fractions
# of independently measured directional capacity (download load uses -R),
# UDP rate x size sweep, warmup + repeats, path-state capture before/after
# every scenario (results flagged on migration). p99.9 only with >=1000
# samples, else null. Loaded scenarios use 200 Test-Connection samples:
# p50/p95/p99 are meaningful, p999 is null BY DESIGN (1000+ ICMP echoes per
# fraction via Test-Connection would take minutes; Bash uses 1000 fast
# pings for real p99.9 — see bench.sh). Failed loads mark valid=false.

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
$Jsonl = "$ResultsDir\results.jsonl"

function Get-Meta {
    $sha = ""
    try { $sha = (git rev-parse --short HEAD 2>$null).Trim() } catch {}
    $cpu = (Get-CimInstance Win32_Processor | Select-Object -First 1).Name
    return [ordered]@{
        commit = $sha; mtu = $Mtu; os = (Get-CimInstance Win32_OperatingSystem).Caption
        cpu = $cpu; peer = $Peer; duration_s = $Duration
    }
}
$META = Get-Meta
$META_JSON = $META | ConvertTo-Json -Compress

function Get-PathState {
    $state = [ordered]@{ product = $Product; mode = "unknown"; detail = "" }
    if ($Product -eq "tunnet") {
        try {
            $status = Invoke-RestMethod -Uri "$TunnetApi/api/status" -TimeoutSec 5
            $state.mode = "$($status.path_state)"; $state.detail = "$($status.selected_path)"
        } catch { $state.detail = "tunnet api unreachable" }
    } else {
        try {
            $peers = zerotier-cli peers 2>$null
            $state.detail = (($peers | Select-Object -First 6) -join " | ")
            if ($peers -match "DIRECT") { $state.mode = "direct" } elseif ($peers -match "RELAY") { $state.mode = "relay" }
        } catch { $state.detail = "zerotier-cli unavailable" }
    }
    return $state
}

function Write-Row([hashtable]$row) {
    $row["ts"] = (Get-Date -Format o); $row["product"] = $Product; $row["meta"] = $META
    ($row | ConvertTo-Json -Depth 6 -Compress) | Out-File $Jsonl -Append -Encoding utf8
}

function Get-Percentiles([double[]]$Samples) {
    if ($Samples.Count -eq 0) { return $null }
    $s = $Samples | Sort-Object
    function pct([double]$p) { $s[[math]::Min($s.Count - 1, [math]::Floor($p * $s.Count))] }
    $o = [ordered]@{ count = $s.Count; min = [math]::Round($s[0], 2); p50 = [math]::Round((pct 0.50), 2); p95 = [math]::Round((pct 0.95), 2); p99 = [math]::Round((pct 0.99), 2); max = [math]::Round($s[-1], 2) }
    # p99.9 needs >=1000 samples to mean anything.
    if ($s.Count -ge 1000) { $o["p999"] = [math]::Round((pct 0.999), 2) } else { $o["p999"] = $null }
    return $o
}

function Invoke-IperfJson([string]$Args, [string]$OutFile) {
    & $iperf3 ($Args.Split(" ") + "--json") 2>$null | Out-File $OutFile -Encoding utf8
    try { return Get-Content $OutFile -Raw | ConvertFrom-Json } catch { return $null }
}

# High-frequency latency probe: rapid ping for p99.9-grade sample counts.
function Measure-Latency([int]$Count, [int]$GapMs) {
    $samples = @()
    for ($i = 0; $i -lt $Count; $i++) {
        $r = Test-Connection -ComputerName $Peer -Count 1 -ErrorAction SilentlyContinue
        if ($r) { $samples += [double]$r.Latency }
        if ($GapMs -gt 0) { Start-Sleep -Milliseconds $GapMs }
    }
    return Get-Percentiles $samples
}

Write-Host "=== Tunnet Benchmark v3 ($Product) ===" -ForegroundColor Cyan
Write-Host "Peer: $Peer | Duration: ${Duration}s | Repeats: $Repeats | Results: $ResultsDir"

# --- connectivity + warmup ---
Write-Host "[0] Connectivity + warmup..." -ForegroundColor Yellow
$ping = Test-Connection -ComputerName $Peer -Count 4 -ErrorAction SilentlyContinue
if (-not $ping) { Write-Host "  FAIL: $Peer unreachable" -ForegroundColor Red; exit 1 }
& $iperf3 -c $Peer -t 5 -P 2 2>&1 | Out-Null
Write-Host "  OK, warmed up"

# --- idle latency: 1200 samples for real p99.9 ---
Write-Host "[1] Idle latency (1200 samples)..." -ForegroundColor Yellow
$idle = Measure-Latency 1200 5
Write-Host "  idle: p50=$($idle.p50)ms p95=$($idle.p95)ms p99=$($idle.p99)ms p999=$($idle.p999)ms max=$($idle.max)ms"
Write-Row @{ scenario = "idle"; direction = "none"; path = (Get-PathState); latency = $idle }

# --- throughput matrix with repeats; explicit bidir parse ---
Write-Host "[2] Throughput matrix..." -ForegroundColor Yellow
$tpCases = @(
    @{ name = "tcp-up-1"; args = "-c $Peer -p $ServerPortUp -t $Duration -P 1"; dir = "up" },
    @{ name = "tcp-up-4"; args = "-c $Peer -p $ServerPortUp -t $Duration -P 4"; dir = "up" },
    @{ name = "tcp-down-1"; args = "-c $Peer -p $ServerPortDown -t $Duration -P 1 -R"; dir = "down" },
    @{ name = "tcp-down-4"; args = "-c $Peer -p $ServerPortDown -t $Duration -P 4 -R"; dir = "down" }
)
$cap = @{ up = 0.0; down = 0.0 }
foreach ($rep in 1..$Repeats) {
    foreach ($c in $tpCases) {
        $pathBefore = Get-PathState
        $j = Invoke-IperfJson $c.args "$ResultsDir\$($c.name)-r$rep.json"
        if ($j -and -not $j.error) {
            $mbps = [math]::Round($j.end.sum_received.bits_per_second / 1e6, 1)
            $retr = 0; try { $retr = [int]$j.end.sum_sent.retransmits } catch {}
            $sentMbps = 0; try { $sentMbps = [math]::Round($j.end.sum_sent.bits_per_second / 1e6, 1) } catch {}
            Write-Host "  $($c.name) r$rep : $mbps Mbps (retr=$retr)"
            if ($c.name -like "*-4") {
                if ($mbps -gt $cap[$c.dir]) { $cap[$c.dir] = $mbps }
            }
            Write-Row @{ scenario = $c.name; direction = $c.dir; repeat = $rep; offered_mbps = $null
                actual_mbps = $mbps; sent_mbps = $sentMbps; retransmits = $retr; path = $pathBefore }
        } else { Write-Host "  $($c.name) r$rep : ERROR" -ForegroundColor Red }
    }
    # Bidirectional: parse both directions explicitly (v2 bug: bidir was unread).
    $pathBefore = Get-PathState
    $j = Invoke-IperfJson "-c $Peer -p $ServerPortUp -t $Duration -P 4 --bidir" "$ResultsDir\tcp-bidir-r$rep.json"
    if ($j -and -not $j.error) {
        # iperf3 --bidir JSON: sum_sent/sum_received cover the client direction;
        # server-side streams appear under server_output_text; parse both.
        $upMbps = 0; $downMbps = 0; $retr = 0
        try { $upMbps = [math]::Round($j.end.sum_sent.bits_per_second / 1e6, 1) } catch {}
        try { $downMbps = [math]::Round($j.end.sum_received.bits_per_second / 1e6, 1) } catch {}
        try { $retr = [int]$j.end.sum_sent.retransmits } catch {}
        try {
            foreach ($s in $j.server_output_text -split "`n") {
                if ($s -match "receiver" -and $s -match "([0-9.]+)\s+Mbits/sec") {
                    $downMbps = [math]::Round([double]$Matches[1], 1)
                }
            }
        } catch {}
        Write-Host "  tcp-bidir r$rep : up=${upMbps}Mbps down=${downMbps}Mbps (retr=$retr)"
        Write-Row @{ scenario = "tcp-bidir"; direction = "bidir"; repeat = $rep
            actual_mbps = $upMbps; down_mbps = $downMbps; retransmits = $retr; path = $pathBefore }
    }
}
if ($cap.up -eq 0) { $cap.up = 50.0 }
if ($cap.down -eq 0) { $cap.down = 50.0 }
Write-Host "  measured capacity: up=$($cap.up)Mbps down=$($cap.down)Mbps"

# --- loaded latency per direction at fractions of directional capacity ---
# NOTE on samples: Measure-Latency 200 gives meaningful p50/p95/p99;
# p999 stays null by design (see header). Bash uses 1000 fast pings.
Write-Host "[3] Loaded-latency sweeps (200 samples/dir: p99 max, p999 null)..." -ForegroundColor Yellow
$fractions = @(0.25, 0.50, 0.75, 0.90, 1.00, 1.10)
$dirs = @(
    @{ name = "upload"; cap = $cap.up; port = $ServerPortUp },
    @{ name = "download"; cap = $cap.down; port = $ServerPortDown }
)
foreach ($d in $dirs) {
    foreach ($f in $fractions) {
        $rate = [math]::Round($d.cap * $f, 1)
        $pct = [int]($f * 100)
        $pathBefore = Get-PathState
        # Direction-specific load: download MUST use -R (server sends), or
        # the "download" test silently measures upload load.
        $isDown = ($d.name -eq "download")
        $port = $d.port
        $job = Start-Job -ScriptBlock {
            param($exe, $p, $dd, $r, $rev, $pp)
            if ($rev) { & $exe -c $p -p $pp -t $dd -u -b "${r}M" -R --json 2>&1 }
            else { & $exe -c $p -p $pp -t $dd -u -b "${r}M" --json 2>&1 }
        } -ArgumentList $iperf3, $Peer, $Duration, $rate, $isDown, $port
        Start-Sleep 2
        $lat = Measure-Latency 200 5
        $loadJson = Receive-Job $job -Wait -AutoRemoveJob | Out-String
        $valid = $true
        try {
            $lj = $loadJson | ConvertFrom-Json
            if ($lj.error) { throw "iperf error: $($lj.error)" }
            $actual = [math]::Round($lj.end.sum.bits_per_second / 1e6, 1)
            $loss = [math]::Round($lj.end.sum.lost_percent, 2)
        } catch { $actual = -1; $loss = -1; $valid = $false }
        $pathAfter = Get-PathState
        $note = ""
        if ($pathBefore.mode -ne $pathAfter.mode) { $note = "PATH CHANGED mid-run; result flagged" }
        if ($actual -gt 0 -and $actual -lt $rate * 0.7 -and $f -le 1.0) { $note += " under-delivered load" }
        if (-not $valid) { $note += " LOAD FAILED: row invalid, values are placeholders" }
        Write-Host "  $($d.name) ${pct}%: actual=${actual}Mbps loss=${loss}% p50=$($lat.p50) p95=$($lat.p95) p99=$($lat.p99) max=$($lat.max) valid=$valid $note"
        Write-Row @{ scenario = "loaded-latency"; direction = $d.name; fraction = $f
            offered_mbps = $rate; actual_mbps = $actual; loss_pct = $loss
            latency = $lat; path = $pathBefore; path_after = $pathAfter; note = $note.Trim(); valid = $valid }
    }
}

# --- bidirectional loaded latency: full-duplex UDP at fractions ---
# Up and down loads run on SEPARATE server ports: two clients against one
# listener conflict on a normal iperf3 server. A bidir row is only valid
# when BOTH directions ran; failures mark valid=false explicitly.
Write-Host "  bidir (full duplex, 200 samples: p99 max, p999 null)..." -ForegroundColor Yellow
foreach ($f in @(0.25, 0.50, 0.75, 0.90, 1.00)) {
    $rateUp = [math]::Round($cap.up * $f, 1)
    $rateDown = [math]::Round($cap.down * $f, 1)
    $pct = [int]($f * 100)
    $pathBefore = Get-PathState
    $jobUp = Start-Job -ScriptBlock {
        param($exe, $p, $dd, $r, $pp) & $exe -c $p -p $pp -t $dd -u -b "${r}M" --json 2>&1
    } -ArgumentList $iperf3, $Peer, $Duration, $rateUp, $ServerPortUp
    $jobDown = Start-Job -ScriptBlock {
        param($exe, $p, $dd, $r, $pp) & $exe -c $p -p $pp -t $dd -u -b "${r}M" -R --json 2>&1
    } -ArgumentList $iperf3, $Peer, $Duration, $rateDown, $ServerPortDown
    Start-Sleep 2
    $lat = Measure-Latency 200 5
    $upJson = Receive-Job $jobUp -Wait -AutoRemoveJob | Out-String
    $downJson = Receive-Job $jobDown -Wait -AutoRemoveJob | Out-String
    $actualUp = -1; $lossUp = -1; $actualDown = -1; $lossDown = -1
    $errUp = $null; $errDown = $null
    try {
        $uj = $upJson | ConvertFrom-Json
        if ($uj.error) { throw "iperf error: $($uj.error)" }
        $actualUp = [math]::Round($uj.end.sum.bits_per_second / 1e6, 1)
        $lossUp = [math]::Round($uj.end.sum.lost_percent, 2)
    } catch { $errUp = $_.Exception.Message }
    try {
        $dj = $downJson | ConvertFrom-Json
        if ($dj.error) { throw "iperf error: $($dj.error)" }
        $actualDown = [math]::Round($dj.end.sum.bits_per_second / 1e6, 1)
        $lossDown = [math]::Round($dj.end.sum.lost_percent, 2)
    } catch { $errDown = $_.Exception.Message }
    $pathAfter = Get-PathState
    $note = ""
    if ($pathBefore.mode -ne $pathAfter.mode) { $note = "PATH CHANGED mid-run; result flagged" }
    if ($actualUp -gt 0 -and $actualUp -lt $rateUp * 0.7 -and $f -le 1.0) { $note += " under-delivered up load" }
    if ($actualDown -gt 0 -and $actualDown -lt $rateDown * 0.7 -and $f -le 1.0) { $note += " under-delivered down load" }
    $valid = ($null -eq $errUp) -and ($null -eq $errDown)
    if ($errUp) { $note += " BIDIR INVALID: up load failed ($errUp)" }
    if ($errDown) { $note += " BIDIR INVALID: down load failed ($errDown)" }
    Write-Host "  bidir ${pct}%: up=${actualUp}Mbps loss=${lossUp}% down=${actualDown}Mbps loss=${lossDown}% p50=$($lat.p50) p95=$($lat.p95) p99=$($lat.p99) valid=$valid $note"
    Write-Row @{ scenario = "loaded-latency"; direction = "bidir"; fraction = $f
        offered_up_mbps = $rateUp; offered_down_mbps = $rateDown
        actual_up_mbps = $actualUp; actual_down_mbps = $actualDown
        loss_up_pct = $lossUp; loss_down_pct = $lossDown
        latency = $lat; path = $pathBefore; path_after = $pathAfter; note = $note.Trim(); valid = $valid }
}

# --- UDP sweep: rates x sizes, delivered + pps + loss + jitter ---
Write-Host "[4] UDP sweep..." -ForegroundColor Yellow
foreach ($f in @(0.25, 0.50, 1.00)) {
    $rate = [math]::Round($cap.up * $f, 1)
    foreach ($len in @(64, 256, 1200)) {
        $j = Invoke-IperfJson "-c $Peer -p $ServerPortUp -u -b ${rate}M -l $len -t $Duration" "$ResultsDir\udp-${rate}M-${len}B.json"
        if ($j -and -not $j.error) {
            $s = $j.end.sum
            $pps = [math]::Round($s.packets_received / $Duration, 0)
            $del = [math]::Round($s.bits_per_second / 1e6, 1)
            Write-Host ("  offered={0}Mbps len={1}B delivered={2}Mbps pps={3} loss={4}% jitter={5}ms" -f $rate, $len, $del, $pps, [math]::Round($s.lost_percent, 2), [math]::Round($s.jitter_ms, 3))
            Write-Row @{ scenario = "udp"; offered_mbps = $rate; packet_len = $len
                actual_mbps = $del; pps = $pps; loss_pct = [math]::Round($s.lost_percent, 2)
                jitter_ms = [math]::Round($s.jitter_ms, 3); path = (Get-PathState) }
        }
    }
}

Write-Host "`nResults: $ResultsDir\results.jsonl (shared schema)" -ForegroundColor Green
