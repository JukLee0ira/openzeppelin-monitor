#!/bin/sh
set -eu

# Reads JSON from stdin in the format:
# { "monitor_match": { "EVM": { ... } }, "args": [...] }
#
# Prints a compact, human-readable line to stdout and exits 0.

input_json="$(cat)"

mm="$(echo "$input_json" | jq -c '.monitor_match.EVM')"
if [ "$mm" = "null" ] || [ -z "$mm" ]; then
  echo "[monitor] unsupported monitor_match (expected .monitor_match.EVM)"
  exit 0
fi

network="$(echo "$mm" | jq -r '.network_slug // "unknown"')"
tx_hash="$(echo "$mm" | jq -r '.transaction.hash // "unknown"')"
tx_from="$(echo "$mm" | jq -r '.transaction.from // "unknown"')"
tx_to="$(echo "$mm" | jq -r '.transaction.to // "unknown"')"
block_hex="$(echo "$mm" | jq -r '.transaction.blockNumber // "0x0"')"
block_dec="$(printf "%d" "$block_hex" 2>/dev/null || echo "0")"

ts="$(date -u +'%Y-%m-%dT%H:%M:%SZ')"

# Prefer decoded matched args when available; fall back to matched signatures.
events="$(echo "$mm" | jq -c '.matched_on_args.events // []')"
funcs="$(echo "$mm" | jq -c '.matched_on_args.functions // []')"

if [ "$(echo "$events" | jq 'length')" -gt 0 ]; then
  echo "$events" | jq -c '.[]' | while IFS= read -r ev; do
    sig="$(echo "$ev" | jq -r '.signature // "event"' )"
    args="$(echo "$ev" | jq -c '.args // []')"
    echo "[$ts][$network][block:$block_dec] EVENT $sig | tx=$tx_hash from=$tx_from to=$tx_to | args=$args"
  done
fi

if [ "$(echo "$funcs" | jq 'length')" -gt 0 ]; then
  echo "$funcs" | jq -c '.[]' | while IFS= read -r fn; do
    sig="$(echo "$fn" | jq -r '.signature // "function"' )"
    args="$(echo "$fn" | jq -c '.args // []')"
    echo "[$ts][$network][block:$block_dec] CALL  $sig | tx=$tx_hash from=$tx_from to=$tx_to | args=$args"
  done
fi

# If nothing decoded, still print a minimal line so you know it fired.
if [ "$(echo "$events" | jq 'length')" -eq 0 ] && [ "$(echo "$funcs" | jq 'length')" -eq 0 ]; then
  echo "[$ts][$network][block:$block_dec] MATCH | tx=$tx_hash from=$tx_from to=$tx_to"
fi

exit 0


