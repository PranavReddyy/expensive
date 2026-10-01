import Foundation
import Observation

@MainActor @Observable final class AppStore {
    enum AuthStep { case signIn, verify, username }
    var authStep: AuthStep = .signIn
    var user: AuthUser?
    var starting = true
    var validating = false
    var loading = false
    var error: String?
    var profiles: [Profile] = []
    var categories: [Category] = []
    var people: [Person] = []
    var debts: [Debt] = []
    var activeId: UUID?
    var revision = 0
    var ledgerReady = false
    private var snapshotGeneration = UUID()
    private var ledgerByProfile: [UUID: (people: [Person], debts: [Debt])] = [:]
    private var cache: [String: (Date, [Expense])] = [:]
    private var refreshAgain = false
    private var lastRefresh: Date?
    var active: Profile? { profiles.first { $0.id == activeId } }
    var tabs: [PersonTab] { people.map { person in PersonTab(person: person, entries: debts.filter { $0.personId == person.id && $0.remainingAmount > 0 }) } }
    var collect: Decimal { debts.filter { $0.direction == .collect }.reduce(0) { $0 + $1.remainingAmount } }
    var pay: Decimal { debts.filter { $0.direction == .pay }.reduce(0) { $0 + $1.remainingAmount } }

    func bootstrap() async {
        guard !validating else { return }
        starting = true; validating = true; error = nil
        do {
            if let cachedUser = try await API.shared.cachedUser(), let saved = SavedOverview.read(owner: cachedUser.id) {
                user = cachedUser
                CurrencyPreference.shared.load(user: cachedUser.id)
                installSnapshot(profiles: saved.profiles, categories: saved.categories, people: saved.people, debts: saved.debts, owner: cachedUser.id)
                cache = (saved.expenses ?? [:]).mapValues { (Date.distantPast, $0) }
                starting = false
            }
            let verified = try await API.shared.restore()
            if verified?.id != user?.id { clearData() }
            user = verified; validating = false
            CurrencyPreference.shared.load(user: user?.id)
            revision += 1
        } catch {
            clearData(); user = nil; validating = false
            handle(error)
        }
        if user != nil {
            starting = false
            await refresh()
        }
        starting = false
    }
    func signIn(email: String, password: String, create: Bool) async throws {
        do {
            let next = try await API.shared.authenticate(email: email, password: password, create: create)
            await accept(next)
        } catch {
            // If signup succeeded but email delivery failed, offer resend immediately.
            if create {
                let pendingEmail = await API.shared.pendingEmail()
                if pendingEmail == email { authStep = .verify }
            }
            throw error
        }
    }
    func completeSignIn(username: String? = nil) async throws {
        let next: AuthUser
        if let username { next = try await API.shared.chooseUsername(username) }
        else { next = try await API.shared.completeAuthentication() }
        await accept(next)
    }
    private func accept(_ next: AuthUser) async {
        CurrencyPreference.shared.load(user: next.id)
        clearData(); user = next; error = nil
        authStep = .signIn
        await refresh()
    }
    func logout() async throws {
        try await API.shared.signOut()
        clearData(); user = nil; error = nil; authStep = .signIn
        CurrencyPreference.shared.load(user: nil)
    }
    private func clearData() {
        if let owner = user?.id { SavedOverview.clear(owner: owner) }
        lastRefresh = nil
        ledgerReady = false; snapshotGeneration = UUID(); ledgerByProfile = [:]
        profiles = []; categories = []; people = []; debts = []; activeId = nil
        cache = [:]; revision += 1
    }
    func handle(_ failure: Error) {
        if failure is CancellationError { return }
        if case AppError.verificationRequired = failure { authStep = .verify; error = nil; return }
        if case AppError.usernameRequired = failure { authStep = .username; error = nil; return }
        if case AppError.signedOut = failure {
            clearData(); user = nil; authStep = .signIn
        }
        error = failure.localizedDescription
    }
    func select(_ id: UUID?) {
        guard activeId != id else { return }
        activeId = id; error = nil
        applySelectedLedger()
        if let user { UserDefaults.standard.set(id?.uuidString, forKey: "profile.\(user.id)") }
    }
    private func applySelectedLedger() {
        let snapshot = activeId.flatMap { ledgerByProfile[$0] }
        people = snapshot?.people ?? []; debts = snapshot?.debts ?? []
        ledgerReady = snapshot != nil
    }

