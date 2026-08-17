"""Phase 3: LIVE trading — real money. Deliberately locked behind multiple safeties.

Refuses to start unless ALL of the following hold:
  1. py-clob-client is installed          (pip install py-clob-client)
  2. POLYBOT_PRIVATE_KEY is set           (Polygon wallet private key, via .env)
  3. POLYBOT_LIVE=I_UNDERSTAND_REAL_MONEY (exact sentinel, in the environment)
  4. --yes-really flag passed on the command line

Same engine, decision core and risk manager as paper trading. Orders are submitted
fill-and-kill (FAK) rather than resting limits: a resting order can sit unfilled for
hours while the ledger believes it holds a position, and a ledger that disagrees with
reality makes every downstream risk limit meaningless. FAK either fills now or is
cancelled, so what gets recorded is what actually happened.

If a fill cannot be confirmed from the venue's response, the bot stops instead of
guessing — reconcile by hand, then restart.

Wallet note: accounts created through the Polymarket web UI trade via a proxy wallet.
Set POLYBOT_SIGNATURE_TYPE=1 (email/magic login) or 2 (browser wallet) and
POLYBOT_FUNDER=<proxy address> for those. A plain EOA holding USDC needs neither.
Verify against https://docs.polymarket.com before the first run.

Usage:
  POLYBOT_LIVE=I_UNDERSTAND_REAL_MONEY python -m polymarket_bot.live --yes-really --bankroll 100
"""

from __future__ import annotations

import argparse
import os
import sys
import time
from typing import Optional, Tuple

from . import clob, gamma
from .config import CLOB_HOST, LIVE_SENTINEL, get_settings
from .engine import find_signals, load_model, settle_positions
from .ledger import Ledger
from .risk import RiskManager

POLYGON_CHAIN_ID = 137
SLIPPAGE = 0.01      # how far above the midpoint we are willing to pay
MIN_ORDER_USD = 1.0  # venue minimum notional
MIN_ORDER_SHARES = 5.0  # venue minimum size


class ReconcileRequired(Exception):
    """Raised when the ledger can no longer be trusted to match the venue."""


def build_client(private_key: str):
    from py_clob_client.client import ClobClient  # import gated: optional dependency

    signature_type = os.environ.get("POLYBOT_SIGNATURE_TYPE")
    funder = os.environ.get("POLYBOT_FUNDER")
    kwargs = {"key": private_key, "chain_id": POLYGON_CHAIN_ID}
    if signature_type:
        kwargs["signature_type"] = int(signature_type)
    if funder:
        kwargs["funder"] = funder

    client = ClobClient(CLOB_HOST, **kwargs)
    client.set_api_creds(client.create_or_derive_api_creds())
    return client


def _float_or_none(value) -> Optional[float]:
    try:
        parsed = float(value)
    except (TypeError, ValueError):
        return None
    return parsed if parsed > 0 else None


def interpret_fill(resp, requested_shares: float, price: float) -> Tuple[float, float]:
    """(filled_shares, spent_usd) from a FAK order response.

    Returns (0, 0) for a clean no-fill. Raises ReconcileRequired when the response
    cannot be read confidently — with real money on the line, an unreadable response
    must stop the bot rather than become an assumed fill.
    """
    if not isinstance(resp, dict):
        raise ReconcileRequired(f"unrecognized order response: {resp!r}")
    if resp.get("errorMsg"):
        return 0.0, 0.0  # venue rejected the order outright — nothing was bought
    if resp.get("success") is False:
        return 0.0, 0.0

    status = str(resp.get("status", "")).lower()
    if status in ("unmatched", "cancelled", "canceled"):
        return 0.0, 0.0

    # A BUY takes outcome shares and makes USDC: takingAmount = shares, makingAmount = USD.
    shares = _float_or_none(resp.get("takingAmount"))
    spent = _float_or_none(resp.get("makingAmount"))
    if shares is not None:
        return shares, spent if spent is not None else shares * price
    if status == "matched":
        # Matched but sizes absent: assume the full requested size rather than lose
        # the position, and say so loudly in the log.
        print("  warning: fill confirmed without sizes — assuming full requested size", file=sys.stderr)
        return requested_shares, requested_shares * price

    raise ReconcileRequired(f"cannot determine fill from response: {resp!r}")


