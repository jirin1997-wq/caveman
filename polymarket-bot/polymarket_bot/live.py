"""Phase 3: LIVE trading — real money. Deliberately locked behind multiple safeties.

Refuses to start unless ALL of the following hold:
  1. py-clob-client is installed          (pip install py-clob-client)
  2. POLYBOT_PRIVATE_KEY is set           (Polygon wallet private key, via .env)
  3. POLYBOT_LIVE=I_UNDERSTAND_REAL_MONEY (exact sentinel, in the environment)
  4. --yes-really flag passed on the command line

Same decision core and risk manager as paper trading; the only difference is that
fills go to the Polymarket CLOB as GTC limit orders at the midpoint plus a small
slippage allowance. Order placement uses py-clob-client — verify its current API
against https://docs.polymarket.com before first run; the client evolves.

Usage:
  POLYBOT_LIVE=I_UNDERSTAND_REAL_MONEY python -m polymarket_bot.live --yes-really --bankroll 100
"""

from __future__ import annotations

import argparse
import sys
import time

from . import clob, gamma
from .config import LIVE_SENTINEL, get_settings
from .features import compute_features, to_vector
from .ledger import Ledger
from .paper import load_model
from .risk import RiskManager
from .strategy import decide

CLOB_HOST = "https://clob.polymarket.com"
POLYGON_CHAIN_ID = 137
SLIPPAGE = 0.01  # limit price allowance above midpoint
MIN_ORDER_USD = 1.0


def build_client(private_key: str):
    from py_clob_client.client import ClobClient  # import gated: optional dependency

    client = ClobClient(CLOB_HOST, key=private_key, chain_id=POLYGON_CHAIN_ID)
    client.set_api_creds(client.create_or_derive_api_creds())
    return client


def place_order(client, token_id: str, price: float, usd: float):
    from py_clob_client.clob_types import OrderArgs, OrderType
    from py_clob_client.order_builder.constants import BUY

    size = round(usd / price, 2)  # shares
    order = client.create_order(OrderArgs(price=round(price, 3), size=size, side=BUY, token_id=token_id))
    return client.post_order(order, OrderType.GTC)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--bankroll", type=float, required=True, help="max capital this bot may deploy (USD)")
    parser.add_argument("--interval", type=int, default=900)
    parser.add_argument("--top", type=int, default=50)
    parser.add_argument("--model-dir", default="models")
    parser.add_argument("--ledger", default="ledger.live.json")
    parser.add_argument("--yes-really", action="store_true", help="final confirmation that real money is at stake")
    args = parser.parse_args()

    cfg = get_settings()

    # --- safety gate: every condition must pass, in order, with a clear message ---
    if not args.yes_really:
        print("refusing: pass --yes-really to confirm live trading with real money", file=sys.stderr)
        return 2
    if not cfg.live_armed:
        print(f"refusing: set POLYBOT_LIVE={LIVE_SENTINEL} in the environment", file=sys.stderr)
        return 2
    if not cfg.private_key:
        print("refusing: POLYBOT_PRIVATE_KEY is not set (see .env.example)", file=sys.stderr)
        return 2
    try:
        client = build_client(cfg.private_key)
    except ImportError:
        print("refusing: py-clob-client not installed (pip install py-clob-client)", file=sys.stderr)
        return 2

    model = load_model(args.model_dir)
    ledger = Ledger(args.ledger, starting_cash=args.bankroll)
    risk = RiskManager(cfg, bankroll=args.bankroll)

    print(f"LIVE trading armed: bankroll ${args.bankroll:,.2f}. Ctrl+C to stop.")
    while True:
        try:
            run_scan(client, model, ledger, risk, cfg, args.top)
        except Exception as exc:
            print(f"scan failed: {exc}", file=sys.stderr)
        time.sleep(args.interval)


def run_scan(client, model, ledger: Ledger, risk: RiskManager, cfg, top: int) -> None:
    now_ts = gamma.now_ts()

    # settle resolved positions (winnings are redeemed on-chain by Polymarket automatically;
    # the ledger mirrors that so risk limits track reality)
    for market_id in list(ledger.positions.keys()):
        market = gamma.get_market(market_id)
        if market and market["closed"]:
            pnl = ledger.settle(market_id, market["winner_index"], now_ts)
            risk.record_pnl(pnl, now_ts)
            print(f"settled {market_id}: PnL {pnl:+.2f}")

    if risk.kill_switch_active(now_ts):
        print("kill-switch active for today — no new trades")
        ledger.save()
        return

    for market in gamma.iter_markets(closed=False, min_volume=cfg.min_volume, max_markets=top):
        if ledger.has_position(market["id"]) or market["end_ts"] <= now_ts:
            continue
        yes_token = market["token_ids"][0]
        mid = clob.midpoint(yes_token)
        if mid is None:
            continue
        points = clob.price_history(yes_token, interval="1m", fidelity_minutes=60)
        feats = compute_features(points + [(now_ts, mid)], now_ts, market["end_ts"], market["volume"])
        if feats is None:
            continue

        p_model = float(model.predict_proba([to_vector(feats)])[0][1])
        decision = decide(p_model, mid, ledger.equity(), cfg)
        if decision is None or decision.stake < MIN_ORDER_USD:
            continue

        ok, reason = risk.check_trade(decision.stake, market["volume"], ledger.open_exposure(), ledger.cash, now_ts)
        if not ok:
            print(f"blocked ({reason}): {market['question'][:60]}")
            continue

        token_id = market["token_ids"][decision.side]
        limit_price = min(decision.raw_price + SLIPPAGE, 0.99)
        try:
            resp = place_order(client, token_id, limit_price, decision.stake)
        except Exception as exc:
            print(f"order FAILED for {market['question'][:60]}: {exc}", file=sys.stderr)
            continue

        ledger.open_position(
            market["id"], market["question"], decision.side, token_id,
            decision.stake, decision.cost, decision.p_win, now_ts,
        )
        print(
            f"LIVE BUY {market['outcomes'][decision.side]} limit {limit_price:.3f} "
            f"(stake ${decision.stake:.2f}) — {market['question'][:60]} | resp: {resp}"
        )
        time.sleep(0.5)

    ledger.save()
    print(f"equity ${ledger.equity():,.2f} | cash ${ledger.cash:,.2f} | open positions {len(ledger.positions)}")


if __name__ == "__main__":
    sys.exit(main())
