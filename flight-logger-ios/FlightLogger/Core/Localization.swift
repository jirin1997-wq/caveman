import Foundation

/// The languages the app speaks.
enum AppLanguage: String, Codable, CaseIterable, Sendable {
    case system, czech, english

    /// Each option is named in its own language, so it can be found from either.
    var name: String {
        switch self {
        case .system: return "System · Systém"
        case .czech: return "Čeština"
        case .english: return "English"
        }
    }
}

/// Resolves a UI string into the active language.
///
/// Czech is the source language: every string in the code is Czech, and the
/// English table is keyed by those Czech strings. A string with no English
/// entry shows in Czech, so a missing translation degrades instead of breaking.
/// `tools/check-translations.py` lists the strings that still lack one.
enum L10n {

    enum Lang: Sendable { case cs, en }

    /// The language strings resolve to right now. Set from the settings.
    static var active: Lang = .cs

    static func resolve(_ setting: AppLanguage) -> Lang {
        switch setting {
        case .czech: return .cs
        case .english: return .en
        case .system:
            let first = Locale.preferredLanguages.first ?? "cs"
            return first.hasPrefix("cs") ? .cs : .en
        }
    }

    static func t(_ czech: String) -> String {
        guard active == .en else { return czech }
        return englishStrings[czech] ?? czech
    }
}
