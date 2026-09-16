#!/usr/bin/env bash
# Deploys the settlement contracts to one chain, registers the observers, and
# prints the lines to add to .env.production.
#
#   scripts/deploy-contracts.sh 84532 https://sepolia.base.org
#
# SCRY_DEPLOYER_KEY       pays for the deployment
# SCRY_ADMIN              a Safe on mainnet; the deployer's own address is fine on a testnet
# SCRY_OPERATOR           address of the API's SCRY_OPERATOR_KEY
# SCRY_OBSERVER_ADDRESSES comma separated
#
# Optional: SCRY_COLLATERAL, SCRY_MAX_POOL, SCRY_MAX_STAKE, SCRY_CHALLENGE_WINDOW,
# SCRY_SIGNATURE_THRESHOLD, and SCRY_ETHERSCAN_KEY to verify the source.
set -euo pipefail

chain="${1:?usage: deploy-contracts.sh <chain id> <rpc url>}"
rpc="${2:?usage: deploy-contracts.sh <chain id> <rpc url>}"
: "${SCRY_DEPLOYER_KEY:?set SCRY_DEPLOYER_KEY}"
: "${SCRY_ADMIN:?set SCRY_ADMIN}"
: "${SCRY_OPERATOR:?set SCRY_OPERATOR}"
: "${SCRY_OBSERVER_ADDRESSES:?set SCRY_OBSERVER_ADDRESSES}"
export SCRY_ADMIN SCRY_OPERATOR

cd "$(dirname "$0")/../contracts"

actual=$(cast chain-id --rpc-url "$rpc")
if [ "$actual" != "$chain" ]; then
  echo "$rpc answers as chain $actual, not $chain" >&2
  exit 1
fi

verify=()
if [ -n "${SCRY_ETHERSCAN_KEY:-}" ]; then
  verify=(--verify --etherscan-api-key "$SCRY_ETHERSCAN_KEY")
fi

forge script script/Deploy.s.sol --rpc-url "$rpc" --private-key "$SCRY_DEPLOYER_KEY" \
  --broadcast --slow ${verify[@]+"${verify[@]}"}

run="broadcast/Deploy.s.sol/$chain/run-latest.json"
address_of() {
  python3 - "$run" "$1" <<'PY'
import json, sys
run, name = sys.argv[1], sys.argv[2]
for tx in json.load(open(run))["transactions"]:
    if tx.get("contractName") == name and tx.get("transactionType") == "CREATE":
        print(tx["contractAddress"])
        break
PY
}
registry=$(address_of ObserverRegistry)
resolver=$(address_of ObservationResolver)
factory=$(address_of MarketFactory)

lower() { printf '%s' "$1" | tr 'A-F' 'a-f'; }
deployer=$(cast wallet address --private-key "$SCRY_DEPLOYER_KEY")

IFS=, read -ra observers <<< "$SCRY_OBSERVER_ADDRESSES"
for observer in "${observers[@]}"; do
  if [ "$(lower "$SCRY_ADMIN")" = "$(lower "$deployer")" ]; then
    cast send "$registry" "setObserver(address,bool)" "$observer" true \
      --rpc-url "$rpc" --private-key "$SCRY_DEPLOYER_KEY" >/dev/null
    echo "registered observer $observer"
  else
    # Only the admin registers observers, and here the admin is a Safe.
    echo "from the Safe, send to $registry: $(cast calldata 'setObserver(address,bool)' "$observer" true)"
  fi
done

cat <<EOF

SCRY_RPC_$chain=$rpc
SCRY_FACTORY_$chain=$factory
SCRY_RESOLVER_$chain=$resolver
EOF
