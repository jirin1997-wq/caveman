extension L10n {

    /// Czech source string → English. Keep the keys byte-identical to the Czech
    /// in the code, including the typographic quotes and ellipses.
    static let englishStrings: [String: String] = [
        // tabs
        "Let": "Flight",
        "Deník": "Logbook",
        "Nastavení": "Settings",
        "Jazyk": "Language",
        "Jazyk aplikace": "App language",

        // phases
        "ČEKÁM NA GPS": "WAITING FOR GPS",
        "NA ZEMI": "ON GROUND",
        "POJÍŽDÍM": "TAXI",
        "ROZJEZD": "TAKEOFF ROLL",
        "VE VZDUCHU": "AIRBORNE",
        "PŘIBLÍŽENÍ": "APPROACH",
        "ověřuji změnu stavu…": "confirming state change…",

        // live screen
        "Letový zapisovač": "Flight recorder",
        "RYCHLOST": "SPEED",
        "NAD ZEMÍ": "AGL",
        "STOUPÁNÍ": "V/S",
        "EMER": "EMER",
        "MENU": "MENU",
        "DIRECT": "DIRECT",
        "Záznam": "REC",
        "Zastavit": "STOP",
        "Direct-to: bez cíle — klepni pro výběr letiště": "Direct-to: no target — tap to choose a field",
        "Kurz": "Bearing",
        "Odhad": "ETA",
        "Trasa": "Track",
        "bodů": "points",
        "čekám na fixy": "waiting for fixes",
        "Povolení je jen „Při používání“ — se zhasnutým displejem se nezaznamenává. V Nastavení iOS přepni na „Vždy“.":
            "Location is set to “While Using” only, so nothing is recorded with the screen off. Switch to “Always” in iOS Settings.",
        "Poloha je zakázaná. Bez ní aplikace nic nezaznamená — povol ji v Nastavení iOS.":
            "Location is denied. Without it nothing gets recorded — allow it in iOS Settings.",
        "Terén pod letadlem": "Terrain under the aircraft",
        "Nejbližší letiště:": "Nearest airfield:",
        "Bez údaje o terénu — detekce jede jen podle rychlosti a stoupání.":
            "No terrain data — detection uses speed and climb only.",
        "Blok": "Block",
        "Pojíždění": "Taxi",
        "Poslední událost": "Last event",
        "PRŮBĚH LETU": "FLIGHT PROFILE",
        "Graf se kreslí od druhého bodu trasy.": "The graph draws from the second track point.",
        "Senzory telefonu": "Phone sensors",
        "barometr": "barometer",
        "bez barometru": "no barometer",
        "Tento telefon nemá barometr — AGL se počítá z GPS a terénu.":
            "This phone has no barometer — AGL is computed from GPS and terrain.",
        "Barometr se vynuluje, až letadlo chvíli postojí. Do té doby jede AGL z GPS.":
            "The barometer zeroes once the aircraft has stood still for a while. Until then AGL comes from GPS.",
        "Výška nad zemí měřená barometrem od poslední zastávky. Zrychlení":
            "Height above ground measured by barometer since the last stop. Acceleration",
        "Vzlet": "Takeoff",
        "Přistání": "Landing",
        "Vyjetí": "Off-blocks",
        "Zastavení": "On-blocks",
        "Ručně: vzlet": "Manual: takeoff",
        "Ručně: přistání": "Manual: landing",

        // 3D aircraft
        "Letadlo na stanovišti": "Aircraft on the apron",
        "Pohled na letadlo se točí podle kurzu z GPS.": "The aircraft turns to match the GPS track.",

        // EMER sheet
        "Nejbližší plochy": "Nearest fields",
        "Frekvence a délky drah v datech nejsou. Ověř je před přistáním na mapě letiště.":
            "Frequencies and runway lengths are not in the data. Check them on the airfield chart before landing.",
        "Žádná plocha v dosahu 60 km.": "No field within 60 km.",
        "Zavřít": "Close",
        "Zrušit": "Cancel",

        // DIRECT sheet
        "Vyber letiště, ke kterému letíš": "Choose the field you are flying to",
        "Zrušit cíl": "Clear target",
        "Hledat letiště": "Search fields",

        // MENU sheet
        "Ruční zápis": "Manual entry",
        "Ručně zapíše vzlet nebo přistání, když detekce něco vynechá.":
            "Logs a takeoff or landing by hand when detection misses one.",

        // settings
    ]
}
