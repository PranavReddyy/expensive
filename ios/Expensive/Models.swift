import Foundation

struct Profile: Codable, Identifiable, Hashable, Sendable {
    let id: UUID
    var name: String
    var balance: Decimal
}

struct Category: Codable, Identifiable, Hashable, Sendable {
    let id: UUID
    let name: String
    let sortOrder: Int?
}

struct Expense: Codable, Identifiable, Hashable, Sendable {
    let id: UUID
    let profileId: UUID
    let reason: String
    let amount: Decimal
    let notes: String?
    let createdAt: Date
    let categoryId: UUID?
    let categories: Category?
}

struct Person: Codable, Identifiable, Hashable, Sendable {
    let id: UUID
    let profileId: UUID
    let name: String
}

enum Direction: String, Codable, CaseIterable, Sendable {
    case collect = "they_owe_me", pay = "i_owe_them"
    var label: String { self == .collect ? "they owe me" : "I owe them" }
}

struct Debt: Codable, Identifiable, Hashable, Sendable {
    let id: UUID
    let profileId: UUID
    let personId: UUID
    let direction: Direction
    let amount: Decimal
    let remainingAmount: Decimal
    let description: String
    let createdAt: Date
}

struct PersonTab: Identifiable, Hashable, Sendable {
    let person: Person
    let entries: [Debt]
    var id: UUID { person.id }
    var collect: Decimal { entries.filter { $0.direction == .collect }.reduce(0) { $0 + $1.remainingAmount } }
    var pay: Decimal { entries.filter { $0.direction == .pay }.reduce(0) { $0 + $1.remainingAmount } }
    var net: Decimal { collect - pay }
    var open: Bool { collect + pay > 0 }
    var label: String { net > 0 ? "owes you" : net < 0 ? "you owe" : open ? "amounts cancel out" : "settled" }
}

enum Money {
    static func parse(_ text: String, allowNegative: Bool = false, allowZero: Bool = false) throws -> Decimal {
        let cleaned = text.trimmingCharacters(in: .whitespacesAndNewlines)
        let pattern = allowNegative ? #"^-?\d+(\.\d{1,2})?$"# : #"^\d+(\.\d{1,2})?$"#
        guard cleaned.range(of: pattern, options: .regularExpression) != nil,
              let value = Decimal(string: cleaned, locale: Locale(identifier: "en_US_POSIX")),
              abs(value) < 10_000_000_000, (allowNegative || value >= 0), (allowZero || value != 0)
        else { throw AppError.message("Enter a valid amount with up to two decimals.") }
        return value
    }

    static func format(_ amount: Decimal) -> String {
        let formatter = NumberFormatter()
        formatter.numberStyle = .currency
        formatter.locale = Locale(identifier: "en_IN")
        formatter.currencySymbol = "₹"
        formatter.minimumFractionDigits = 2
        formatter.maximumFractionDigits = 2
        return formatter.string(from: amount as NSDecimalNumber) ?? "₹0.00"
    }

    static func split(_ total: Decimal, people: Int, includesYou: Bool) throws -> (amounts: [Decimal], own: Decimal) {
        guard people > 0, total > 0, total < 10_000_000_000 else { throw AppError.message("Choose people and enter a valid amount.") }
        let pennies = total * 100
        let count = people + (includesYou ? 1 : 0)
        let units = NSDecimalNumber(decimal: pennies).int64Value
        guard Decimal(units) == pennies, units >= count else { throw AppError.message("Allow at least ₹0.01 for each person.") }
        let shares = (0..<count).map { Decimal(units / Int64(count) + (Int64($0) < units % Int64(count) ? 1 : 0)) / 100 }
        return (Array(shares.prefix(people)), includesYou ? shares[count - 1] : 0)
    }
}

enum Period: String, CaseIterable, Identifiable, Sendable {
    case day, week, month, year, all
    var id: String { rawValue }
    var component: Calendar.Component { switch self { case .day: .day; case .week: .weekOfYear; case .month: .month; case .year, .all: .year } }
    func interval(containing date: Date, calendar: Calendar = .current) -> DateInterval? {
        self == .all ? nil : calendar.dateInterval(of: component, for: date)
    }
    func shifted(_ date: Date, by amount: Int, calendar: Calendar = .current) -> Date {
        let start = interval(containing: date, calendar: calendar)?.start ?? date
        return calendar.date(byAdding: component, value: amount, to: start) ?? start
    }
    func contains(_ date: Date, anchor: Date, calendar: Calendar = .current) -> Bool {
        guard let interval = interval(containing: anchor, calendar: calendar) else { return true }
        return date >= interval.start && date < interval.end
    }
    func label(_ anchor: Date) -> String {
        guard let interval = interval(containing: anchor) else { return "all expenses" }
        switch self {
        case .day: return anchor.formatted(.dateTime.day().month(.abbreviated).year())
        case .week: return interval.start.formatted(.dateTime.day().month(.abbreviated)) + " – " + interval.end.addingTimeInterval(-1).formatted(.dateTime.day().month(.abbreviated).year())
        case .month: return anchor.formatted(.dateTime.month(.wide).year())
        case .year: return anchor.formatted(.dateTime.year())
        case .all: return "all expenses"
        }
    }
}

struct SpendPoint: Identifiable {
    var id: Date { date }
    let date: Date
    let amount: Decimal
}

enum Insights {
    static func points(_ expenses: [Expense], interval: DateInterval, unit: Calendar.Component = .day, calendar: Calendar = .current) -> [SpendPoint] {
        var result: [SpendPoint] = []
        var date = interval.start
        let groups = Dictionary(grouping: expenses) { calendar.dateInterval(of: unit, for: $0.createdAt)?.start ?? $0.createdAt }
        while date < interval.end, result.count < 400 {
            result.append(SpendPoint(date: date, amount: (groups[date] ?? []).reduce(0) { $0 + $1.amount }))
            guard let next = calendar.date(byAdding: unit, value: 1, to: date), next > date else { break }
            date = next
        }
        return result
    }
    static func categories(_ expenses: [Expense]) -> [(name: String, amount: Decimal)] {
        let groups = Dictionary(grouping: expenses, by: { $0.categories?.name ?? "uncategorized" })
        let totals: [(name: String, amount: Decimal)] = groups.map { name, items in
            (name: name, amount: items.reduce(Decimal.zero) { $0 + $1.amount })
        }
        return totals.sorted { $0.amount == $1.amount ? $0.name < $1.name : $0.amount > $1.amount }
    }
}

enum AppError: LocalizedError {
    case message(String), signedOut, verificationRequired, usernameRequired
    var errorDescription: String? {
        switch self {
        case .message(let text): text
        case .signedOut: "Please sign in again."
        case .verificationRequired: "Verify your email, then continue."
        case .usernameRequired: "Choose your shared username."
        }
    }
}

extension String {
    var trimmed: String { trimmingCharacters(in: .whitespacesAndNewlines) }
}
