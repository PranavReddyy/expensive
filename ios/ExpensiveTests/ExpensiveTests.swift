import XCTest
import UIKit
import SwiftUI
@testable import Expensive

final class ExpensiveTests: XCTestCase {
    func testTripPersonalBudgetDecoding() throws {
        let id = UUID().uuidString
        let json = """
        {"id":"\(id)","profile_id":"\(id)","name":"Trip","budget":500,"personal_budget":120,"starts_on":"2026-10-18","ends_on":"2026-10-20","completed":false}
        """
        let decoder = JSONDecoder(); decoder.keyDecodingStrategy = .convertFromSnakeCase
        let trip = try decoder.decode(Trip.self, from: Data(json.utf8))
        XCTAssertEqual(trip.personalBudget,120)
        XCTAssertEqual(trip.budget,500)
        let legacy = json.replacingOccurrences(of: "\"personal_budget\":120,", with: "")
        XCTAssertNil(try decoder.decode(Trip.self, from: Data(legacy.utf8)).personalBudget)
    }
    func testTripEqualSharesDetection() {
        let equal = TripEntry(id: UUID(), reason: "Bill", amount: 10, payer: nil, shares: ["me": Decimal(string: "3.34")!, "a": Decimal(string: "3.33")!, "b": Decimal(string: "3.33")!], createdAt: Date())
        XCTAssertTrue(equal.hasEqualShares)
        let custom = TripEntry(id: UUID(), reason: "Bill", amount: 10, payer: nil, shares: ["me": 3, "a": 7], createdAt: Date())
        XCTAssertFalse(custom.hasEqualShares)
    }
    func testAmountCalculationsAndValidation() throws {
        for (text, expected) in [("=120+80/2", "160"), ("=(120+80)/2", "100"), ("=10-3*2", "4"), ("=2×3÷4", "1.5"), ("=10/-2", "-5"), ("=.5+1.5", "2"), ("=0.1+0.2", "0.3"), ("=1/3", "0.33"), ("=1.005", "1.01"), ("=-1.005", "-1.01"), ("=1/3*3", "1")] {
            XCTAssertEqual(try AmountCalculation.parse(text), Decimal(string: expected), text)
        }
        for text in ["", "=", "=2+", "=1/0", "=0/0", "=2(3)", "=alert(1)", "=2**3", "=1e3", "=()", "=1 2", "=2+3)", "=10000000000", "1+2", "1.234", String(repeating: "=", count: 300)] {
            XCTAssertThrowsError(try AmountCalculation.parse(text), text)
        }
        XCTAssertThrowsError(try Money.parse("=-2"))
        XCTAssertEqual(try Money.parse("=-2", allowNegative: true), -2)
        XCTAssertThrowsError(try Money.parse("=1-1"))
        XCTAssertEqual(try Money.parse("=1-1", allowZero: true), 0)
        XCTAssertEqual(WatchAmountInput.applying("=", to: "120"), "=120")
        XCTAssertEqual(WatchAmountInput.applying("+", to: "=120"), "=120+")
    }
    @MainActor func testWatchRetryKeepsOnePhoneDraftAfterTimestampSerialization() async throws {
        let store = AppStore(), owner = UUID(), profile = UUID(), request = UUID()
        store.online = false
        store.user = AuthUser(id: owner, email: "watch-test@example.invalid", emailConfirmedAt: Date())
        defer { try? ExpenseOutbox.save([], owner: owner) }
        let date = Date(timeIntervalSince1970: 1700000000.123456)
        for _ in 0..<2 { try await store.addExpense(id: request, profile: profile, reason: "Watch test", amount: 1, category: nil, notes: "", date: date) }
        XCTAssertEqual(try ExpenseOutbox.read(owner: owner).count, 1)
        XCTAssertEqual(store.pendingExpenses.first?.id, request)
        do {
            try await store.addExpense(id: UUID(), profile: profile, reason: "Wrong account", amount: 1, category: nil, notes: "", date: date, expectedOwner: UUID())
            XCTFail("Watch request must not be reassigned to another signed-in owner")
        } catch { XCTAssertEqual(try ExpenseOutbox.read(owner: owner).count, 1) }
    }
    func testWatchPayloadPreservesOwnerAndRequestIdentity() throws {
        let request = WatchRequest(action: "expense", id: UUID(), owner: UUID(), profile: UUID(), reason: "Lunch", amount: "12.50", date: Date(), category: UUID())
        let data = try JSONEncoder().encode(request)
        let decoded = try JSONDecoder().decode(WatchRequest.self, from: data)
        XCTAssertEqual(decoded.id, request.id); XCTAssertEqual(decoded.owner, request.owner)
        XCTAssertEqual(decoded.profile, request.profile); XCTAssertEqual(decoded.amount, "12.50")
        XCTAssertEqual(decoded.category, request.category)
        XCTAssertNil(WatchSnapshot.signedOut.owner); XCTAssertTrue(WatchSnapshot.signedOut.recent.isEmpty)
    }
    func testWatchAmountKeypadAcceptsOnlyMoneyDigits() {
        XCTAssertEqual(WatchAmountInput.applying(".", to: ""), "0.")
        XCTAssertEqual(WatchAmountInput.applying(".", to: "1.2"), "1.2")
        XCTAssertEqual(WatchAmountInput.applying("3", to: "1.2"), "1.23")
        XCTAssertEqual(WatchAmountInput.applying("4", to: "1.23"), "1.23")
        XCTAssertEqual(WatchAmountInput.applying("a", to: "12"), "12")
        XCTAssertEqual(WatchAmountInput.applying("5", to: "0"), "5")
        XCTAssertEqual(WatchAmountInput.applying("delete", to: "12.3"), "12.")
        XCTAssertEqual(WatchAmountInput.applying("delete", to: ""), "")
        XCTAssertEqual(WatchAmountInput.applying("1", to: "9999999999"), "9999999999")
    }
    func testWatchSnapshotOptionsAndLegacyCompatibility() throws {
        let profile = WatchSnapshot.Profile(id: UUID(), name: "personal", balance: 100)
        let category = WatchSnapshot.Category(id: UUID(), name: "food")
        let snapshot = WatchSnapshot(owner: UUID(), profile: profile.id, name: profile.name, balance: profile.balance, currency: "₹", recent: [], updated: Date(), profiles: [profile], categories: [category])
        let data = try JSONEncoder().encode(snapshot)
        let decoded = try JSONDecoder().decode(WatchSnapshot.self, from: data)
        XCTAssertEqual(decoded.profiles?.first?.id, profile.id)
        XCTAssertEqual(decoded.categories?.first?.id, category.id)
        var legacy = try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])
        legacy.removeValue(forKey: "profiles"); legacy.removeValue(forKey: "categories")
        let old = try JSONDecoder().decode(WatchSnapshot.self, from: JSONSerialization.data(withJSONObject: legacy))
        XCTAssertNil(old.profiles); XCTAssertNil(old.categories)
        let request = WatchRequest.refresh
        XCTAssertNil(try JSONDecoder().decode(WatchRequest.self, from: JSONEncoder().encode(request)).category)
    }
    func testExpenseOutboxPersistsOnlyForItsOwner() throws {
        let owner = UUID(), other = UUID()
        let row = PendingExpense(owner: owner, id: UUID(), profile: UUID(), reason: "Lunch", amount: Decimal(string: "12.30")!, category: nil, notes: "", date: Date(timeIntervalSince1970: 1000))
        defer { try? ExpenseOutbox.save([], owner: owner) }
        try ExpenseOutbox.save([row], owner: owner)
        let saved = try ExpenseOutbox.read(owner: owner)
        XCTAssertEqual(saved.count, 1); XCTAssertEqual(saved.first?.id, row.id); XCTAssertEqual(saved.first?.amount, row.amount)
        XCTAssertThrowsError(try ExpenseOutbox.save([row], owner: other))
        XCTAssertTrue(try ExpenseOutbox.read(owner: other).isEmpty)
    }
    @MainActor func testRecurringFormKeepsKeyboardFlowAndTheme() async throws {
        for dark in [false, true] {
            let store = AppStore()
            let profile = Profile(id: UUID(), name: "personal", balance: 1000)
            store.profiles = [profile]; store.activeId = profile.id
            store.categories = [Category(id: UUID(), name: "food", sortOrder: 0), Category(id: UUID(), name: "bills", sortOrder: 1)]
            let host = UIHostingController(rootView: RecurringExpenseForm().environment(store).preferredColorScheme(dark ? .dark : .light).tint(Theme.ink))
            let window = UIWindow(frame: CGRect(x: 0, y: 0, width: 390, height: 844))
            window.rootViewController = host; window.makeKeyAndVisible(); host.view.layoutIfNeeded()
            try await Task.sleep(for: .milliseconds(600))
            func fields(_ view: UIView) -> [UITextField] { (view as? UITextField).map { [$0] } ?? view.subviews.flatMap(fields) }
            let first = fields(host.view).first { $0.isFirstResponder }
            XCTAssertEqual(first?.placeholder, "reason"); XCTAssertEqual(first?.returnKeyType, .next)
            let image = UIGraphicsImageRenderer(bounds: host.view.bounds).image { _ in host.view.drawHierarchy(in: host.view.bounds, afterScreenUpdates: true) }
            let attachment = XCTAttachment(image: image); attachment.name = dark ? "recurring-dark" : "recurring-light"; attachment.lifetime = .keepAlways; add(attachment)
            window.isHidden = true
        }
    }
    func testCustomRemainderOnlyFillsOneValidBlank() {
        XCTAssertEqual(Money.remainder("100", fields: ["20", "30", ""])?.value, "50")
        XCTAssertEqual(Money.remainder("100", fields: ["", "75"])?.index, 0)
        XCTAssertEqual(Money.remainder("100", fields: ["100", ""])?.value, "0")
        XCTAssertNil(Money.remainder("100", fields: ["", ""]))
        XCTAssertNil(Money.remainder("100", fields: ["101", ""]))
        XCTAssertNil(Money.remainder("100", fields: ["invalid", ""]))
        XCTAssertNil(Money.remainder("100", fields: ["20", "80"]))
    }
    func testExpenseAmountAndDateSorts() {
        let profile = UUID()
        let a = Expense(id: UUID(), profileId: profile, reason: "a", amount: 20, notes: nil, createdAt: Date(timeIntervalSince1970: 100), categoryId: nil, categories: nil)
        let b = Expense(id: UUID(), profileId: profile, reason: "b", amount: 10, notes: nil, createdAt: Date(timeIntervalSince1970: 200), categoryId: nil, categories: nil)
        XCTAssertEqual(ExpenseSort.newest.apply([a,b]).first?.id, b.id)
        XCTAssertEqual(ExpenseSort.oldest.apply([a,b]).first?.id, a.id)
        XCTAssertEqual(ExpenseSort.highest.apply([a,b]).first?.id, a.id)
        XCTAssertEqual(ExpenseSort.lowest.apply([a,b]).first?.id, b.id)
    }
    @MainActor func testShortcutRequestIsConsumedOnceAndExpires() {
        let route = ShortcutRoute()
        let now = Date()
        XCTAssertFalse(route.consumeExpense(now: now))
        route.requestExpense(now: now)
        XCTAssertTrue(route.consumeExpense(now: now.addingTimeInterval(1)))
        XCTAssertFalse(route.consumeExpense(now: now.addingTimeInterval(2)))
        route.requestExpense(now: now)
        route.requestExpense(now: now.addingTimeInterval(1))
        XCTAssertTrue(route.consumeExpense(now: now.addingTimeInterval(2)))
        XCTAssertFalse(route.consumeExpense(now: now.addingTimeInterval(3)))
        route.requestExpense(now: now)
        XCTAssertFalse(route.consumeExpense(now: now.addingTimeInterval(301)))
    }
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
        XCTAssertEqual(store.people(for: second.id), [person])
        XCTAssertEqual(store.activeId, first.id)
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
    @MainActor func testTripCacheClearsWhenSessionEnds() {
        let store = AppStore()
        let trip = Trip(id: UUID(), profileId: UUID(), name: "Weekend", budget: 5000, startsOn: "2026-10-15", endsOn: "2026-10-18", completed: false)
        store.tripLists[trip.profileId] = [trip]
        store.tripDetails[trip.id] = TripSnapshot(trip: trip, members: [], entries: [], debts: [])
        store.handle(AppError.signedOut)
        XCTAssertTrue(store.tripLists.isEmpty)
        XCTAssertTrue(store.tripDetails.isEmpty)
    }
    @MainActor func testCachedTripRendersInBothThemes() async throws {
        let store = AppStore()
        let profile = Profile(id: UUID(), name: "personal", balance: 5000)
        store.profiles = [profile]; store.activeId = profile.id; store.ledgerReady = true
        let trip = Trip(id: UUID(), profileId: profile.id, name: "A weekend away", budget: 8000, startsOn: "2026-10-15", endsOn: "2026-10-18", completed: false)
        let snapshot = TripSnapshot(trip: trip, members: [], entries: [TripEntry(id: UUID(), reason: "Dinner by the beach", amount: 1200, payer: nil, shares: ["me": 600], createdAt: .now)], debts: [])
        for scheme in [ColorScheme.light, .dark] {
            let content = NavigationStack { TripDetailView(trip: trip, initial: snapshot) }.environment(store).preferredColorScheme(scheme)
            let host = UIHostingController(rootView: content)
            let window = UIWindow(frame: CGRect(x: 0, y: 0, width: 390, height: 844))
            window.rootViewController = host; window.makeKeyAndVisible(); host.view.layoutIfNeeded()
            try await Task.sleep(for: .milliseconds(300))
            let image = UIGraphicsImageRenderer(bounds: host.view.bounds).image { _ in host.view.drawHierarchy(in: host.view.bounds, afterScreenUpdates: true) }
            window.isHidden = true
            XCTAssertGreaterThan(image.size.width, 300)
            let attachment = XCTAttachment(image: image)
            attachment.name = scheme == .dark ? "trip-dark" : "trip-light"; attachment.lifetime = .keepAlways; add(attachment)
        }
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
    func testSupabaseRESTSessionAndKeychainRoundTrip() throws {
        let data = Data(#"{"access_token":"supabase-token","refresh_token":"refresh","expires_in":3600,"user":{"id":"00000000-0000-0000-0000-000000000001","email":"owner@example.invalid","email_confirmed_at":"2026-10-14T10:00:00Z","app_metadata":{"username":"owner","providers":["email"]}}}"#.utf8)
        let session = try Wire.decoder().decode(Session.self, from: data).withExpiry
        XCTAssertEqual(session.user.username, "owner")
        XCTAssertEqual(session.expiresIn, 3600)
        let restored = try Wire.decoder().decode(Session.self, from: Wire.encoder().encode(session))
        XCTAssertEqual(restored.user.id, session.user.id)
        XCTAssertEqual(restored.user.username, "owner")
        XCTAssertEqual(restored.refreshToken, "refresh")
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
    func testCustomSplitRequiresExactTotalAndValidShares() throws {
        let split = try Money.customSplit(100, amounts: [20, 30], own: 50)
        XCTAssertEqual(split.amounts, [20, 30])
        XCTAssertEqual(split.own, 50)
        XCTAssertEqual(try Money.customSplit(100, amounts: [40, 60], own: 0).own, 0)
        XCTAssertThrowsError(try Money.customSplit(100, amounts: [40, 59], own: 0))
        XCTAssertThrowsError(try Money.customSplit(100, amounts: [40, 61], own: 0))
        XCTAssertThrowsError(try Money.customSplit(100, amounts: [], own: 100))
        XCTAssertThrowsError(try Money.customSplit(100, amounts: [0, 100], own: 0))
        XCTAssertThrowsError(try Money.customSplit(100, amounts: [101], own: -1))
        XCTAssertThrowsError(try Money.customSplit(1, amounts: [Decimal(string: "0.001")!], own: Decimal(string: "0.999")!))
        XCTAssertThrowsError(try Money.customSplit(.nan, amounts: [1], own: 0))
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
    func testTripEditingDecodesVersionAndCategory() throws {
        let data = Data(#"{"id":"00000000-0000-0000-0000-000000000001","reason":"Dinner","amount":120,"payer":null,"shares":{"me":50},"created_at":"2026-10-18T10:00:00Z","category_id":"00000000-0000-0000-0000-000000000002","version":4}"#.utf8)
        let entry = try Wire.decoder().decode(TripEntry.self, from: data)
        XCTAssertEqual(entry.version, 4)
        XCTAssertEqual(entry.categoryId?.uuidString.lowercased(), "00000000-0000-0000-0000-000000000002")
        XCTAssertEqual(entry.shares["me"], 50)
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