def place_order(client, token_id: str, price: float, shares: float):
    """Submit a fill-and-kill buy. Fills now at `price` or better, or is cancelled."""
    from py_clob_client.clob_types import OrderArgs, OrderType
    from py_clob_client.order_builder.constants import BUY

    order = client.create_order(
        OrderArgs(price=price, size=round(shares, 2), side=BUY, token_id=token_id)
    )
    return client.post_order(order, OrderType.FAK)


def run_scan(client, model, ledger: Ledger, risk: RiskManager, cfg, top: int) -> None:
    now_ts = gamma.now_ts()
    settle_positions(ledger, risk, now_ts)

    if risk.kill_switch_active(now_ts):
        print(f"kill-switch active for today (day PnL {risk.day_pnl:+.2f}) — no new trades")
        ledger.save()
        return

    for signal in find_signals(model, ledger, risk, cfg, top):
        market, decision = signal.market, signal.decision
        token_id = market["token_ids"][decision.side]

        tick = clob.tick_size(token_id)
        limit_price = clob.round_to_tick(min(decision.raw_price + SLIPPAGE, 1.0 - tick), tick)
        shares = decision.stake / limit_price
        if decision.stake < MIN_ORDER_USD or shares < MIN_ORDER_SHARES:
            print(f"skipped (below venue minimum): {market['question'][:60]}")
            continue

        try:
            resp = place_order(client, token_id, limit_price, shares)
        except Exception as exc:
            print(f"order FAILED for {market['question'][:60]}: {exc}", file=sys.stderr)
            continue

        filled_shares, spent = interpret_fill(resp, shares, limit_price)
        if filled_shares <= 0:
            print(f"no fill: {market['question'][:60]}")
            continue

        # Record what actually filled, not what was requested.
        ledger.open_position(
            market["id"], market["question"], decision.side, token_id,
            stake=spent, cost=spent / filled_shares, p_model=decision.p_win,
            now_ts=gamma.now_ts(), shares=filled_shares,
        )
        ledger.save()  # persist before the next order — a crash must not lose a real fill
        print(
            f"LIVE BUY {market['outcomes'][decision.side]} {filled_shares:.2f} shares "
            f"@ {spent / filled_shares:.3f} (${spent:.2f}) — {market['question'][:60]}"
        )
        time.sleep(0.5)

    ledger.save()
    print(
        f"equity ${ledger.equity():,.2f} | cash ${ledger.cash:,.2f} | "
        f"open {len(ledger.positions)} | realized PnL {ledger.realized_pnl():+,.2f}"
    )


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

    # --- safety gate: every condition must pass, with a clear message on failure ---
    if not args.yes_really:
        print("refusing: pass --yes-really to confirm live trading with real money", file=sys.stderr)
        return 2
    if not cfg.live_armed:
        print(f"refusing: set POLYBOT_LIVE={LIVE_SENTINEL} in the environment", file=sys.stderr)
        return 2
    if not cfg.private_key:
        print("refusing: POLYBOT_PRIVATE_KEY is not set (see .env.example)", file=sys.stderr)
        return 2
    if args.bankroll <= 0:
        print("refusing: --bankroll must be positive", file=sys.stderr)
        return 2
    try:
        client = build_client(cfg.private_key)
    except ImportError:
        print("refusing: py-clob-client not installed (pip install py-clob-client)", file=sys.stderr)
        return 2

    model = load_model(args.model_dir)
    ledger = Ledger(args.ledger, starting_cash=args.bankroll)
    risk = RiskManager(cfg, bankroll=ledger.starting_cash, state=ledger.risk_state)

    print(f"LIVE trading armed: bankroll ${ledger.starting_cash:,.2f}. Ctrl+C to stop.")
    while True:
        try:
            run_scan(client, model, ledger, risk, cfg, args.top)
        except ReconcileRequired as exc:
            ledger.save()
            print(f"\nSTOPPING — ledger may not match the venue: {exc}", file=sys.stderr)
            print("Check your positions at https://polymarket.com/portfolio, fix "
                  f"{args.ledger} by hand, then restart.", file=sys.stderr)
            return 1
        except Exception as exc:
            print(f"scan failed: {exc}", file=sys.stderr)
        time.sleep(args.interval)


if __name__ == "__main__":
    sys.exit(main())
