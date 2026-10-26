import Foundation

/// A bounded decimal-expression parser. Never executes code or accepts functions.
enum AmountCalculation {
    enum Invalid: Error { case expression }
    static func parse(_ text: String) throws -> Decimal {
        let text = text.trimmingCharacters(in: .whitespacesAndNewlines)
        let value: Decimal
        if text.hasPrefix("=") {
            guard text.count <= 256 else { throw Invalid.expression }
            var parser = Parser(source: Array(text.dropFirst()))
            var raw = try parser.sum()
            parser.skip()
            guard parser.index == parser.source.count, !raw.isNaN else { throw Invalid.expression }
            var rounded = Decimal.zero
            NSDecimalRound(&rounded, &raw, 2, .plain)
            value = rounded
        } else {
            guard text.range(of: #"^-?\d+(\.\d{1,2})?$"#, options: .regularExpression) != nil,
                  let parsed = Decimal(string: text, locale: Locale(identifier: "en_US_POSIX")) else { throw Invalid.expression }
            value = parsed
        }
        guard !value.isNaN, abs(value) < Decimal(string: "10000000000")! else { throw Invalid.expression }
        return value
    }
    private struct Parser {
        let source: [Character]
        var index = 0
        mutating func skip() { while index < source.count && source[index].isWhitespace { index += 1 } }
        mutating func take(_ token: Character) -> Bool {
            skip()
            if index < source.count && source[index] == token { index += 1; return true }
            return false
        }
        func checked(_ value: Decimal) throws -> Decimal {
            guard !value.isNaN else { throw Invalid.expression }
            return value
        }
        mutating func factor() throws -> Decimal {
            if take("+") { return try factor() }
            if take("-") || take("−") { return try -factor() }
            if take("(") {
                let value = try sum()
                guard take(")") else { throw Invalid.expression }
                return value
            }
            skip(); let start = index
            while index < source.count && (source[index].isASCII && source[index].isNumber || source[index] == ".") { index += 1 }
            let token = String(source[start..<index])
            guard token.count <= 24, token.range(of: #"^(?:\d+(?:\.\d*)?|\.\d+)$"#, options: .regularExpression) != nil,
                  let value = Decimal(string: token, locale: Locale(identifier: "en_US_POSIX")) else { throw Invalid.expression }
            return value
        }
        mutating func product() throws -> Decimal {
            var value = try factor()
            while true {
                if take("*") || take("×") { value = try checked(value * factor()) }
                else if take("/") || take("÷") {
                    let divisor = try factor()
                    guard divisor != 0 else { throw Invalid.expression }
                    value = try checked(value / divisor)
                } else { return value }
            }
        }
        mutating func sum() throws -> Decimal {
            var value = try product()
            while true {
                if take("+") { value = try checked(value + product()) }
                else if take("-") || take("−") { value = try checked(value - product()) }
                else { return value }
            }
        }
    }
}
