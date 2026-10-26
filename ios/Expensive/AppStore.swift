import Foundation
import Observation
import os
import Network

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
    var pendingExpenses: [PendingExpense] = []
    var syncingExpenses = false
    var deletingData = false
    var online = true
    @ObservationIgnored private let networkMonitor = NWPathMonitor()
    private var snapshotGeneration = UUID()
    private var ledgerByProfile: [UUID: (people: [Person], debts: [Debt])] = [:]
    private var cache: [String: (Date, [Expense])] = [:]
    var tripLists: [UUID: [Trip]] = [:]
    var tripDetails: [UUID: TripSnapshot] = [:]
    private var refreshAgain = false
    private var lastRefresh: Date?
    @ObservationIgnored private var liveRefresh: Task<Void, Never>?
    var active: Profile? { profiles.first { $0.id == activeId } }
    var tabs: [PersonTab] { people.map { person in PersonTab(person: person, entries: debts.filter { $0.personId == person.id && $0.remainingAmount > 0 }) } }
    var collect: Decimal { debts.filter { $0.direction == .collect }.reduce(0) { $0 + $1.remainingAmount } }
    var pay: Decimal { debts.filter { $0.direction == .pay }.reduce(0) { $0 + $1.remainingAmount } }

    init() {
        networkMonitor.pathUpdateHandler = { [weak self] path in
            Task { @MainActor in
                guard let self else { return }
                let wasOffline = !self.online
                self.online = path.status == .satisfied
                if wasOffline && self.online && !self.starting && !self.validating {
                    await self.flushExpenses(); await self.synchronizeIfStale()
                }
            }
        }
        networkMonitor.start(queue: DispatchQueue(label: "expensive.connectivity"))
    }
    deinit { networkMonitor.cancel() }

    func bootstrap() async {
        let startedAt = ContinuousClock.now
        defer { Logger(subsystem: "com.itsbypranav.expensive", category: "performance").debug("Bootstrap duration: \(String(describing: startedAt.duration(to: .now)), privacy: .public)") }
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
            loadPendingExpenses()
            Task { await flushExpenses() }
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
        loadPendingExpenses()
        Task { await flushExpenses() }
        await refresh()
    }
    func logout() async throws {
        try await API.shared.signOut()
        clearData(); user = nil; error = nil; authStep = .signIn
        CurrencyPreference.shared.load(user: nil)
    }
    private func clearData() {
        liveRefresh?.cancel(); liveRefresh = nil
        if let owner = user?.id { SavedOverview.clear(owner: owner) }
        lastRefresh = nil
        pendingExpenses = []
        ledgerReady = false; snapshotGeneration = UUID(); ledgerByProfile = [:]
        profiles = []; categories = []; people = []; debts = []; activeId = nil
        cache = [:]; tripLists = [:]; tripDetails = [:]; revision += 1
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
        let startedAt = ContinuousClock.now
        loading = true
        defer {
            Logger(subsystem: "com.itsbypranav.expensive", category: "performance").debug("Ledger refresh duration: \(String(describing: startedAt.duration(to: .now)), privacy: .public)")
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
        // Keep useful rows visible while revalidating instead of making every
        // period visited during sync fall back to an empty loading screen.
        cache = cache.mapValues { (Date.distantPast, $0.1) }; revision += 1
        await refresh()
    }
    func synchronizeIfStale(now: Date = .now) async {
        guard !loading, user != nil else { return }
        if let lastRefresh, now.timeIntervalSince(lastRefresh) < 10 { return }
        await synchronize()
    }
    func watchChanges() async {
        guard !validating, let owner = user?.id else { return }
        var delay = 2
        while !Task.isCancelled && user?.id == owner && !validating {
            do {
                try await API.shared.watchChanges(owner: owner) { [weak self] in
                    await self?.scheduleLiveRefresh(owner: owner)
                }
                delay = 2
            } catch {
                if Task.isCancelled || user?.id != owner { return }
                // REST remains usable when realtime is unavailable; the foreground
                // fallback catches missed changes without discarding cached screens.
            }
            do { try await Task.sleep(for: .seconds(delay)) } catch { return }
            delay = min(delay * 2, 60)
        }
    }
    private func scheduleLiveRefresh(owner: UUID) {
        guard user?.id == owner, !validating else { return }
        liveRefresh?.cancel()
        liveRefresh = Task {
            do { try await Task.sleep(for: .milliseconds(250)) } catch { return }
            guard user?.id == owner, !validating else { return }
            await synchronize()
        }
    }
    private func changed() async {
        if let owner = user?.id { SavedOverview.clear(owner: owner) }
        snapshotGeneration = UUID()
        cache = cache.mapValues { (Date.distantPast, $0.1) }; revision += 1
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
    func deleteProfile(_ profile: Profile, confirmation: String) async throws {
        guard !pendingExpenses.contains(where: { $0.profile == profile.id }), !syncingExpenses else {
            throw AppError.message("Sync or resolve pending expenses first.")
        }
        struct Payload: Encodable, Sendable { let pProfile: UUID; let pName: String }
        try await API.shared.write(Payload(pProfile: profile.id, pName: confirmation), path: "rpc/delete_profile")
        await changed()
    }
    func transfer(id: UUID, from: UUID, to: UUID, amount: Decimal) async throws {
        struct Payload: Encodable, Sendable { let pId: UUID; let pFrom: UUID; let pTo: UUID; let pAmount: Decimal }
        try await API.shared.write(Payload(pId: id, pFrom: from, pTo: to, pAmount: amount), path: "rpc/transfer_money")
        await changed()
    }
    func addExpense(id: UUID, profile: UUID, reason: String, amount: Decimal, category: UUID?, notes: String, date: Date, expectedOwner: UUID? = nil) async throws {
        guard !validating, let owner = user?.id else { throw AppError.signedOut }
        if let expectedOwner, expectedOwner != owner { throw AppError.signedOut }
        var rows = try ExpenseOutbox.read(owner: owner)
        let row = PendingExpense(owner: owner, id: id, profile: profile, reason: reason.trimmed, amount: amount, category: category, notes: notes.trimmed, date: date)
        if let prior = rows.first(where: { $0.id == id }) {
            guard prior.profile == profile, prior.reason == row.reason, prior.amount == amount, prior.category == category, prior.notes == row.notes, prior.date.ISO8601Format() == date.ISO8601Format() else { throw AppError.message("This draft ID was already used. Reopen the form.") }
        } else { rows.append(row) }
        try ExpenseOutbox.save(rows, owner: owner); pendingExpenses = rows
        Task { await flushExpenses() }
    }
    func loadPendingExpenses() {
        guard let owner = user?.id else { pendingExpenses = []; return }
        do { pendingExpenses = try ExpenseOutbox.read(owner: owner) } catch { self.error = error.localizedDescription }
    }
    func discardRejectedExpense(_ id: UUID) throws {
        guard !syncingExpenses, let owner = user?.id else { throw AppError.message("Wait for syncing to finish.") }
        var rows = try ExpenseOutbox.read(owner: owner)
        guard rows.contains(where: { $0.id == id && $0.blocked }) else { throw AppError.message("Retry this draft first to confirm whether it was saved.") }
        rows.removeAll { $0.id == id }; try ExpenseOutbox.save(rows, owner: owner); pendingExpenses = rows
    }
    func flushExpenses(retry: Bool = false) async {
        guard online, !syncingExpenses, !deletingData, !validating, let owner = user?.id else { return }
        syncingExpenses = true
        defer { syncingExpenses = false; if user?.id == owner { loadPendingExpenses() } }
        struct Payload: Encodable, Sendable {
            let pId: UUID; let pProfile: UUID; let pReason: String; let pAmount: Decimal
            let pCategory: UUID?; let pNotes: String; let pCreatedAt: Date
        }
        do {
            for row in try ExpenseOutbox.read(owner: owner) {
                guard user?.id == owner, !deletingData, !validating, !Task.isCancelled else { break }
                if row.blocked && !retry { continue }
                do {
                    try await API.shared.write(Payload(pId: row.id, pProfile: row.profile, pReason: row.reason, pAmount: row.amount, pCategory: row.category, pNotes: row.notes, pCreatedAt: row.date), path: "rpc/ios_add_expense", expectedOwner: owner)
                    var current = try ExpenseOutbox.read(owner: owner); current.removeAll { $0.id == row.id }
                    try ExpenseOutbox.save(current, owner: owner)
                    if user?.id == owner { pendingExpenses = current; await changed() }
                } catch {
                    var current = try ExpenseOutbox.read(owner: owner)
                    if let index = current.firstIndex(where: { $0.id == row.id }) {
                        current[index].error = error.localizedDescription
                        if case AppError.rejected = error { current[index].blocked = true }
                        else { current[index].blocked = false }
                    }
                    try ExpenseOutbox.save(current, owner: owner)
                    if case AppError.signedOut = error { if user?.id == owner { handle(error) }; break }
                    if case AppError.rejected = error { continue }
                    break
                }
            }
        } catch { if user?.id == owner { self.error = error.localizedDescription } }
    }
    func deleteExpensiveData(confirmation: String) async throws {
        guard !validating, !deletingData, let owner = user?.id else { throw AppError.signedOut }
        deletingData = true
        defer { deletingData = false }
        try await API.shared.deleteExpensiveData(owner: owner, confirmation: confirmation)
        try ExpenseOutbox.save([], owner: owner)
        guard user?.id == owner else { return }
        pendingExpenses = []; clearData()
        try await logout()
    }
    func delete(_ expense: Expense) async throws {
        struct Payload: Encodable, Sendable { let pId: UUID }
        try await API.shared.write(Payload(pId: expense.id), path: "rpc/ios_delete_expense")
        await changed()
    }
    func editExpense(request: UUID, expense: Expense, reason: String, amount: Decimal, category: UUID?, notes: String, date: Date) async throws {
        struct Payload: Encodable, Sendable {
            let pRequest: UUID; let pId: UUID; let pVersion: Int; let pReason: String; let pAmount: Decimal
            let pCategory: UUID?; let pNotes: String; let pCreatedAt: Date
            // Explicit null is required when removing a category from an expense.
            enum CodingKeys: String, CodingKey { case pRequest,pId,pVersion,pReason,pAmount,pCategory,pNotes,pCreatedAt }
            func encode(to encoder: Encoder) throws {
                var c = encoder.container(keyedBy: CodingKeys.self)
                try c.encode(pRequest, forKey: .pRequest); try c.encode(pId, forKey: .pId)
                try c.encode(pVersion, forKey: .pVersion); try c.encode(pReason, forKey: .pReason)
                try c.encode(pAmount, forKey: .pAmount); try c.encode(pCategory, forKey: .pCategory)
                try c.encode(pNotes, forKey: .pNotes); try c.encode(pCreatedAt, forKey: .pCreatedAt)
            }
        }
        try await API.shared.write(Payload(pRequest: request, pId: expense.id, pVersion: expense.version ?? 1, pReason: reason.trimmed, pAmount: amount, pCategory: category, pNotes: notes.trimmed, pCreatedAt: date), path: "rpc/edit_expense")
        await changed()
    }
    func move(_ expense: Expense, to: UUID) async throws {
        struct Payload: Encodable, Sendable { let pId: UUID; let pFrom: UUID; let pTo: UUID }
        try await API.shared.write(Payload(pId: expense.id, pFrom: expense.profileId, pTo: to), path: "rpc/ios_move_expense")
        await changed()
    }
    func people(for profile: UUID) -> [Person] {
        profile == activeId ? people : (ledgerByProfile[profile]?.people ?? [])
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
    func settle(_ tab: PersonTab, payment: Decimal, id: UUID, onMe: Bool = false) async throws {
        struct Payload: Encodable, Sendable {
            let pId: UUID; let pProfile: UUID; let pPerson: UUID; let pPayment: Decimal; let pExpectedCollect: Decimal; let pExpectedPay: Decimal
        }
        try await API.shared.write(Payload(pId: id, pProfile: tab.person.profileId, pPerson: tab.id, pPayment: payment, pExpectedCollect: tab.collect, pExpectedPay: tab.pay), path: onMe ? "rpc/record_tab_on_me" : "rpc/record_tab_payment")
        await changed()
    }
}
