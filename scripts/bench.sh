#!/bin/bash
# Tunnet Benchmark v3 — structured, repeatable, hard to lie with.
# Shared schema with bench.ps1: one JSON object per line in results.jsonl:
#   {ts, product, scenario, direction, fraction, offered_mbps, actual_mbps,
#    loss_pct, retransmits, latency:{n,p50,p95,p99,p999,max}, path:{...},
#    meta:{...}, note}
# Throughput matrix with explicit JSON fields (no regexed human output),
# loaded-latency sweeps per direction at fractions of independently measured
# directional capacity, UDP rate x size sweep, warmup + repeats, path-state
# capture around every scenario (flagged on migration), p99.9 from >=1000
# high-frequency samples.
set -u
PEER="${1:-10.7.0.2}"
DURATION="${2:-10}"
PRODUCT="${3:-tunnet}"
REPEATS="${4:-2}"
MTU="${5:-0}"
RESULTS_DIR="./bench-results/$(date +%Y%m%d-%H%M%S)-$PRODUCT"
mkdir -p "$RESULTS_DIR"
JSONL="$RESULTS_DIR/results.jsonl"

meta_json() {
  python3 -c "
import json,platform,subprocess
try: sha=subprocess.check_output(['git','rev-parse','--short','HEAD'],text=True).strip()
except Exception: sha=''
print(json.dumps({'commit':sha,'mtu':$MTU,'os':platform.platform(),'cpu':platform.processor() or platform.machine(),'peer':'$PEER','duration_s':$DURATION}))"
}
META=$(meta_json)

path_json() {
  python3 -c "
import json,subprocess
mode='unknown'; detail=''
try:
  import urllib.request
  st=json.load(urllib.request.urlopen('http://127.0.0.1:8899/api/status',timeout=5))
  mode=str(st.get('path_state','unknown')); detail=str(st.get('selected_path',''))
except Exception as e:
  detail='tunnet api unreachable'
print(json.dumps({'product':'$PRODUCT','mode':mode,'detail':detail[:400]}))"
}

# High-frequency latency probe: COUNT samples back to back (p99.9 needs n>=1000).
ping_samples_json() { # COUNT OUTFILE
  ping -c "$1" -i 0.005 "$PEER" 2>/dev/null | grep -oE 'time=[0-9.]+' | cut -d= -f2 > "$2"
  python3 -c "
import json
xs=sorted(float(x) for x in open('$2') if x.strip())
n=len(xs)
def q(p): return xs[min(n-1,int(p*n))] if n else -1
r={'n':n}
if n:
    r.update({'min':round(xs[0],2),'p50':round(q(.5),2),'p95':round(q(.95),2),'p99':round(q(.99),2),'max':round(xs[-1],2)})
    r['p999']=round(q(.999),2) if n>=1000 else None
print(json.dumps(r))"
}

# Structured iperf runner: prints nothing human; writes JSON file; echoes path.
run_iperf() { # NAME EXTRA_ARGS...
  local name="$1"; shift
  iperf3 -c "$PEER" -t "$DURATION" "$@" --json > "$RESULTS_DIR/$name.json" 2>&1
}

echo "=== Tunnet Benchmark v3 ($PRODUCT) ==="
echo "Peer: $PEER | Duration: ${DURATION}s | Repeats: $REPEATS | Results: $RESULTS_DIR"

# --- connectivity + warmup ---
echo "[0] Connectivity + warmup..."
ping -c 4 "$PEER" > /dev/null 2>&1 || { echo "  FAIL: $PEER unreachable"; exit 1; }
iperf3 -c "$PEER" -t 5 -P 2 > /dev/null 2>&1
echo "  OK, warmed up"

# --- idle latency: 1200 samples for real p99.9 ---
echo "[1] Idle latency (1200 samples)..."
IDLE_JSON=$(ping_samples_json 1200 "$RESULTS_DIR/ping-idle.txt")
echo "  idle: $IDLE_JSON"
path_json > "$RESULTS_DIR/idle.path"
echo "$IDLE_JSON" > "$RESULTS_DIR/idle.lat"
python3 - "$RESULTS_DIR/idle.lat" "$RESULTS_DIR/idle.path" <<'EOF'
import json,sys,datetime,os
lat = json.load(open(sys.argv[1]))
path = json.load(open(sys.argv[2]))
row = {'scenario': 'idle', 'direction': 'none', 'latency': lat, 'path': path}
row['ts'] = datetime.datetime.now(datetime.timezone.utc).isoformat()
row['product'] = os.environ['BENCH_PRODUCT']
row['meta'] = json.loads(os.environ['BENCH_META'])
open(os.environ['BENCH_JSONL'], 'a').write(json.dumps(row) + chr(10))
EOF
export BENCH_PRODUCT="$PRODUCT" BENCH_META="$META" BENCH_JSONL="$JSONL" BENCH_DURATION="$DURATION"

