#!/usr/bin/env bash
# Fáze 1 jedním příkazem: venv → závislosti → data → trénink → backtest.
#
#   bash run_phase1.sh            # reálná data z Polymarketu (collect běží 20-40 min)
#   bash run_phase1.sh --synth    # offline test na syntetických datech (~1 min)
#
# Skript je idempotentní — po pádu (výpadek sítě apod.) ho spusťte znovu,
# collect naváže tam, kde skončil.
set -euo pipefail
cd "$(dirname "$0")"

MODE="real"
if [ "${1:-}" = "--synth" ]; then MODE="synth"; fi

# --- najdi Python 3.9+ ------------------------------------------------------
PY=""
for candidate in python3.12 python3.11 python3.10 python3; do
  if command -v "$candidate" >/dev/null 2>&1 \
     && "$candidate" -c 'import sys; sys.exit(0 if sys.version_info >= (3, 9) else 1)' 2>/dev/null; then
    PY="$candidate"
    break
  fi
done
if [ -z "$PY" ]; then
  echo "CHYBA: nenalezen Python 3.9+ (zkuste: brew install python@3.12)" >&2
  exit 1
fi
echo "==> Python: $($PY --version)"

# --- venv + závislosti -------------------------------------------------------
if [ ! -f .venv/bin/activate ]; then
  echo "==> Vytvářím virtuální prostředí (.venv)..."
  "$PY" -m venv .venv
fi
# shellcheck disable=SC1091
source .venv/bin/activate
echo "==> Instaluji závislosti (chvíli to potrvá při prvním běhu)..."
pip install --quiet --upgrade pip
pip install --quiet -r requirements.txt

# --- data ---------------------------------------------------------------------
if [ "$MODE" = "synth" ]; then
  DATA_DIR="data-synth"
  MODEL_DIR="models-synth"
  echo "==> SYNTETICKÁ data (jen test pipeline — čísla nic neříkají o reálném edge!)"
  python -m polymarket_bot.synth --markets 400 --data-dir "$DATA_DIR"
else
  DATA_DIR="data"
  MODEL_DIR="models"
  echo "==> Stahuji rozhodnuté trhy z Polymarketu (20-40 min, průběžně vypisuje postup)..."
  echo "    Při pádu spusťte skript znovu — naváže, kde skončil."
  python -m polymarket_bot.collect --min-volume 10000 --max-markets 2000 --data-dir "$DATA_DIR"
fi

# --- dataset → trénink → backtest ---------------------------------------------
echo "==> Stavím dataset..."
python -m polymarket_bot.dataset --data-dir "$DATA_DIR"
echo "==> Trénuji model..."
python -m polymarket_bot.train --data-dir "$DATA_DIR" --model-dir "$MODEL_DIR"
echo "==> Backtest..."
python -m polymarket_bot.backtest --data-dir "$DATA_DIR" --model-dir "$MODEL_DIR"

echo ""
echo "================================================================"
if [ "$MODE" = "synth" ]; then
  echo "HOTOVO (syntetická data). Pipeline funguje."
  echo "Pro reálná data spusťte:  bash run_phase1.sh"
else
  echo "HOTOVO. Pošlete výstup 'Trénuji model' a 'Backtest' výše"
  echo "Claudovi — hlavně řádky Brier model / Brier market a ROI."
fi
echo "================================================================"
