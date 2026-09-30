import XCTest
import UIKit
@testable import Expensive

final class ExpensiveTests: XCTestCase {
    func testFirebaseRESTTokenFormats() throws {
        let signIn = Data(#"{"idToken":"firebase-id-token","refreshToken":"firebase-refresh-token","expiresIn":"3600","localId":"non-uuid-firebase-user"}"#.utf8)
        let initial = try JSONDecoder().decode(API.FirebaseCredentials.self, from: signIn)
        XCTAssertEqual(initial.idToken, "firebase-id-token")
        XCTAssertEqual(initial.expiresIn, "3600")
        let refresh = Data(#"{"id_token":"renewed-id-token","refresh_token":"renewed-refresh-token","expires_in":"3600","user_id":"non-uuid-firebase-user"}"#.utf8)
        let renewed = try Wire.decoder().decode(API.FirebaseRefresh.self, from: refresh)
        XCTAssertEqual(renewed.idToken, "renewed-id-token")
        XCTAssertEqual(renewed.refreshToken, "renewed-refresh-token")
        XCTAssertEqual(Double(renewed.expiresIn), 3600)
    }

    func testBootstrapDecodesMappedUUIDAndSharedUsername() throws {
        let data = Data(#"{"id":"00000000-0000-0000-0000-000000000001","email":"test@example.com","username":"test_user","email_confirmed_at":"2026-09-30T12:00:00.000Z"}"#.utf8)
        let user = try Wire.decoder().decode(AuthUser.self, from: data)
        XCTAssertEqual(user.id.uuidString.lowercased(), "00000000-0000-0000-0000-000000000001")
        XCTAssertEqual(user.username, "test_user")
        XCTAssertNotNil(user.emailConfirmedAt)
    }
    func testOriginalFontsAreBundled() {
        for name in ["IBMPlexMono", "IBMPlexMono-Medm", "IBMPlexMono-SmBld"] {
            XCTAssertNotNil(UIFont(name: name, size: 14), "Missing font: \(name)")
        }
    }
    func testSplitPreservesEveryPaise() throws {
        let result = try Money.split(100, people: 2, includesYou: true)
        XCTAssertEqual(result.amounts, [Decimal(string: "33.34")!, Decimal(string: "33.33")!])
        XCTAssertEqual(result.own, Decimal(string: "33.33"))
        XCTAssertEqual(result.amounts.reduce(result.own, +), 100)
        let withoutOwn = try Money.split(Decimal(string: "0.05")!, people: 3, includesYou: false)
        XCTAssertEqual(withoutOwn.amounts.reduce(0, +), Decimal(string: "0.05"))
        XCTAssertThrowsError(try Money.split(Decimal(string: "0.01")!, people: 2, includesYou: false))
    }
    func testMoneyRejectsInvalidValues() throws {
        for input in ["", "nan", "1e3", "1.001", "-1", "0", "10000000000", "1,000"] { XCTAssertThrowsError(try Money.parse(input)) }
        XCTAssertEqual(try Money.parse("0", allowZero: true), 0)
        XCTAssertEqual(try Money.parse("-12.20", allowNegative: true), Decimal(string: "-12.2"))
        XCTAssertEqual(try Money.parse("123456.78"), Decimal(string: "123456.78"))
    }
    func testMonthNavigationCannotSkipFebruary() throws {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(secondsFromGMT: 0)!
        let january = calendar.date(from: DateComponents(year: 2026, month: 1, day: 31))!
        let february = Period.month.shifted(january, by: 1, calendar: calendar)
        XCTAssertEqual(calendar.component(.month, from: february), 2)
        XCTAssertEqual(calendar.component(.day, from: february), 1)
        let interval = Period.month.interval(containing: february, calendar: calendar)!
        XCTAssertTrue(Period.month.contains(interval.start, anchor: february, calendar: calendar))
        XCTAssertFalse(Period.month.contains(interval.end, anchor: february, calendar: calendar))
    }
    func testSupabaseDatesAndMoneyDecodeExactly() throws {
        let data = Data(#"{"id":"00000000-0000-0000-0000-000000000001","profile_id":"00000000-0000-0000-0000-000000000002","reason":"Lunch","amount":1234.56,"notes":null,"created_at":"2026-09-29T10:30:00.123456+00:00","category_id":null,"categories":null}"#.utf8)
        let expense = try Wire.decoder().decode(Expense.self, from: data)
        XCTAssertEqual(expense.amount, Decimal(string: "1234.56"))
        XCTAssertEqual(expense.reason, "Lunch")
    }
    func testTabsOffsetBothDirectionsWithoutLosingEntries() {
        let profile = UUID(), personID = UUID()
        let person = Person(id: personID, profileId: profile, name: "Sam")
        let collect = Debt(id: UUID(), profileId: profile, personId: personID, direction: .collect, amount: 100, remainingAmount: 60, description: "Lunch", createdAt: .now)
        let pay = Debt(id: UUID(), profileId: profile, personId: personID, direction: .pay, amount: 20, remainingAmount: 20, description: "Coffee", createdAt: .now)
        let tab = PersonTab(person: person, entries: [collect, pay])
        XCTAssertEqual(tab.net, 40)
        XCTAssertEqual(tab.collect, 60)
        XCTAssertEqual(tab.pay, 20)
        XCTAssertEqual(tab.entries.count, 2)
    }
    func testSessionPersistsAbsoluteExpiry() throws {
        let user = AuthUser(id: UUID(), email: "test@example.com", emailConfirmedAt: .now)
        let session = Session(accessToken: "test", refreshToken: "test", expiresIn: 3600, expiresAt: nil, user: user).withExpiry
        let restored = try Wire.decoder().decode(Session.self, from: Wire.encoder().encode(session))
        XCTAssertNotNil(restored.expiresAt)
        XCTAssertEqual(restored.expiresAt, session.expiresAt)
    }
}
