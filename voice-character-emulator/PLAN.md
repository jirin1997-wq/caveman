# Voice Character Emulator — návrh přepracování (v2)

Tento dokument je zároveň **implementační zadání**. Kdo na tom pracuje dál, čte tohle.

**Zadání od uživatele:** zdarma, lokálně, nejvyšší dosažitelná kvalita, čeština + angličtina, hlasy reálných postav.

---

## 1. Co je špatně na současné verzi

Poctivý audit toho, co je v repu teď (commity `7fdafc0` → `6cf6c32`):

| # | Problém | Dopad |
|---|---------|-------|
| 1 | `v2/cs_speaker_*` presety v `bark_generator.py` **neexistují** | Bark podporuje en, zh, fr, de, hi, it, ja, ko, pl, pt, ru, es, tr — **čeština v seznamu není**. Každá česká generace spadne nebo tiše fallbackne. |
| 2 | `rvc_voice_cloner.py` **není RVC** | Je to posun výšky tónu (`librosa.effects.pitch_shift`) podle průměrného F0, oříznutý na ±5 půltónů. Identita hlasu je nesená timbrem a formanty, ne výškou. Takhle to jako Robert Downey Jr. znít nebude — nikdy. |
| 3 | Trailery jako referenční data | Hudba, výbuchy, více mluvčích, hlas dabéra upoutávky. Pro klonování je potřeba **čistá, suchá řeč jednoho člověka**. Trailer je nejhorší možný vstup. |
| 4 | YouTube ID jsou hádaná | Nikdy neověřená. Pravděpodobně mrtvá nebo jiné video. |
| 5 | Model se načítá při **každém** requestu | `spawn('python3', ...)` → načtení modelu = 10–30 s režie na každou generaci. |
| 6 | Zbytečná dvojvrstva Node + Python | Veškeré ML je v Pythonu. Node přidává hranici procesů a druhý strom závislostí bez přínosu. |
| 7 | Blokující HTTP request | Operace na desítky sekund drží spojení. |
| 8 | Emoce jako `[Angry]` v textu | XTTS to **přečte nahlas** nebo ignoruje. Emoce musí přijít odjinud (§5). |
| 9 | Chybí to, co postavu dělá postavou | Viz §4 — zásadní bod. |

Body 2 a 9 jsou ty důležité. Zbytek je běžný technický dluh.

---

## 2. ROZHODNUTO: XTTS-v2

| Model | Čeština | Klonování | Licence | Kvalita | Verdikt |
|-------|:---:|:---:|---|---|---|
| **XTTS-v2** | ✅ `cs` | zero-shot, ~6 s | CPML (nekomerční) | velmi dobrá | ✅ **vybráno** |
| IndexTTS-2 | ❌ | zero-shot | Apache 2.0 | nejlepší (en/zh) | ❌ bez češtiny |
| Chatterbox | ❌ | zero-shot | MIT | nejlepší | ❌ bez češtiny |
| Fish Speech V1.5 | ❌ | zero-shot | Apache 2.0 | velmi dobrá | ❌ bez češtiny |
| CosyVoice2 | ❌ | zero-shot | Apache 2.0 | velmi dobrá | ❌ bez češtiny |
| Bark | ❌ | ne | MIT | slabá, pomalá | ❌ současná volba |
| Piper | ✅ | ❌ | MIT | dobrá | jen nouzový CZ fallback |

Čeština je úzké hrdlo. Prakticky všechna SOTA open-source TTS z 2025/26 je en/zh.
**XTTS-v2 je jediný model splňující zároveň: zdarma + lokálně + čeština + zero-shot klonování.** V roce 2026 je stále považovaný za nejlepší lokální engine pro vícejazyčné klonování.

Bonus: umí **cross-lingual** — anglický vzorek herce → česká věta jeho hlasem.

### Údržba a instalace

Coqui jako firma skončila, ale existuje aktivně udržovaný fork **`idiap/coqui-ai-TTS`**, na PyPI jako **`coqui-tts`** — Python 3.10–3.14, předkompilovaná kolečka pro macOS/Windows/Linux.

```bash
# POŘADÍ JE DŮLEŽITÉ — od verze 0.27.4 se PyTorch neinstaluje sám
uv pip install torch torchaudio torchcodec --torch-backend=auto
pip install coqui-tts
```

