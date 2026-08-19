# Voice Character Emulator — návrh přepracování (v2)

Tento dokument je zároveň **implementační zadání**. Kdo na tom bude pracovat dál, čte tohle.

---

## 1. Co je špatně na současné verzi

Poctivý audit toho, co je v repu teď (commity `7fdafc0` → `6cf6c32`):

| # | Problém | Dopad |
|---|---------|-------|
| 1 | `v2/cs_speaker_*` presety v `bark_generator.py` **neexistují** | Bark podporuje en, zh, fr, de, hi, it, ja, ko, pl, pt, ru, es, tr — **čeština v seznamu není**. Každá česká generace spadne nebo tiše fallbackne. |
| 2 | `rvc_voice_cloner.py` **není RVC** | Je to posun výšky tónu (`librosa.effects.pitch_shift`) podle průměrného F0, oříznutý na ±5 půltónů. Identita hlasu je nesená timbrem a formanty, ne výškou. Takhle to jako Robert Downey Jr. znít nebude — nikdy. Název souboru je zavádějící. |
| 3 | Trailery jako trénovací data | Hudba, výbuchy, více mluvčích, hlas dabéra upoutávky. Pro klonování je potřeba **čistá, suchá řeč jednoho člověka**. Trailer je nejhorší možný vstup. |
| 4 | YouTube ID jsou hádaná | Nikdy jsem je neověřil. Pravděpodobně mrtvé nebo jiné video. |
| 5 | Model se načítá při **každém** requestu | `spawn('python3', ...)` → načtení Barku/XTTS = 10–30 s režie na každou generaci. Zabijácké pro UX. |
| 6 | Zbytečná dvojvrstva Node + Python | Veškeré ML je v Pythonu. Node přidává hranici procesů, JSON serializaci a druhý strom závislostí — bez jakéhokoli přínosu. |
| 7 | Blokující HTTP request | Operace na desítky sekund drží spojení. |
| 8 | Emoce jako `[Angry]` v textu | XTTS to prostě **přečte nahlas** nebo ignoruje. Emoce musí přijít odjinud (viz §4). |
| 9 | Chybí to, co postavu dělá postavou | Viz §3 — zásadní bod. |

Bod 2 a 9 jsou ty důležité. Zbytek je běžný technický dluh.

---

## 2. Volba modelu

| Model | Čeština | Klonování | Licence | Kvalita | Verdikt |
|-------|:---:|:---:|---|---|---|
| **XTTS-v2** (Coqui) | ✅ `cs` | zero-shot, ~6 s vzorku | CPML (**nekomerční**) | velmi dobrá | ✅ **doporučeno** |
| Chatterbox (Resemble) | ❌ | zero-shot | MIT | nejlepší | ❌ čeština chybí |
| Fish Speech | ❌ (8 jaz.) | zero-shot | Apache 2.0 | dobrá | ❌ čeština chybí |
| Bark | ❌ | ne | MIT | slabá, pomalá | ❌ současná volba, špatná |
| Piper | ✅ | ❌ ne | MIT | dobrá | jen jako CZ fallback |
| ElevenLabs | ✅ | ✅ | placené, cloud | nejlepší | viz §6 |

**XTTS-v2 je jediný open-source model, který umí zároveň češtinu i zero-shot klonování.** Navíc umí *cross-lingual*: vzorek anglického herce → česká věta jeho hlasem. Přesně to, co chceš.

Důsledek pro architekturu: **zero-shot znamená žádný trénink.** Celá vrstva „stáhni video → natrénuj model → 1–2 min čekání" **zmizí**. Stačí referenční klip a jede se.

Rizika: Coqui jako firma skončila 2024, upstream je neudržovaný — funguje komunitní fork (`coqui-tts`, idiap). Licence CPML je nekomerční, což pro osobní projekt nevadí, pro produkt ano.

---

## 3. Klíčový poznatek: hlas ≠ postava

Jack Sparrow není timbre Johnnyho Deppa. Je to **"savvy?"**, námořnické metafory, roztěkaná syntax, věty co začnou jinde než skončí.
Batman je úsečnost. Charlie Harper je sebeironie a alkohol. Bond je podchlazená zdvořilost.

