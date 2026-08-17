# Polymarket Trading Bot

Bot pro obchodování na [Polymarketu](https://polymarket.com). Postup ve třech fázích —
**nejdřív data a trénink modelu, pak paper trading, a teprve nakonec reálné peníze.**

> ⚠️ **Upozornění:** Obchodování na predikčních trzích je rizikové a můžete přijít o celý vklad.
> Nic v tomto repozitáři není investiční doporučení. Fáze 3 (reálné peníze) je záměrně
> zamčená za několika pojistkami — nepouštějte ji, dokud model neprokáže edge v paper tradingu.

## Jak to funguje

Model se učí z **historických, už rozhodnutých trhů**: v čase T před koncem trhu známe cenu
(tržní pravděpodobnost), objem, momentum atd. — a známe i výsledek. Model se učí předpovídat
pravděpodobnost výsledku *lépe kalibrovanou* než tržní cena. Obchod se otevře jen tam, kde je
rozdíl mezi modelem a cenou větší než práh + poplatky/skluz. Velikost pozice řídí zlomkové
Kellyho kritérium s tvrdými stropy.

```
Fáze 1: collect → dataset → train → backtest     (jen data, žádné peníze)
Fáze 2: paper trading                             (živé ceny, fiktivní peníze)
Fáze 3: live trading                              (reálné peníze, ruční odemčení)
```

## Nejrychlejší start — jeden příkaz

```bash
cd polymarket-bot
bash run_phase1.sh
```

Skript sám vytvoří prostředí, nainstaluje závislosti, stáhne reálná data (20–40 min),
natrénuje model a spustí backtest. Když spadne (výpadek sítě), spusťte ho znovu —
naváže tam, kde skončil. Rychlý offline test bez internetu: `bash run_phase1.sh --synth`.

Vyžaduje Python 3.9+ (funguje i se systémovým Pythonem na macOS).

## Ruční instalace (alternativa)

```bash
cd polymarket-bot
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env   # a doplňte hodnoty (pro fáze 1–2 nic nepotřebujete)
```

## Fáze 1 — data a trénink

```bash
# 1. Stáhne rozhodnuté trhy z Gamma API + cenové historie z CLOB API (může běžet dlouho)
python -m polymarket_bot.collect --min-volume 10000 --max-markets 2000

# 2. Z historií vyrobí trénovací vzorky (snímky 1/3/7/14/30 dní před koncem trhu)
python -m polymarket_bot.dataset

# 3. Natrénuje kalibrovaný model, časový split, report Brier skóre vs. samotná tržní cena
python -m polymarket_bot.train

# 4. Walk-forward backtest na testovacím období (trhy, které model nikdy neviděl)
python -m polymarket_bot.backtest --edge 0.05 --kelly-scale 0.25
```

**Kritérium úspěchu:** Brier skóre modelu musí být *lepší* než Brier skóre tržní ceny na
testovacím období, a backtest musí být ziskový i po poplatcích a skluzu. Pokud ne, model
edge nemá a fáze 2/3 nemají smysl.

### Rychlý test pipeline bez internetu

```bash
python -m polymarket_bot.synth          # vygeneruje syntetická data (jen na otestování kódu!)
python -m polymarket_bot.dataset --data-dir data-synth
python -m polymarket_bot.train --data-dir data-synth
python -m polymarket_bot.backtest --data-dir data-synth
```

Čísla ze syntetických dat **nic neříkají o reálném edge** — slouží jen k ověření, že pipeline běží.

## Fáze 2 — paper trading

```bash
python -m polymarket_bot.paper --bankroll 1000 --interval 900
```

Bot každých 15 minut projde nejlikvidnější aktivní trhy, spočítá edge a simulované obchody
zapisuje do `ledger.paper.json` (žádné skutečné objednávky). Nechte běžet **minimálně několik
týdnů** a vyhodnoťte PnL, drawdown a počet obchodů, než vůbec uvažujete o fázi 3.

## Fáze 3 — reálné peníze (zamčeno)

Vyžaduje **všechny** tyto pojistky najednou:

1. `pip install py-clob-client`
2. `POLYBOT_PRIVATE_KEY` v `.env` (privátní klíč Polygon peněženky — nikdy necommitovat!)
3. `POLYBOT_LIVE=I_UNDERSTAND_REAL_MONEY` v prostředí
4. flag `--yes-really` na příkazové řádce

```bash
POLYBOT_LIVE=I_UNDERSTAND_REAL_MONEY python -m polymarket_bot.live --yes-really --bankroll 100
```

Risk manager navíc vynucuje: strop na pozici, strop na celkovou expozici, denní stop-loss
(kill-switch) a minimální objem trhu. Začněte s částkou, jejíž ztráta vás nebude bolet.

## Struktura

| Soubor | Co dělá |
|---|---|
| `polymarket_bot/gamma.py` | Klient Gamma API (metadata trhů, stav rozhodnutí) |
| `polymarket_bot/clob.py` | Klient CLOB API (cenové historie, midpoint, tick size) |
| `polymarket_bot/collect.py` | Stažení rozhodnutých trhů + historií do `data/` (obnovitelné) |
| `polymarket_bot/dataset.py` | Výroba trénovacích vzorků ze snímků před koncem trhu |
| `polymarket_bot/features.py` | Výpočet featur (cena, čas do konce, momentum, volatilita…) |
| `polymarket_bot/train.py` | Trénink + kalibrace, dvojitý časový split, Brier report |
| `polymarket_bot/backtest.py` | Walk-forward backtest s poplatky, skluzem, Kellym a risk limity |
| `polymarket_bot/strategy.py` | Rozhodovací jádro (edge vs. poplatky, výběr strany) |
| `polymarket_bot/sizing.py` | Kellyho kritérium (zlomkové, se stropem) |
| `polymarket_bot/risk.py` | Limity pozic, expozice, denní kill-switch (přežije restart) |
| `polymarket_bot/engine.py` | Společné jádro pro paper i live (settlement, signály) |
| `polymarket_bot/paper.py` | Paper trading smyčka nad živými cenami |
| `polymarket_bot/live.py` | Reálné objednávky přes py-clob-client (zamčené) |
| `polymarket_bot/ledger.py` | Účetní kniha pozic, obchodů a risk stavu (JSON) |
| `polymarket_bot/synth.py` | Syntetická data pro offline test pipeline |

## Pojistky proti tichým chybám

Věci, které bot dělá schválně, protože bez nich se účetnictví rozejde s realitou:

- **Paper i live jedou stejným kódem** (`engine.py`). Kdyby se lišily, výsledky
  z paper tradingu by o live režimu nic nevypovídaly.
- **Backtest prochází stejnými risk limity** jako živý bot. Bez toho by ukazoval
  obchody, které by bot nikdy neudělal, a nadhodnocoval výsledek.
- **Zrušené (voided) trhy se vypořádají a vrátí vklad.** Rozlišuje se „trh skončil
  bez výsledku" od „nepovedlo se stáhnout data" — jinak by zrušené trhy držely
  pozici navěky a ukrajovaly limit expozice.
- **Kill-switch přežije restart** (ukládá se do ledgeru). Restart procesu nesmí být
  cesta, jak obejít denní stop-loss.
- **Live objednávky jsou fill-and-kill**, ne visící limitky, a zapisuje se jen to,
  co se skutečně vyplnilo. Když nejde fill spolehlivě přečíst, bot se **zastaví**
  a vyzve k ruční kontrole místo hádání.
- **Sizing a limity počítají ze stejného základu** (hotovost + otevřené pozice).

## Testy

```bash
pip install pytest
pytest tests/                    # vše (64 testů, včetně end-to-end pipeline)
pytest tests/ -m "not slow"      # jen rychlé unit testy
```
