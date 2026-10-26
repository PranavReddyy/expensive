import Foundation

enum WatchAmountInput {
    static func applying(_ key: String, to value: String) -> String {
        if key == "delete" { return String(value.dropLast()) }
        if key == "=" { return value.hasPrefix("=") ? value : "=" + value }
        if value.hasPrefix("=") {
            guard value.count < 256, key.count == 1, "0123456789.+-*/()×÷".contains(key) else { return value }
            return value + key
        }
        if key == "." { return value.contains(".") ? value : (value.isEmpty ? "0." : value + ".") }
        guard key.count == 1, "0123456789".contains(key) else { return value }
        let next = value == "0" ? key : value + key
        let parts = next.split(separator: ".", omittingEmptySubsequences: false)
        guard parts[0].count <= 10, parts.count < 2 || parts[1].count <= 2 else { return value }
        return next
    }
}

struct WatchSnapshot: Codable, Sendable {
    struct Profile: Codable, Identifiable, Sendable {
        let id: UUID; let name: String; let balance: Decimal
    }
    struct Category: Codable, Identifiable, Sendable {
        let id: UUID; let name: String
    }
    struct Recent: Codable, Identifiable, Sendable {
        let id: UUID; let reason: String; let amount: Decimal; let date: Date
    }
    let owner: UUID?
    let profile: UUID?
    let name: String
    let balance: Decimal
    let currency: String
    let recent: [Recent]
    let updated: Date
    var profiles: [Profile]? = nil
    var categories: [Category]? = nil
    static var signedOut: Self { Self(owner: nil, profile: nil, name: "", balance: 0, currency: "", recent: [], updated: Date()) }
}

struct WatchRequest: Codable, Sendable {
    let action: String
    let id: UUID
    let owner: UUID?
    let profile: UUID?
    let reason: String
    let amount: String
    let date: Date
    var category: UUID? = nil
    static var refresh: Self { Self(action: "refresh", id: UUID(), owner: nil, profile: nil, reason: "", amount: "", date: Date()) }
}

struct WatchReply: Codable, Sendable {
    let accepted: Bool
    let message: String
    let snapshot: WatchSnapshot?
}

// WCSession reply closures are callable on any queue and invoked exactly once.
final class WatchReplyHandler: @unchecked Sendable {
    let send: (Data) -> Void
    init(_ send: @escaping (Data) -> Void) { self.send = send }
}