# --- throughput matrix with repeats; explicit bidir parse ---
echo "[2] Throughput matrix..."
CAP_UP=0; CAP_DOWN=0
tp_case() { # NAME DIR REPEAT EXTRA...
  local name="$1" dir="$2" rep="$3"; shift 3
  path_json > "$RESULTS_DIR/$name-r$rep.path"
  run_iperf "$name-r$rep" "$@"
  MBPS=$(python3 - "$RESULTS_DIR/$name-r$rep.json" "$RESULTS_DIR/$name-r$rep.path" "$name" "$dir" "$rep" <<'EOF'
import json,sys,datetime,os
ipath, ppath, name, direction, rep = sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4], sys.argv[5]
d = json.load(open(ipath))
path = json.load(open(ppath))
if isinstance(d.get('error'), str):
    print(f"  {name} r{rep}: ERROR {d['error']}", flush=True)
    print(0)
else:
    mbps = round(d['end']['sum_received']['bits_per_second']/1e6, 1)
    try: sent = round(d['end']['sum_sent']['bits_per_second']/1e6, 1)
    except Exception: sent = -1
    try: retr = int(d['end']['sum_sent'].get('retransmits', 0))
    except Exception: retr = -1
    print(f"  {name} r{rep}: {mbps} Mbps (retr={retr})", flush=True)
    row = {'scenario': name, 'direction': direction, 'repeat': int(rep),
           'actual_mbps': mbps, 'sent_mbps': sent, 'retransmits': retr,
           'path': path}
    row['ts'] = datetime.datetime.now(datetime.timezone.utc).isoformat()
    row['product'] = os.environ['BENCH_PRODUCT']
    row['meta'] = json.loads(os.environ['BENCH_META'])
    open(os.environ['BENCH_JSONL'], 'a').write(json.dumps(row) + chr(10))
    print(mbps)
EOF
)
  echo "$MBPS" | tail -1
}
for rep in $(seq 1 "$REPEATS"); do
  tp_case tcp-up-1 up "$rep" -P 1 > /dev/null
  MB=$(tp_case tcp-up-4 up "$rep" -P 4 | tail -1)
  CAP_UP=$(python3 -c "print(max(float('$CAP_UP'), float('$MB')))")
  tp_case tcp-down-1 down "$rep" -P 1 -R > /dev/null
  MB=$(tp_case tcp-down-4 down "$rep" -P 4 -R | tail -1)
  CAP_DOWN=$(python3 -c "print(max(float('$CAP_DOWN'), float('$MB')))")
  # Bidirectional: parse both directions explicitly (v2 never did).
  path_json > "$RESULTS_DIR/tcp-bidir-r$rep.path"
  run_iperf "tcp-bidir-r$rep" -P 4 --bidir
  python3 - "$RESULTS_DIR/tcp-bidir-r$rep.json" "$RESULTS_DIR/tcp-bidir-r$rep.path" "$rep" <<'EOF'
import json,sys,datetime,os
ipath, ppath, rep = sys.argv[1], sys.argv[2], sys.argv[3]
d = json.load(open(ipath))
path = json.load(open(ppath))
up = round(d['end']['sum_sent']['bits_per_second']/1e6, 1)
down = round(d['end']['sum_received']['bits_per_second']/1e6, 1)
try: retr = int(d['end']['sum_sent'].get('retransmits', 0))
except Exception: retr = -1
print(f"  tcp-bidir r{rep}: up={up}Mbps down={down}Mbps (retr={retr})")
row = {'scenario': 'tcp-bidir', 'direction': 'bidir', 'repeat': int(rep),
       'actual_mbps': up, 'down_mbps': down, 'retransmits': retr, 'path': path}
row['ts'] = datetime.datetime.now(datetime.timezone.utc).isoformat()
row['product'] = os.environ['BENCH_PRODUCT']
row['meta'] = json.loads(os.environ['BENCH_META'])
open(os.environ['BENCH_JSONL'], 'a').write(json.dumps(row) + chr(10))
EOF
done
CAP_UP=$(python3 -c "print($CAP_UP if $CAP_UP>0 else 50)")
CAP_DOWN=$(python3 -c "print($CAP_DOWN if $CAP_DOWN>0 else 50)")
echo "  measured capacity: up=${CAP_UP}Mbps down=${CAP_DOWN}Mbps"

