#!/bin/bash
set -u
PEER="${1:-10.7.0.2}"
DURATION="${2:-10}"
PRODUCT="${3:-tunnet}"
RESULTS_DIR="./bench-results/$(date +%Y%m%d-%H%M%S)-$PRODUCT"
mkdir -p "$RESULTS_DIR"

echo "=== Tunnet Benchmark v2 ($PRODUCT) ==="
echo "Peer: $PEER | Duration: ${DURATION}s | Results: $RESULTS_DIR"

path_state() {
  {
    echo "product=$PRODUCT date=$(date -u +%FT%TZ)"
    if [ "$PRODUCT" = "tunnet" ]; then
      curl -sf --max-time 5 http://127.0.0.1:8899/api/status 2>/dev/null || echo "tunnet_api=unreachable"
    else
      zerotier-cli peers 2>/dev/null | head -8 || echo "zerotier_cli=unavailable"
    fi
    ip route get "$PEER" 2>/dev/null || true
  } >> "$RESULTS_DIR/path-state.txt"
}
path_state
cat "$RESULTS_DIR/path-state.txt"
echo ""

pct() { # pct FILE P(0-100)
  python3 -c "
import json,sys
xs=sorted(json.load(open('$1')))
n=len(xs)
def q(p): return xs[min(n-1,int(p*n/100))]
for p in [$2]:
    print(f'{p}={q($2):.2f}', end=' ')
print(f'n={n} min={xs[0]:.2f} max={xs[-1]:.2f}')
"
}

ping_samples() { # COUNT OUTFILE
  ping -c "$1" -i 0.05 "$PEER" | grep -oE 'time=[0-9.]+' | cut -d= -f2 > "$2"
  python3 -c "
import json
xs=[float(x) for x in open('$2')]
xs.sort(); n=len(xs)
def q(p): return xs[min(n-1,int(p*n))] if n else -1
print(json.dumps({'n':n,'min':round(xs[0],2) if n else -1,'p50':round(q(.5),2),'p95':round(q(.95),2),'p99':round(q(.99),2),'max':round(xs[-1],2) if n else -1}))
"
}

echo "[0] Idle latency (100x ping)..."
IDLE_JSON=$(ping_samples 100 "$RESULTS_DIR/ping-idle.txt")
echo "  idle: $IDLE_JSON"
echo "$IDLE_JSON" > "$RESULTS_DIR/ping-idle.json"
echo ""

echo "[1] Throughput matrix..."
run_tp() { # NAME EXTRA_ARGS
  iperf3 -c "$PEER" -t "$DURATION" $2 --json > "$RESULTS_DIR/$1.json" 2>&1
  python3 -c "
import json
d=json.load(open('$RESULTS_DIR/$1.json'))
if 'error' in d and isinstance(d.get('error'),str): print('ERROR '+d['error'])
else:
    r=d['end']['sum_received']['bits_per_second']/1e6
    try: rt=d['end']['sum_sent'].get('retransmits','?')
    except Exception: rt='?'
    print(f'$1: {r:.1f} Mbps retransmits={rt}')
    print(f'{r:.1f}', end='')
" 2>&1 | tail -2
}
UP1=$(run_tp tcp-up-1 "-P 1"); echo "  $UP1"
UP4=$(run_tp tcp-up-4 "-P 4"); echo "  $UP4"
DN1=$(run_tp tcp-down-1 "-P 1 -R"); echo "  $DN1"
DN4=$(run_tp tcp-down-4 "-P 4 -R"); echo "  $DN4"
iperf3 -c "$PEER" -t "$DURATION" -P 4 --bidir --json > "$RESULTS_DIR/tcp-bidir.json" 2>&1
CAP_UP=$(echo "$UP4" | grep -oE '[0-9.]+' | head -1)
CAP_UP=${CAP_UP:-50}
echo "  measured capacity up=${CAP_UP}Mbps"
echo ""

echo "[2] Loaded-latency sweep (fraction of measured capacity)..."
: > "$RESULTS_DIR/loaded-latency.jsonl"
for F in 0.25 0.50 0.75 0.90 1.00 1.10; do
  RATE=$(python3 -c "print(round(float('$CAP_UP')*float('$F'),1))")
  echo "  ${F}x (${RATE}Mbps up)..."
  iperf3 -c "$PEER" -t "$DURATION" -u -b "${RATE}M" --json > "$RESULTS_DIR/load-$F.json" 2>&1 &
  LOAD_PID=$!
  sleep 2
  LAT=$(ping_samples 40 "$RESULTS_DIR/ping-load-$F.txt")
  wait $LOAD_PID
  ACTUAL=$(python3 -c "
import json
try:
  d=json.load(open('$RESULTS_DIR/load-$F.json')); s=d['end']['sum']
  print(f\"{s['bits_per_second']/1e6:.1f}/{s.get('lost_percent',-1):.2f}\")
except Exception: print('-1/-1')")
  echo "  actual=${ACTUAL}Mbps loss% latency: $LAT"
  echo "{\"fraction\":$F,\"offered_mbps\":$RATE,\"actual_mbps_loss\":\"$ACTUAL\",\"latency\":$LAT}" >> "$RESULTS_DIR/loaded-latency.jsonl"
done
echo ""

echo "[3] UDP sweep (rates x sizes)..."
for F in 0.25 0.50 1.00; do
  RATE=$(python3 -c "print(round(float('$CAP_UP')*float('$F'),1))")
  for LEN in 64 256 1200; do
    iperf3 -c "$PEER" -u -b "${RATE}M" -l "$LEN" -t "$DURATION" --json > "$RESULTS_DIR/udp-${RATE}M-${LEN}B.json" 2>&1
    python3 -c "
import json
d=json.load(open('$RESULTS_DIR/udp-${RATE}M-${LEN}B.json'))
s=d['end']['sum']
pps=s.get('packets_received',0)/$DURATION
print(f\"  offered=${RATE}Mbps len=${LEN}B delivered={s['bits_per_second']/1e6:.1f}Mbps pps={pps:.0f} loss={s.get('lost_percent',-1):.2f}% jitter={s.get('jitter_ms',-1):.3f}ms\")"
  done
done
echo ""
path_state
echo "=== Done. Results in $RESULTS_DIR ==="
