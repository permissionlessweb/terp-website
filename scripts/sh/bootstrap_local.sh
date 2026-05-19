#!/bin/bash
# Custom localterp bootstrap — extends the stock bootstrap with uthiol denom.
#
# Differences from upstream /terp-core/docker/localterp/bootstrap.sh:
#   1. Genesis accounts receive BOTH uterp AND uthiol
#   2. Faucet DENOM defaults to uterp (fixes upstream uscrt default)
#   3. gRPC is explicitly enabled on 0.0.0.0:9090

set -x
set -oe errexit

ENABLE_FAUCET=${1:-"true"}
custom_script_path=${POST_INIT_SCRIPT:-"/root/post_init.sh"}

file=~/.terpd/config/genesis.json
if [ ! -e "$file" ]; then
  rm -rf ~/.terpd/*

  chain_id=${CHAINID:-120u-1}
  LOG_LEVEL=${LOG_LEVEL:-INFO}
  fast_blocks=${FAST_BLOCKS:-"true"}

  terpd config chain-id "$chain_id"
  terpd config keyring-backend test

  terpd init banana --chain-id "$chain_id"

  # Patch genesis: staking, governance, mint, tokenfactory params
  jq '
    .app_state.staking.params.unbonding_time = "90s" |
    .app_state.gov.params.voting_period = "90s" |
    .app_state.gov.params.expedited_voting_period = "15s" |
    .app_state.gov.deposit_params.min_deposit[0].denom = "uterp" |
    .app_state.gov.params.min_deposit[0].denom = "uterp" |
    .app_state.gov.params.expedited_min_deposit[0].denom = "uterp" |
    .app_state.mint.params.mint_denom = "uterp" |
    .app_state.staking.params.bond_denom = "uterp" |
    .app_state.tokenfactory.params.denom_creation_fee = [{"denom":"uterp","amount":"1000000"}]
  ' ~/.terpd/config/genesis.json >~/.terpd/config/genesis.json.tmp && mv ~/.terpd/config/genesis.json{.tmp,}

  # Fast blocks for local testing (200ms rounds)
  if [ "${fast_blocks}" = "true" ]; then
    sed -E -i '/timeout_(propose|prevote|precommit|commit)/s/[0-9]+m?s/200ms/' ~/.terpd/config/config.toml
  fi

  # Run custom post-init script if mounted
  if [ ! -e "$custom_script_path" ]; then
    echo "Custom script not found. Continuing..."
  else
    echo "Running custom post init script..."
    bash "$custom_script_path"
    echo "Done running custom script!"
  fi

  # ─── Accounts ──────────────────────────────────────────────────
  v_mnemonic="push certain add next grape invite tobacco bubble text romance again lava crater pill genius vital fresh guard great patch knee series era tonight"
  a_mnemonic="grant rice replace explain federal release fix clever romance raise often wild taxi quarter soccer fiber love must tape steak together observe swap guitar"
  b_mnemonic="jelly shadow frog dirt dragon use armed praise universe win jungle close inmate rain oil canvas beauty pioneer chef soccer icon dizzy thunder meadow"
  c_mnemonic="chair love bleak wonder skirt permit say assist aunt credit roast size obtain minute throw sand usual age smart exact enough room shadow charge"
  d_mnemonic="word twist toast cloth movie predict advance crumble escape whale sail such angry muffin balcony keen move employ cook valve hurt glimpse breeze brick"

  echo "$v_mnemonic" | terpd keys add validator --recover
  echo "$a_mnemonic" | terpd keys add a --recover
  echo "$b_mnemonic" | terpd keys add b --recover
  echo "$c_mnemonic" | terpd keys add c --recover
  echo "$d_mnemonic" | terpd keys add d --recover

  terpd keys list --output json | jq

  # Fund each account with BOTH uterp (gas/staking) AND uthiol (contract fees)
  ico=1000000000000000000
  for acct in validator a b c d; do
    terpd genesis add-genesis-account "$acct" "${ico}uterp,${ico}uthiol"
  done

  # Gentx — validator stakes uterp
  terpd genesis gentx validator ${ico::-1}uterp --chain-id "$chain_id"

  terpd genesis collect-gentxs
  terpd genesis validate-genesis

  # ─── Node config ───────────────────────────────────────────────
  # LCD / REST API
  perl -i -pe 's/localhost/0.0.0.0/' ~/.terpd/config/app.toml
  perl -i -pe 's;address = "tcp://0.0.0.0:1317";address = "tcp://0.0.0.0:1316";' ~/.terpd/config/app.toml
  perl -i -pe 's/enable-unsafe-cors = false/enable-unsafe-cors = true/' ~/.terpd/config/app.toml
  perl -i -pe 's/concurrency = false/concurrency = true/' ~/.terpd/config/app.toml

  # gRPC — ensure enabled on 0.0.0.0:9090
  perl -i -pe 's/^(address = ")(0\.0\.0\.0:9090)(")/$1$2$3/' ~/.terpd/config/app.toml

  # Connection limits
  perl -i -pe 's/max_subscription_clients.+/max_subscription_clients = 100/' ~/.terpd/config/config.toml
  perl -i -pe 's/max_subscriptions_per_client.+/max_subscriptions_per_client = 50/' ~/.terpd/config/config.toml
fi

# ─── Start services ────────────────────────────────────────────
# CORS proxy: REST on internal :1316 proxied to external :1317
setsid lcp --proxyUrl http://localhost:1316 --port 1317 --proxyPartial '' &

if [ "${ENABLE_FAUCET}" = "true" ]; then
  # Fix upstream faucet default: use uterp not uscrt
  export DENOM="${DENOM:-uterp}"
  setsid node faucet_server.js &
  cp "$(which terpd)" "$(dirname "$(which terpd)")"/terpd
fi

if [ "${SLEEP}" = "true" ]; then
  sleep infinity
fi

RUST_BACKTRACE=1 terpd start --rpc.laddr tcp://0.0.0.0:26657 --log_level "${LOG_LEVEL}"