Současný design tuhle půlku problému **vůbec neřeší** — vezme tvůj text doslova a jen na něj nasadí barvu hlasu.

Návrh: **dvoufázová generace.**

```
Vstup:  "Ahoj, jak se máš?"
   │
   ├─ Fáze 1 — LLM přepis do osobnosti postavy   (volitelná, ~0,5 s)
   │     "Ale ale ale… podívejme, kdo se to tu zjevil. Savvy?"
   │
   └─ Fáze 2 — XTTS: timbre z referenčního klipu  (~1–5 s)
         🔊 audio
```

Fáze 1 je levná, okamžitá, právně bezproblémová a subjektivně dělá **možná půlku výsledného dojmu**. Fáze 2 bez fáze 1 zní jako herec čtoucí cizí scénář — protože přesně to to je.

Implementace fáze 1: Claude API pokud je klíč v `.env`, jinak se přeskočí (graceful degradation). Per-postava system prompt v `characters.yaml`. V UI přepínač „přepsat do stylu postavy".

---

## 4. Emoce — jak správně

XTTS-v2 (open weights) **nemá parametr emoce**. Emoce se přenáší z **referenčního klipu**.

Takže místo `[Angry]` v textu:

```
refs/
  batman/
    en/
      neutral.wav      ← klidná scéna
      angry.wav        ← naštvaná scéna
    cs/
      neutral.wav
  ironman/
    en/
      neutral.wav
      sarcastic.wav
```

Výběr emoce v UI = výběr referenčního klipu. Chybí-li klip pro danou emoci → fallback na `neutral.wav`.
Doplňkově lze jemně modulovat `speed` (XTTS parametr) a `temperature`.

Tohle je **jediný způsob, jak z XTTS dostat skutečnou emoci.** Textové tagy nefungují.

---

## 5. Referenční klipy: bring-your-own

Zahodit `youtube_extractor.py` úplně.

Místo toho: uživatel nahraje klip přes UI (nebo hodí `.wav` do `refs/<postava>/<jazyk>/<emoce>.wav`).

Proč je to i **technicky** lepší, nejen právně:
- Uživatel vybere čistou repliku bez hudby — automat to neumí.
- Žádná speaker diarization, žádné oddělování hudby, žádné mrtvé YouTube ID.
- 6–20 s stačí. Delší klip kvalitu **nezlepší**.

UI dostane jednoduchý uploader s validací: mono, 16 kHz+, 6–30 s, doporučení „čistá řeč, bez hudby a ruchů".

---

## 6. Právní rovina — stručně a věcně

Ne kázání, jen fakta, ať víš, do čeho jdeš:

- Hlas herce spadá v ČR pod **projevy osobní povahy** (§ 84 a násl. občanského zákoníku). Soukromé použití je jiná situace než zveřejnění.
- **EU AI Act, čl. 50** (povinnosti transparentnosti u deepfake) je účinný **od srpna 2026** — tedy teď.
- Licence **XTTS-v2 je nekomerční** (CPML). Na hraní OK, na produkt ne.
- ElevenLabs v ToS klonování cizích hlasů bez souhlasu **zakazuje** — takže tudy cesta k „reálnému hercovi" stejně nevede.

**Praktický dopad:** na osobní hraní doma to nikoho nezajímá. Ve chvíli, kdy to někam pustíš ven, je to jiná věc. Design „bring-your-own klip" (§5) tohle rozhodnutí nechává na tobě, kam patří — a shodou okolností je to i lepší inženýrské řešení.

**Alternativa bez klonování:** popsat hlas slovně místo klonování osoby — „hluboký, chraplavý, brooding, muž kolem 45". ElevenLabs Voice Design to umí. V kombinaci s fází 1 (§3) dostaneš něco, co **čte se jako postava**, aniž bys klonoval konkrétního člověka. Stojí to peníze, ale je to čisté a kvalita je nejvyšší z celé tabulky.

---