> Při implementaci ověřit — packaging se mění. Zdroj: [idiap/coqui-ai-TTS #532](https://github.com/idiap/coqui-ai-TTS/discussions/532)

**Zero-shot = žádný trénink.** Celá vrstva „stáhni video → trénuj → čekej 2 min" **zmizí**.

---

## 3. Jak z toho vytáhnout maximum kvality

Seřazeno podle skutečného dopadu. Bod 1 rozhoduje víc než všechno ostatní dohromady.

### 1. Kvalita referenčního klipu — 80 % výsledku

Zero-shot klonování kopíruje **přesně to, co slyší**. Šum na vstupu = šum na výstupu.

**Dobrý klip:**
- 6–20 s (delší kvalitu **nezlepší**, jen zpomalí)
- Jeden mluvčí, žádná hudba, žádné ruchy, žádná dozvuková scéna
- Konzistentní tón napříč klipem
- Souvislá řeč, ne útržky
- Ideálně: rozhovor, podcast, audiokniha, komentář — **ne akční scéna z filmu**

**Předzpracování (automatické, v `refs.py`):**
```
načíst → mono → 22050 Hz → oříznout ticho → normalizovat hlasitost (−23 LUFS) → volitelně denoise
```
Na denoise: `deepfilternet` nebo `resemble-enhance`, obojí zdarma. Na špinavém zdroji to dělá znatelný rozdíl.

### 2. Best-of-N — levné a účinné

XTTS je stochastický: stejný vstup dá pokaždé trochu jiný výstup. Vygenerovat **3 varianty** a nechat uživatele vybrat je nejlevnější zlepšení vnímané kvality v celém projektu. Stojí to trojnásobek času generace (tj. pár sekund) a nula práce navíc.

### 3. Ladění parametrů XTTS

Vystavit v UI pod „pokročilé":

| Parametr | Výchozí | Efekt |
|---|---|---|
| `temperature` | 0.65 | níž = stabilnější, výš = výraznější projev |
| `repetition_penalty` | 2.0 | brání zadrhávání a opakování |
| `length_penalty` | 1.0 | délka promluvy |
| `top_k` / `top_p` | 50 / 0.85 | rozmanitost |
| `speed` | 1.0 | tempo (0.8–1.2 zní přirozeně) |
| `enable_text_splitting` | `True` | **nutné** u textu delšího než věta |

### 4. Krátké vstupy

XTTS degraduje na dlouhých blocích. Dělit po větách, generovat zvlášť, spojit. To dělá `enable_text_splitting`, ale vlastní dělení dává lepší kontrolu nad pauzami.

### 5. Poctivé očekávání

**Angličtina bude znatelně lepší než čeština.** Čeština je v tréninkovém mixu XTTS málo zastoupená. Co čekat:
- EN: velmi dobré, blízko originálu
- CZ z českého vzorku: dobré, občas divná prozodie u dlouhých slov
- CZ z anglického vzorku (cross-lingual): funguje, ale prosakuje anglický přízvuk — což u „Iron Mana mluvícího česky" může být paradoxně **žádoucí**

---

## 4. Klíčový poznatek: hlas ≠ postava

Jack Sparrow není timbre Johnnyho Deppa. Je to **„savvy?"**, námořnické metafory, roztěkaná syntax, věty co začnou jinde než skončí.
Batman je úsečnost. Charlie Harper je sebeironie. Bond je podchlazená zdvořilost.

Současný design tuhle půlku problému **vůbec neřeší** — vezme text doslova a jen na něj nasadí barvu hlasu.

**Dvoufázová generace:**

```
Vstup:  "Ahoj, jak se máš?"
   │
   ├─ Fáze 1 — LLM přepis do osobnosti postavy   (volitelná, ~0,5 s)
   │     "Ale ale ale… podívejme, kdo se to tu zjevil. Savvy?"
   │
   └─ Fáze 2 — XTTS: timbre z referenčního klipu  (~1–5 s)
         🔊 audio
```

Fáze 1 je levná, okamžitá, právně bezproblémová a dělá **možná půlku výsledného dojmu**. Fáze 2 bez fáze 1 zní jako herec čtoucí cizí scénář — protože přesně to to je.

**Implementace (pluggable, aby zůstalo zdarma):**
1. Běží-li lokální Ollama → použít ji (zdarma, ale ~4 GB model)
2. Je-li v `.env` `ANTHROPIC_API_KEY` → Claude API (přepis je ~200 tokenů, tedy zlomky haléře)
3. Jinak → fázi 1 přeskočit, aplikace funguje dál

Per-postava system prompt v `characters.yaml`. V UI přepínač „přepsat do stylu postavy" + náhled přepsaného textu **před** generací zvuku.

---

## 5. Emoce — jak správně

XTTS-v2 (open weights) **nemá parametr emoce**. Emoce se přenáší z **referenčního klipu**.

Místo `[Angry]` v textu:

```
refs/
  batman/
    en/  neutral.wav, angry.wav
    cs/  neutral.wav
  ironman/
    en/  neutral.wav, sarcastic.wav
```

Výběr emoce v UI = výběr referenčního klipu. Chybí-li klip pro danou emoci → fallback na `neutral.wav` (a UI to řekne).
Doplňkově jemná modulace přes `speed` a `temperature`.

Tohle je **jediný způsob, jak z XTTS dostat skutečnou emoci.** Textové tagy nefungují.

---

## 6. Referenční klipy: bring-your-own

`youtube_extractor.py` zahodit úplně.

Uživatel nahraje klip přes UI, nebo hodí `.wav` do `refs/<postava>/<jazyk>/<emoce>.wav`.

Proč je to i **technicky** lepší, nejen právně:
- Uživatel vybere čistou repliku bez hudby — automat to neumí
- Žádná speaker diarization, žádné oddělování hudby, žádná mrtvá videa
- 6–20 s stačí

UI: uploader s validací (mono, 16 kHz+, 6–30 s) a **okamžitou zpětnou vazbou na kvalitu** — délka, odhad SNR, detekce více mluvčích. Špatný klip má být odhalen při nahrání, ne až po deseti špatných generacích.

---

## 7. Právní rovina — stručně a věcně

Ne kázání, jen fakta:

- Hlas herce spadá v ČR pod **projevy osobní povahy** (§ 84 a násl. občanského zákoníku). Soukromé použití je jiná situace než zveřejnění.
- **EU AI Act, čl. 50** (transparentnost u deepfake) je účinný **od srpna 2026** — tedy teď.
- Licence **XTTS-v2 je CPML, nekomerční**. Na hraní OK, na produkt ne.

**Praktický dopad:** osobní hraní doma nikoho nezajímá. Pustit to ven je jiná věc. Design „bring-your-own klip" nechává rozhodnutí na tobě, kam patří.

---

## 8. Cílová architektura

Node zahodit. Jeden Python proces.

```
voice-character-emulator/
├── app/
│   ├── main.py            # FastAPI: statika + API
│   ├── tts.py             # XTTS wrapper, model načtený JEDNOU při startu
│   ├── personality.py     # fáze 1 — LLM přepis (volitelné, pluggable)
│   ├── jobs.py            # in-memory fronta, async generace
│   └── refs.py            # správa, validace a předzpracování klipů
├── characters.yaml        # postavy: osobnost, system prompt, mapování klipů
├── refs/                  # referenční klipy (gitignored)
├── out/                   # vygenerované audio (gitignored)
├── web/                   # stávající UI — z ~80 % použitelné
└── requirements.txt
```

API:

```
GET  /api/characters
GET  /api/emotions
POST /api/refs/<character>/<lang>/<emotion>   # upload + validace klipu
POST /api/generate  → {"job_id": "..."}        # NEblokuje
GET  /api/jobs/<id> → {"status", "takes": [...]}  # N variant
GET  /audio/<file>
```

**Model se načte jednou při startu a zůstane v RAM.** Odtud pramení skoro celé zrychlení.

| | teď (v1) | po přepracování |
|---|---|---|
| start serveru | okamžitý | ~20 s (načtení modelu) |
| první generace | 1–2 min | ~2–5 s |
| další generace | 30 s+ | ~1–3 s (GPU) / ~5–10 s (CPU) |
| trénink hlasu | 1–5 min/postava | **odpadá** |

---

## 9. Postup implementace

Pořadí je zvolené tak, aby po každém kroku šlo něco spustit.

1. **Úklid** — smazat `bark_generator.py`, `rvc_voice_cloner.py`, `youtube_extractor.py`, `src/api/*.js`, `package.json`. Zachovat `web/`, převést `characters.json` → `characters.yaml`.
2. **Kostra FastAPI** — `main.py`, statika, `/api/characters` z YAMLu. UI se načte.
3. **XTTS integrace** — `tts.py`, model načtený při startu, testovací endpoint se zadrátovaným klipem.
   ⚠️ **Tady ověřit češtinu na reálném vzorku, než se jde dál.** Je to jediný nezvalidovaný předpoklad celého návrhu.
4. **Job fronta** — `jobs.py`, `/api/generate` vrací `job_id`, UI polluje s progress barem.
5. **Referenční klipy** — `refs.py`: upload, validace, předzpracování (mono/22 k/trim/normalize), fallback na `neutral`. Uploader v UI.
6. **Emoce + best-of-N** — napojení emoce na výběr klipu, 3 varianty, výběr v UI.
7. **Fáze 1 (osobnost)** — `personality.py`, Ollama → Claude API → skip. Přepínač a náhled v UI.
8. **Pokročilé parametry** — temperature, speed atd. v UI pod rozbalovátkem.
9. **Dokumentace** — přepsat README a SETUP podle skutečnosti; smazat nepravdivé tabulky s `cs_speaker_*` a s YouTube odkazy.

Kroky 1–5 jsou jádro. **Po kroku 5 to reálně funguje.** 6–9 je dolaďování kvality.

---

## 10. Zbývá rozhodnout

1. **Fáze 1 (LLM přepis)** — Ollama (zdarma, 4 GB) nebo Claude API (haléře)? Nebo zatím vynechat?
2. **Referenční klipy** — dodáš je sám? Bez nich to bude jen obecný hlas, ne postava.

---

## 11. Zdroje

- [idiap/coqui-ai-TTS — udržovaný fork](https://github.com/idiap/coqui-ai-TTS/discussions/532)
- [XTTS — coqui-tts dokumentace](https://coqui-tts.readthedocs.io/en/latest/models/xtts.html)
- [coqui/XTTS-v2 — Hugging Face](https://huggingface.co/coqui/XTTS-v2)
- [XTTS v2 2026: Free Local Voice Cloning, 17 Languages](https://localaimaster.com/models/coqui-tts)
- [Chatterbox Multilingual — jazyky](https://www.resemble.ai/learn/models/chatterbox-multilingual)
- [Best Open Source Voice Cloning Tools 2026](https://www.resemble.ai/resources/best-open-source-ai-voice-cloning-tools)
