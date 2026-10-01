import XCTest
import UIKit
import SwiftUI
@testable import Expensive

final class ExpensiveTests: XCTestCase {
    @MainActor func testStartupValidationBlocksFinancialReadsAndRefreshes() async throws {
        let store = AppStore()
        store.user = AuthUser(id: UUID(), email: "test@example.com", emailConfirmedAt: Date(), username: "test")
        store.validating = true
        let revision = store.revision
        await store.refresh()
        await store.synchronize()
        XCTAssertFalse(store.loading)
        XCTAssertEqual(store.revision, revision)
        do {
            _ = try await store.expenses(interval: nil)
            XCTFail("Preview must not start a financial read")
        } catch is CancellationError {} catch { XCTFail("Unexpected error: \(error)") }
    }
    func testSavedOverviewIsOwnerScopedExpiresAndClears() throws {
        let owner = UUID(), other = UUID()
        defer { SavedOverview.clear(owner: owner) }
        let profile = Profile(id: UUID(), name: "cached", balance: 123)
        SavedOverview(owner: owner, savedAt: Date(), profiles: [profile], categories: [], people: [], debts: [], expenses: [:]).save()
        XCTAssertEqual(SavedOverview.read(owner: owner)?.profiles.first?.balance, 123)
        XCTAssertNil(SavedOverview.read(owner: other))
        SavedOverview(owner: owner, savedAt: Date().addingTimeInterval(-86401), profiles: [profile], categories: [], people: [], debts: [], expenses: [:]).save()
        XCTAssertNil(SavedOverview.read(owner: owner))
        SavedOverview(owner: owner, savedAt: Date(), profiles: [profile], categories: [], people: [], debts: [], expenses: [:]).save()
        SavedOverview.clear(owner: owner)
        XCTAssertNil(SavedOverview.read(owner: owner))
    }
    @MainActor func testExpenseFormFocusesFirstInputAndDarkActionsRender() async throws {
        let store = AppStore()
        let profile = Profile(id: UUID(), name: "personal", balance: 1000)
        let host = UIHostingController(rootView: ExpenseForm(profile: profile).environment(store).preferredColorScheme(.dark).tint(Theme.ink))
        let window = UIWindow(frame: CGRect(x: 0, y: 0, width: 390, height: 844))
        window.rootViewController = host; window.makeKeyAndVisible()
        defer { window.isHidden = true }
        host.view.layoutIfNeeded()
        try await Task.sleep(for: .milliseconds(900))
        func fields(_ view: UIView) -> [UITextField] {
            (view as? UITextField).map { [$0] } ?? view.subviews.flatMap(fields)
        }
        let first = fields(host.view).first { $0.isFirstResponder }
        XCTAssertEqual(first?.placeholder, "what was it for?")
        XCTAssertEqual(first?.returnKeyType, .next)
        let image = UIGraphicsImageRenderer(bounds: host.view.bounds).image { _ in
            host.view.drawHierarchy(in: host.view.bounds, afterScreenUpdates: true)
        }
        let attachment = XCTAttachment(image: image)
        attachment.name = "expense-keyboard-dark"; attachment.lifetime = .keepAlways; add(attachment)
    }
    @MainActor func testPrimaryActionsRenderWithExplicitContrastInBothModes() async throws {
        for dark in [false, true] {
            let view = VStack(spacing: 24) {
                Button("+ log expense") {}.buttonStyle(PrimaryActionStyle())
                Button("+ add amount") {}.buttonStyle(PrimaryActionStyle())
                Button("record") {}.buttonStyle(PrimaryActionStyle())
                Button("cancel") {}.buttonStyle(.glass)
            }.padding(30).frame(maxWidth: .infinity, maxHeight: .infinity).background(Theme.background)
                .tint(Theme.ink).preferredColorScheme(dark ? .dark : .light)
            let host = UIHostingController(rootView: view)
            let window = UIWindow(frame: CGRect(x: 0, y: 0, width: 390, height: 844))
            window.rootViewController = host; window.makeKeyAndVisible(); host.view.layoutIfNeeded()
            try await Task.sleep(for: .milliseconds(250))
            let image = UIGraphicsImageRenderer(bounds: host.view.bounds).image { _ in host.view.drawHierarchy(in: host.view.bounds, afterScreenUpdates: true) }
            window.isHidden = true
            let attachment = XCTAttachment(image: image)
            attachment.name = dark ? "actions-dark" : "actions-light"; attachment.lifetime = .keepAlways; add(attachment)
        }
    }
    @MainActor func testAppearanceModesAndDarkAccountSheet() async throws {
        XCTAssertNil(AppAppearance.system.colorScheme)
        XCTAssertEqual(AppAppearance.light.colorScheme, .light)
        XCTAssertEqual(AppAppearance.dark.colorScheme, .dark)
        let store = AppStore()
        store.user = AuthUser(id: UUID(), email: "a.very.long.email.address.for.layout.testing@example.com", emailConfirmedAt: .now, username: "test_account")
        let host = UIHostingController(rootView: AccountSettingsView().environment(store).preferredColorScheme(.dark).tint(Theme.ink))
        let window = UIWindow(frame: CGRect(x: 0, y: 0, width: 390, height: 844))
        window.rootViewController = host; window.makeKeyAndVisible()
        host.view.layoutIfNeeded()
        try await Task.sleep(for: .milliseconds(250))
        let image = UIGraphicsImageRenderer(bounds: host.view.bounds).image { _ in
            host.view.drawHierarchy(in: host.view.bounds, afterScreenUpdates: true)
        }
        window.isHidden = true
        let attachment = XCTAttachment(image: image)
        attachment.name = "dark-account-settings"; attachment.lifetime = .keepAlways; add(attachment)
    }
    @MainActor func testForegroundRefreshDoesNotQueueWhileLoadingOrSignedOut() async {
        let store = AppStore()
        let revision = store.revision
        await store.synchronizeIfStale()
        XCTAssertEqual(store.revision, revision)
        store.user = AuthUser(id: UUID(), email: "test@example.com", emailConfirmedAt: .now)
        store.loading = true
        await store.synchronizeIfStale()
        XCTAssertEqual(store.revision, revision)
    }
    @MainActor func testProfileSnapshotMakesEveryLedgerImmediatelyAvailable() {
        let store = AppStore(), owner = UUID()
        let first = Profile(id: UUID(), name: "bank", balance: 1000)
        let second = Profile(id: UUID(), name: "cash", balance: 200)
        let empty = Profile(id: UUID(), name: "savings", balance: 3000)
        let person = Person(id: UUID(), profileId: second.id, name: "Sam")
        let debt = Debt(id: UUID(), profileId: second.id, personId: person.id, direction: .collect, amount: 75, remainingAmount: 50, description: "Lunch", createdAt: .now)
        store.installSnapshot(profiles: [first, second, empty], categories: [], people: [person], debts: [debt], owner: owner)
        XCTAssertTrue(store.ledgerReady)
        XCTAssertEqual(store.active?.balance, 1000)
        store.select(second.id)
        XCTAssertTrue(store.ledgerReady)
        XCTAssertEqual(store.collect, 50)
        XCTAssertEqual(store.people, [person])
        store.select(empty.id)
        XCTAssertTrue(store.ledgerReady)
        XCTAssertEqual(store.collect, 0)
        XCTAssertTrue(store.people.isEmpty)
        store.select(second.id)
        XCTAssertEqual(store.collect, 50)
        // A settlement refresh replaces cached values for every profile.
        store.installSnapshot(profiles: [first, second, empty], categories: [], people: [person], debts: [], owner: owner)
        XCTAssertEqual(store.collect, 0)
        store.select(first.id); store.select(second.id)
        XCTAssertEqual(store.collect, 0)
        store.handle(AppError.signedOut)
        store.select(second.id)
        XCTAssertFalse(store.ledgerReady)
        XCTAssertTrue(store.people.isEmpty)
    }
    @MainActor func testSimplifiedHomeRendersWithOpenTabs() async throws {
        let profile = Profile(id: UUID(), name: "personal", balance: 24580)
        let store = AppStore()
        store.profiles = [profile]; store.activeId = profile.id; store.ledgerReady = true
        let today = Calendar.current.startOfDay(for: .now)
        let amounts: [Decimal] = [240, 0, 600, 180, 0, 450, 320]
        let points = amounts.enumerated().map { SpendPoint(date: Calendar.current.date(byAdding: .day, value: $0.offset - 6, to: today)!, amount: $0.element) }
        let content = Page {
            ProfileSegments(profiles: [profile], selection: profile.id, select: { _ in })
            BalanceBlock(edit: {})
            HStack {
                Button {} label: { Text("+ log expense").frame(maxWidth: .infinity) }.buttonStyle(.glassProminent)
                Button("transfer") {}.buttonStyle(.glass)
            }.font(Theme.font(12)).controlSize(.large)
            Divider()
            HomeSpendingSummary(today: 320, month: 5420, points: points)
        }.tint(.black).preferredColorScheme(.light).environment(store)
        let host = UIHostingController(rootView: content)
        let window = UIWindow(frame: CGRect(x: 0, y: 0, width: 390, height: 844))
        window.rootViewController = host; window.makeKeyAndVisible()
        host.view.layoutIfNeeded()
        try await Task.sleep(for: .milliseconds(250))
        let image = UIGraphicsImageRenderer(bounds: host.view.bounds).image { _ in
            host.view.drawHierarchy(in: host.view.bounds, afterScreenUpdates: true)
        }
        window.isHidden = true
        XCTAssertGreaterThan(image.size.width, 300)
        let attachment = XCTAttachment(image: image)
        attachment.name = "simplified-home"; attachment.lifetime = .keepAlways; add(attachment)
    }
    @MainActor func testCurrencyOnlyChangesSymbolAndIsScopedToAccount() {
        let preference = CurrencyPreference.shared
        let first = UUID(), second = UUID()
        defer {
            UserDefaults.standard.removeObject(forKey: "currency.\(first.uuidString)")
            UserDefaults.standard.removeObject(forKey: "currency.\(second.uuidString)")
            preference.load(user: nil)
        }
        preference.load(user: first); preference.code = "USD"
        XCTAssertTrue(Money.format(1234.56).contains("$"))
        XCTAssertTrue(Money.format(1234.56).contains("1,234.56"))
        preference.load(user: second)
        XCTAssertEqual(preference.code, "INR")
        preference.load(user: first)
        XCTAssertEqual(preference.code, "USD")
    }
    @MainActor func testSwitchingProfilesDoesNotPresentOldLedgerAsLoaded() {
        let store = AppStore()
        store.activeId = UUID(); store.ledgerReady = true
        store.select(UUID())
        XCTAssertFalse(store.ledgerReady)
        XCTAssertTrue(store.debts.isEmpty)
    }
    @MainActor func testAccountRailAndChartRenderAtPhoneAndAccessibilitySizes() async throws {
        let profiles = [Profile(id: UUID(), name: "daily spending", balance: 100), Profile(id: UUID(), name: "savings & emergencies", balance: 200), Profile(id: UUID(), name: "cash", balance: 50)]
        let start = Calendar.current.startOfDay(for: .now)
        let points = (0..<7).map { SpendPoint(date: Calendar.current.date(byAdding: .day, value: $0, to: start)!, amount: Decimal(($0 + 1) * 120)) }
        for large in [false, true] {
            let content = VStack(alignment: .leading, spacing: 24) {
                ProfileSegments(profiles: profiles, selection: profiles[1].id, select: { _ in })
                SectionLabel("spending")
                SpendingChart(points: points, height: 190, interactive: true)
            }.padding(22).frame(width: 390).background(Color.white).foregroundStyle(.black)
                .environment(\.dynamicTypeSize, large ? .accessibility2 : .large)
            // Native menus and scroll views need a real hosting window, not ImageRenderer.
            let host = UIHostingController(rootView: content)
            let window = UIWindow(frame: CGRect(x: 0, y: 0, width: 390, height: 844))
            window.rootViewController = host
            window.makeKeyAndVisible()
            host.view.setNeedsLayout(); host.view.layoutIfNeeded()
            try await Task.sleep(for: .milliseconds(250))
            let image = UIGraphicsImageRenderer(bounds: host.view.bounds).image { _ in
                host.view.drawHierarchy(in: host.view.bounds, afterScreenUpdates: true)
            }
            window.isHidden = true
            XCTAssertGreaterThan(image.size.height, 250)
            let attachment = XCTAttachment(image: image)
            attachment.name = large ? "account-rail-accessibility" : "account-rail-phone"
            attachment.lifetime = .keepAlways
            add(attachment)
        }
    }
    func testAnalyticsExcludesFutureAndOutsideRowsAndUsesElapsedCalendarDays() throws {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(secondsFromGMT: 0)!
        func date(_ day: Int) -> Date { calendar.date(from: DateComponents(year: 2026, month: 9, day: day, hour: 12))! }
        func expense(_ day: Int, _ amount: Decimal) -> Expense {
            Expense(id: UUID(), profileId: UUID(), reason: "Test", amount: amount, notes: nil, createdAt: date(day), categoryId: nil, categories: nil)
        }
        let interval = Period.month.interval(containing: date(10), calendar: calendar)!
        let summary = Insights.summary([expense(2, 60), expense(2, 40), expense(10, 100), expense(11, 900), expense(31, 999)], interval: interval, now: date(10), calendar: calendar)
        XCTAssertEqual(summary.total, 200)
        XCTAssertEqual(summary.expenses.count, 3)
        XCTAssertEqual(summary.elapsedDays, 10)
        XCTAssertEqual(summary.totalDays, 30)
        XCTAssertEqual(summary.completedNoSpendDays, 8)
        XCTAssertEqual(summary.dailyAverage, 20)
        XCTAssertEqual(summary.estimate, 600)
        XCTAssertEqual(summary.largest.map(\.amount), [100, 60, 40])
    }
    func testHistoricalLeapMonthAndEmptyAnalyticsDoNotProject() {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(secondsFromGMT: 0)!
        let date = calendar.date(from: DateComponents(year: 2024, month: 2, day: 1))!
        let interval = Period.month.interval(containing: date, calendar: calendar)!
        let summary = Insights.summary([], interval: interval, now: interval.end, calendar: calendar)
        XCTAssertEqual(summary.elapsedDays, 29)
        XCTAssertEqual(summary.completedNoSpendDays, 29)
        XCTAssertEqual(summary.dailyAverage, 0)
        XCTAssertNil(summary.estimate)
        let firstDay = Insights.summary([], interval: interval, now: date, calendar: calendar)
        XCTAssertEqual(firstDay.elapsedDays, 1)
        XCTAssertEqual(firstDay.completedNoSpendDays, 0)
        XCTAssertNil(firstDay.estimate)
    }
    func testChartBucketsIncludeZeroDaysAndRespectPeriodBoundary() {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(secondsFromGMT: 0)!
        let date = calendar.date(from: DateComponents(year: 2024, month: 2, day: 1))!
        let interval = Period.month.interval(containing: date, calendar: calendar)!
        let points = Insights.points([], interval: interval, calendar: calendar)
        XCTAssertEqual(points.count, 29)
        XCTAssertEqual(points.first?.date, interval.start)
        XCTAssertTrue(points.allSatisfy { $0.amount == 0 && $0.date < interval.end })
    }
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