## 7. Cílová architektura

Zahodit Node úplně. Jeden Python proces.

```
voice-character-emulator/
├── app/
│   ├── main.py            # FastAPI: statika + API
│   ├── tts.py             # XTTS wrapper, model načtený JEDNOU při startu
│   ├── personality.py     # fáze 1 — LLM přepis (volitelné)
│   ├── jobs.py            # in-memory fronta, async generace
│   └── refs.py            # správa + validace referenčních klipů
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
POST /api/refs/<character>/<lang>/<emotion>   # upload klipu
POST /api/generate  → {"job_id": "..."}        # NEblokuje
GET  /api/jobs/<id> → {"status": "...", "audio_url": "..."}
GET  /audio/<file>
```

Zásadní změna: **model se načte jednou při startu a zůstane v RAM.** Odtud pramení skoro celé zrychlení.

Očekávaný výkon:

| | teď (návrh v1) | po přepracování |
|---|---|---|
| start serveru | okamžitý | ~20 s (načtení modelu) |
| první generace | 1–2 min | ~2–5 s |
| další generace | 30 s+ | ~1–3 s (GPU) / ~5–10 s (CPU) |
| trénink hlasu | 1–5 min/postava | **odpadá** |

---

## 8. Postup implementace

Pořadí je zvolené tak, aby po každém kroku šlo něco spustit.

1. **Úklid** — smazat `bark_generator.py`, `rvc_voice_cloner.py`, `youtube_extractor.py`, `src/api/*.js`, `package.json`. Zachovat `web/` a `characters.json` (převést na `characters.yaml`).
2. **Kostra FastAPI** — `main.py`, servírování statiky, `/api/characters` z YAMLu. Spustitelné, UI se načte.
3. **XTTS integrace** — `tts.py`, model načtený při startu, jeden testovací endpoint se zadrátovaným referenčním klipem. **Tady ověřit češtinu na reálném vzorku, než se jde dál.**
4. **Job fronta** — `jobs.py`, `/api/generate` vrací `job_id`, UI polluje `/api/jobs/<id>` s progress barem.
5. **Referenční klipy** — `refs.py`, upload endpoint, validace, fallback na `neutral`, uploader v UI.
6. **Emoce** — napojení výběru emoce na výběr klipu, `speed`/`temperature` modulace.
7. **Fáze 1 (osobnost)** — `personality.py`, per-postava system prompty, přepínač v UI, běh bez API klíče musí fungovat.
8. **Dokumentace** — přepsat README a SETUP podle skutečnosti; smazat nepravdivé tabulky s `cs_speaker_*` a s YouTube odkazy.

Kroky 1–4 jsou jádro. Po kroku 4 to **reálně funguje**. 5–7 je dolaďování.

---

## 9. Co potřebuji rozhodnout od tebe

1. **XTTS-v2 (zdarma, lokálně, nekomerční licence)** — nebo **ElevenLabs (placené, nejvyšší kvalita, bez klonování herců)**? Výchozí doporučení: XTTS-v2.
2. **Fáze 1 (LLM přepis do stylu postavy)** — chceš ji? Podle mě je to největší přínos za nejmenší práci.
3. **Referenční klipy** — dodáš je sám (§5), nebo to má zůstat bez klonování a jet jen na popisu hlasu?

---

## 10. Zdroje

- [XTTS — coqui-tts dokumentace](https://coqui-tts.readthedocs.io/en/latest/models/xtts.html)
- [coqui/XTTS-v2 — Hugging Face](https://huggingface.co/coqui/XTTS-v2)
- [Chatterbox Multilingual — Resemble AI](https://www.resemble.ai/learn/models/chatterbox-multilingual)
- [resemble-ai/chatterbox — GitHub](https://github.com/resemble-ai/chatterbox)
- [Best Open-Source Alternatives to ElevenLabs 2026](https://blog.bymar.co/posts/open-source-voice-cloning-alternatives-elevenlabs-2026/)
- [XTTS v2 2026: Free Local Voice Cloning, 17 Languages](https://localaimaster.com/models/coqui-tts)