    // Publish a complete in-memory snapshot without suspending between balance
    // and ledger updates. All profiles are ready before the switcher sees them.
    func installSnapshot(profiles loadedProfiles: [Profile], categories loadedCategories: [Category], people loadedPeople: [Person], debts loadedDebts: [Debt], owner: UUID) {
        let peopleGroups = Dictionary(grouping: loadedPeople, by: \.profileId)
        let debtGroups = Dictionary(grouping: loadedDebts, by: \.profileId)
        ledgerByProfile = Dictionary(uniqueKeysWithValues: loadedProfiles.map {
            ($0.id, (people: peopleGroups[$0.id] ?? [], debts: debtGroups[$0.id] ?? []))
        })
        profiles = loadedProfiles; categories = loadedCategories; error = nil
        if !profiles.contains(where: { $0.id == activeId }) {
            let saved = UserDefaults.standard.string(forKey: "profile.\(owner)").flatMap(UUID.init(uuidString:))
            activeId = profiles.contains { $0.id == saved } ? saved : profiles.first?.id
        }
        applySelectedLedger()
    }
    func refresh() async {
        guard !validating, let owner = user?.id else { return }
        if loading { refreshAgain = true; return }
        let generation = snapshotGeneration
        loading = true
        defer {
            loading = false
            if refreshAgain { refreshAgain = false; Task { await refresh() } }
        }
        do {
            async let nextProfiles = API.shared.list(Profile.self, table: "profiles", query: [.init(name: "order", value: "created_at.asc,id.asc")])
            async let nextCategories = API.shared.list(Category.self, table: "categories", query: [.init(name: "order", value: "sort_order.asc,id.asc")])
            // RLS scopes these paginated reads to the signed-in user's profiles.
            async let nextPeople = API.shared.list(Person.self, table: "people", query: [.init(name: "order", value: "name.asc,id.asc")])
            async let nextDebts = API.shared.list(Debt.self, table: "debts", query: [.init(name: "remaining_amount", value: "gt.0"), .init(name: "order", value: "created_at.desc,id.desc")])
            let (p, c, people, debts) = try await (nextProfiles, nextCategories, nextPeople, nextDebts)
            guard user?.id == owner, generation == snapshotGeneration, !Task.isCancelled else { return }
            installSnapshot(profiles: p, categories: c, people: people, debts: debts, owner: owner)
            saveSnapshot(owner: owner)
            lastRefresh = Date()
        } catch { if user?.id == owner && generation == snapshotGeneration && !Task.isCancelled { handle(error) } }
    }
    func refreshLedger() async {
        await refresh()
    }
    private func saveSnapshot(owner: UUID) {
        guard ledgerReady else { return }
        SavedOverview(owner: owner, savedAt: Date(), profiles: profiles, categories: categories,
            people: ledgerByProfile.values.flatMap(\.people), debts: ledgerByProfile.values.flatMap(\.debts),
            expenses: cache.mapValues { $0.1 }).save()
    }
    private func expenseKey(interval: DateInterval?) -> String? {
        guard let profile = activeId, let owner = user?.id else { return nil }
        return "\(owner)/\(profile)/\(interval?.start.timeIntervalSince1970 ?? 0)/\(interval?.end.timeIntervalSince1970 ?? 0)"
    }
    func cachedExpenses(interval: DateInterval?) -> [Expense]? {
        expenseKey(interval: interval).flatMap { cache[$0]?.1 }
    }
    func expenses(interval: DateInterval?, force: Bool = false) async throws -> [Expense] {
        guard !validating else { throw CancellationError() }
        guard let profile = activeId, let owner = user?.id else { return [] }
        guard let key = expenseKey(interval: interval) else { return [] }
        if !force, let (date, rows) = cache[key], Date().timeIntervalSince(date) < 30 { return rows }
        let currentRevision = revision
        var query = [URLQueryItem(name: "profile_id", value: "eq.\(profile)"), .init(name: "select", value: "*,categories(id,name,sort_order)"), .init(name: "order", value: "created_at.desc,id.desc")]
        if let interval {
            query += [.init(name: "created_at", value: "gte.\(interval.start.ISO8601Format())"), .init(name: "created_at", value: "lt.\(interval.end.ISO8601Format())")]
        }
        let rows = try await API.shared.list(Expense.self, table: "expenses", query: query)
        guard owner == user?.id, profile == activeId, currentRevision == revision else { throw CancellationError() }
        cache[key] = (Date(), rows)
        if cache.count > 24, let oldest = cache.min(by: { $0.value.0 < $1.value.0 })?.key { cache.removeValue(forKey: oldest) }
        saveSnapshot(owner: owner)
        return rows
    }
    func synchronize() async {
        guard !validating else { return }
        cache = [:]; revision += 1
        await refresh()
    }
    func synchronizeIfStale(now: Date = .now) async {
        guard !loading, user != nil else { return }
        if let lastRefresh, now.timeIntervalSince(lastRefresh) < 60 { return }
        await synchronize()
    }
    private func changed() async {
        if let owner = user?.id { SavedOverview.clear(owner: owner) }
        snapshotGeneration = UUID()
        cache = [:]; revision += 1
        await refresh()
    }
    func createProfile(id: UUID, name: String, balance: Decimal) async throws {
        struct Payload: Encodable, Sendable { let id: UUID; let name: String; let balance: Decimal }
        try await API.shared.write(Payload(id: id, name: name.trimmed, balance: balance), path: "profiles", upsert: true)
        await changed(); select(id)
    }
    func balance(id: UUID, profile: UUID, amount: Decimal, mode: String) async throws {
        struct Payload: Encodable, Sendable { let pId: UUID; let pProfile: UUID; let pAmount: Decimal; let pMode: String }
        try await API.shared.write(Payload(pId: id, pProfile: profile, pAmount: amount, pMode: mode), path: "rpc/adjust_balance")
        await changed()
    }
    func transfer(id: UUID, from: UUID, to: UUID, amount: Decimal) async throws {
        struct Payload: Encodable, Sendable { let pId: UUID; let pFrom: UUID; let pTo: UUID; let pAmount: Decimal }
        try await API.shared.write(Payload(pId: id, pFrom: from, pTo: to, pAmount: amount), path: "rpc/transfer_money")
        await changed()
    }
    func addExpense(id: UUID, profile: UUID, reason: String, amount: Decimal, category: UUID?, notes: String, date: Date) async throws {
        struct Payload: Encodable, Sendable {
            let pId: UUID; let pProfile: UUID; let pReason: String; let pAmount: Decimal
            let pCategory: UUID?; let pNotes: String; let pCreatedAt: Date
        }
        try await API.shared.write(Payload(pId: id, pProfile: profile, pReason: reason.trimmed, pAmount: amount, pCategory: category, pNotes: notes.trimmed, pCreatedAt: date), path: "rpc/ios_add_expense")
        await changed()
    }
    func delete(_ expense: Expense) async throws {
        struct Payload: Encodable, Sendable { let pId: UUID }
        try await API.shared.write(Payload(pId: expense.id), path: "rpc/ios_delete_expense")
        await changed()
    }
    func move(_ expense: Expense, to: UUID) async throws {
        struct Payload: Encodable, Sendable { let pId: UUID; let pFrom: UUID; let pTo: UUID }
        try await API.shared.write(Payload(pId: expense.id, pFrom: expense.profileId, pTo: to), path: "rpc/ios_move_expense")
        await changed()
    }
    func addPerson(id: UUID, name: String, profile: UUID) async throws -> Person {
        let person = Person(id: id, profileId: profile, name: name.trimmed)
        try await API.shared.write(person, path: "people", upsert: true)
        if var snapshot = ledgerByProfile[profile], !snapshot.people.contains(where: { $0.id == id }) {
            snapshot.people.append(person); ledgerByProfile[profile] = snapshot
        }
        if activeId == profile, !people.contains(where: { $0.id == id }) { people.append(person) }
        return person
    }
    struct TabRow: Encodable, Sendable {
        let personId: UUID; let amount: Decimal; let direction: Direction; let description: String
    }
    func addTabs(id: UUID, profile: UUID, rows: [TabRow], ownShare: Decimal) async throws {
        struct Payload: Encodable, Sendable { let pId: UUID; let pProfile: UUID; let pRows: [TabRow]; let pOwnShare: Decimal }
        try await API.shared.write(Payload(pId: id, pProfile: profile, pRows: rows, pOwnShare: ownShare), path: "rpc/ios_add_tabs")
        await changed()
    }
    func undoSettlement(_ id: UUID) async throws {
        struct Payload: Encodable, Sendable { let pId: UUID }
        try await API.shared.write(Payload(pId: id), path: "rpc/undo_tab_payment")
        await changed()
    }
    func settle(_ tab: PersonTab, payment: Decimal, id: UUID) async throws {
        struct Payload: Encodable, Sendable {
            let pId: UUID; let pProfile: UUID; let pPerson: UUID; let pPayment: Decimal; let pExpectedCollect: Decimal; let pExpectedPay: Decimal
        }
        try await API.shared.write(Payload(pId: id, pProfile: tab.person.profileId, pPerson: tab.id, pPayment: payment, pExpectedCollect: tab.collect, pExpectedPay: tab.pay), path: "rpc/record_tab_payment")
        await changed()
    }
}