# --- loaded latency per direction at fractions of directional capacity ---
echo "[3] Loaded-latency sweeps..."
for dir in "upload:$CAP_UP:" "download:$CAP_DOWN:-R"; do
  name="${dir%%:*}"; rest="${dir#*:}"; cap="${rest%%:*}"; extra="${rest#*:}"
  for F in 0.25 0.50 0.75 0.90 1.00 1.10; do
    RATE=$(python3 -c "print(round(float('$cap')*float('$F'),1))")
    PCT=$(python3 -c "print(int(float('$F')*100))")
    echo "  $name ${PCT}% (${RATE}Mbps)..."
    path_json > "$RESULTS_DIR/load-$name-$F.path0"
    # shellcheck disable=SC2086
    iperf3 -c "$PEER" -t "$DURATION" -u -b "${RATE}M" $extra --json > "$RESULTS_DIR/load-$name-$F.json" 2>&1 &
    LOAD_PID=$!
    sleep 2
    ping_samples_json 200 "$RESULTS_DIR/ping-load-$name-$F.txt" > "$RESULTS_DIR/ping-load-$name-$F.lat"
    wait $LOAD_PID
    path_json > "$RESULTS_DIR/load-$name-$F.path1"
    python3 - "$RESULTS_DIR/load-$name-$F.json" "$RESULTS_DIR/load-$name-$F.path0" "$RESULTS_DIR/load-$name-$F.path1" "$RESULTS_DIR/ping-load-$name-$F.lat" "$name" "$F" "$RATE" <<'EOF'
import json,sys,datetime,os
ipath, p0path, p1path, latpath, name, frac, rate = (sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4], sys.argv[5], float(sys.argv[6]), float(sys.argv[7]))
try:
    d = json.load(open(ipath)); s = d['end']['sum']
    actual = round(s['bits_per_second']/1e6, 1); loss = round(s.get('lost_percent', -1), 2)
except Exception:
    actual, loss = -1, -1
lat = json.load(open(latpath))
b = json.load(open(p0path)); a = json.load(open(p1path))
notes = []
if b.get('mode') != a.get('mode'):
    notes.append('PATH CHANGED mid-run; result flagged')
if actual > 0 and actual < rate*0.7 and frac <= 1.0:
    notes.append('under-delivered load')
note = '; '.join(notes)
print(f"  actual={actual}Mbps loss={loss}% p50={lat.get('p50')} p95={lat.get('p95')} p99={lat.get('p99')} max={lat.get('max')} {note}")
row = {'scenario': 'loaded-latency', 'direction': name, 'fraction': frac,
       'offered_mbps': rate, 'actual_mbps': actual, 'loss_pct': loss,
       'latency': lat, 'path': b, 'path_after': a, 'note': note}
row['ts'] = datetime.datetime.now(datetime.timezone.utc).isoformat()
row['product'] = os.environ['BENCH_PRODUCT']
row['meta'] = json.loads(os.environ['BENCH_META'])
open(os.environ['BENCH_JSONL'], 'a').write(json.dumps(row) + chr(10))
EOF
  done
done

# --- UDP sweep: rates x sizes ---
echo "[4] UDP sweep..."
for F in 0.25 0.50 1.00; do
  RATE=$(python3 -c "print(round(float('$CAP_UP')*float('$F'),1))")
  for LEN in 64 256 1200; do
    path_json > "$RESULTS_DIR/udp.path"
    run_iperf "udp-${RATE}M-${LEN}B" -u -b "${RATE}M" -l "$LEN"
    python3 - "$RESULTS_DIR/udp-${RATE}M-${LEN}B.json" "$RESULTS_DIR/udp.path" "$RATE" "$LEN" <<'EOF'
import json,sys,datetime,os
ipath, ppath, rate, length = sys.argv[1], sys.argv[2], float(sys.argv[3]), int(sys.argv[4])
d = json.load(open(ipath))
path = json.load(open(ppath))
s = d['end']['sum']
pps = round(s.get('packets_received', 0)/float(os.environ.get('BENCH_DURATION', '10')))
row = {'scenario': 'udp', 'offered_mbps': rate, 'packet_len': length,
       'actual_mbps': round(s['bits_per_second']/1e6, 1), 'pps': pps,
       'loss_pct': round(s.get('lost_percent', -1), 2),
       'jitter_ms': round(s.get('jitter_ms', -1), 3), 'path': path}
print(f"  offered={rate}Mbps len={length}B delivered={row['actual_mbps']}Mbps pps={pps} loss={row['loss_pct']}% jitter={row['jitter_ms']}ms")
row['ts'] = datetime.datetime.now(datetime.timezone.utc).isoformat()
row['product'] = os.environ['BENCH_PRODUCT']
row['meta'] = json.loads(os.environ['BENCH_META'])
open(os.environ['BENCH_JSONL'], 'a').write(json.dumps(row) + chr(10))
EOF
  done
done

echo "=== Done: $JSONL (shared schema) ==="
