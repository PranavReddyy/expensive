import Foundation
import Observation

@MainActor @Observable final class AppStore {
    enum AuthStep { case signIn, verify, username }
    var authStep: AuthStep = .signIn
    var user: AuthUser?
    var starting = true
    var loading = false
    var error: String?
    var profiles: [Profile] = []
    var categories: [Category] = []
    var people: [Person] = []
    var debts: [Debt] = []
    var activeId: UUID?
    var revision = 0
    private var ledgerTask: Task<Void, Never>?
    private var cache: [String: (Date, [Expense])] = [:]
    private var refreshAgain = false
    var active: Profile? { profiles.first { $0.id == activeId } }
    var tabs: [PersonTab] { people.map { person in PersonTab(person: person, entries: debts.filter { $0.personId == person.id && $0.remainingAmount > 0 }) } }
    var collect: Decimal { debts.filter { $0.direction == .collect }.reduce(0) { $0 + $1.remainingAmount } }
    var pay: Decimal { debts.filter { $0.direction == .pay }.reduce(0) { $0 + $1.remainingAmount } }

    func bootstrap() async {
        starting = true; error = nil
        do { user = try await API.shared.restore() }
        catch { handle(error) }
        starting = false
        if user != nil { await refresh() }
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
        clearData(); user = next; error = nil
        authStep = .signIn
        await refresh()
    }
    func logout() async throws {
        try await API.shared.signOut()
        clearData(); user = nil; error = nil; authStep = .signIn
    }
    private func clearData() {
        ledgerTask?.cancel(); ledgerTask = nil
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
        activeId = id; people = []; debts = []; error = nil
        if let user { UserDefaults.standard.set(id?.uuidString, forKey: "profile.\(user.id)") }
        ledgerTask?.cancel()
        ledgerTask = Task { await refreshLedger() }
    }
    func refresh() async {
        guard let owner = user?.id else { return }
        if loading { refreshAgain = true; return }
        loading = true
        defer {
            loading = false
            if refreshAgain { refreshAgain = false; Task { await refresh() } }
        }
        do {
            async let nextProfiles = API.shared.list(Profile.self, table: "profiles", query: [.init(name: "order", value: "created_at.asc,id.asc")])
            async let nextCategories = API.shared.list(Category.self, table: "categories", query: [.init(name: "order", value: "sort_order.asc,id.asc")])
            let (loadedProfiles, loadedCategories) = try await (nextProfiles, nextCategories)
            guard user?.id == owner else { return }
            profiles = loadedProfiles; categories = loadedCategories; error = nil
            if !profiles.contains(where: { $0.id == activeId }) {
                let saved = UserDefaults.standard.string(forKey: "profile.\(owner)").flatMap(UUID.init(uuidString:))
                activeId = profiles.contains { $0.id == saved } ? saved : profiles.first?.id
                people = []; debts = []
            }
            await refreshLedger()
        } catch { if user?.id == owner { handle(error) } }
    }
    func refreshLedger() async {
        guard let profile = activeId, let owner = user?.id else { return }
        do {
            let filter = [URLQueryItem(name: "profile_id", value: "eq.\(profile)")]
            async let loadedPeople = API.shared.list(Person.self, table: "people", query: filter + [.init(name: "order", value: "name.asc,id.asc")])
            async let loadedDebts = API.shared.list(Debt.self, table: "debts", query: filter + [.init(name: "order", value: "created_at.desc,id.desc")])
            let (p, d) = try await (loadedPeople, loadedDebts)
            guard user?.id == owner, activeId == profile, !Task.isCancelled else { return }
            people = p; debts = d
        } catch { if user?.id == owner && activeId == profile { handle(error) } }
    }
    func expenses(interval: DateInterval?, force: Bool = false) async throws -> [Expense] {
        guard let profile = activeId, let owner = user?.id else { return [] }
        let key = "\(owner)/\(profile)/\(interval?.start.timeIntervalSince1970 ?? 0)/\(interval?.end.timeIntervalSince1970 ?? 0)"
        if !force, let (date, rows) = cache[key], Date().timeIntervalSince(date) < 30 { return rows }
        let currentRevision = revision
        var query = [URLQueryItem(name: "profile_id", value: "eq.\(profile)"), .init(name: "select", value: "*,categories(id,name,sort_order)"), .init(name: "order", value: "created_at.desc,id.desc")]
        if let interval {
            query += [.init(name: "created_at", value: "gte.\(interval.start.ISO8601Format())"), .init(name: "created_at", value: "lt.\(interval.end.ISO8601Format())")]
        }
        let rows = try await API.shared.list(Expense.self, table: "expenses", query: query)
        guard owner == user?.id, profile == activeId, currentRevision == revision else { throw CancellationError() }
        cache[key] = (Date(), rows)
        return rows
    }
    func synchronize() async {
        cache = [:]; revision += 1
        await refresh()
    }
    private func changed() async {
        cache = [:]; revision += 1
        await refresh()
    }
    func createProfile(id: UUID, name: String, balance: Decimal) async throws {
        struct Payload: Encodable, Sendable { let id: UUID; let name: String; let balance: Decimal }
        try await API.shared.write(Payload(id: id, name: name.trimmed, balance: balance), path: "profiles", upsert: true)
        await changed(); select(id)
    }
    func balance(profile: UUID, amount: Decimal) async throws {
        struct Payload: Encodable, Sendable { let balance: Decimal }
        try await API.shared.write(Payload(balance: amount), path: "profiles", method: "PATCH", query: [.init(name: "id", value: "eq.\(profile)")])
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
    func settle(_ tab: PersonTab, payment: Decimal) async throws {
        struct Payload: Encodable, Sendable {
            let pProfile: UUID; let pPerson: UUID; let pPayment: Decimal; let pExpectedCollect: Decimal; let pExpectedPay: Decimal
        }
        try await API.shared.write(Payload(pProfile: tab.person.profileId, pPerson: tab.id, pPayment: payment, pExpectedCollect: tab.collect, pExpectedPay: tab.pay), path: "rpc/settle_tab")
        await changed()
    }
}
