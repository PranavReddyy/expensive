import SwiftUI

struct TripDeleteControl: View {
    @Environment(AppStore.self) private var store
    @Environment(\.dismiss) private var dismiss
    let trip: Trip
    var entry: TripEntry? = nil
    @State private var confirming = false
    @State private var busy = false
    @State private var error: String?
    var body: some View {
        Button(entry == nil ? "delete trip" : "delete expense", role: .destructive) { confirming = true }.disabled(busy)
        if busy { LoadingState(title: "deleting") }
        if let error { Text(error).font(Theme.font(11)).foregroundStyle(.red) }
        Color.clear.frame(height: 0).confirmationDialog(entry == nil ? "Delete trip?" : "Delete expense?", isPresented: $confirming, titleVisibility: .visible) {
            Button("delete", role: .destructive) { remove() }
            Button("cancel", role: .cancel) {}
        } message: { Text(entry == nil ? "Removes the trip and bill summaries. Expenses, balances and Tabs stay. This cannot be undone." : "Reverses this bill and removes linked spending and open Tabs. Changed or settled records are protected. This cannot be undone.") }
    }
    private func remove() {
        guard !busy else { return }; busy = true; error = nil
        Task {
            defer { busy = false }
            do {
                if let entry {
                    struct Payload: Encodable, Sendable { let pId: UUID; let pVersion: Int }
                    try await API.shared.write(Payload(pId: entry.id, pVersion: entry.version ?? 1), path: "rpc/delete_trip_expense")
                } else {
                    struct Payload: Encodable, Sendable { let pTrip: UUID }
                    try await API.shared.write(Payload(pTrip: trip.id), path: "rpc/delete_trip")
                    store.tripLists[trip.profileId]?.removeAll { $0.id == trip.id }
                }
                store.tripDetails[trip.id] = nil
                await store.synchronize(); dismiss()
            } catch { self.error = error.localizedDescription }
        }
    }
}

struct TripStatisticsView: View {
    let trip: Trip
    let entries: [TripEntry]
    let people: [Person]
    let debts: [Debt]
    let categories: [Category]
    private var total: Decimal { entries.reduce(0) { $0 + $1.amount } }
    private var days: Int {
        let f = DateFormatter(); f.dateFormat = "yyyy-MM-dd"; f.locale = Locale(identifier: "en_US_POSIX")
        guard let start = f.date(from: trip.startsOn), let end = f.date(from: trip.endsOn) else { return 1 }
        return max(1, (Calendar.current.dateComponents([.day], from: start, to: end).day ?? 0) + 1)
    }
    private func row(_ name: String, _ value: String) -> some View {
        HStack(alignment: .firstTextBaseline) { Text(name).foregroundStyle(.secondary); Spacer(); Text(value).multilineTextAlignment(.trailing) }.font(Theme.font(12)).padding(.vertical, 5)
    }
    var body: some View {
        Page {
            Text(trip.name).font(Theme.font(13)).foregroundStyle(.secondary)
            VStack(alignment: .leading, spacing: 12) {
                SectionLabel("total trip spending")
                Text(Money.format(total)).font(Theme.font(34)).minimumScaleFactor(0.5).lineLimit(1)
                row("your share", Money.format(entries.reduce(0) { $0 + ($1.shares["me"] ?? 0) }))
                row("you paid upfront", Money.format(entries.filter { $0.payer == nil }.reduce(0) { $0 + $1.amount }))
            }.padding(20).overlay(Rectangle().stroke(Theme.ink))
            SectionLabel("overview")
            row("bills", String(entries.count))
            row("scheduled trip days", String(days))
            row("per scheduled day", Money.format(total / Decimal(days)))
            row("average bill", Money.format(entries.isEmpty ? 0 : total / Decimal(entries.count)))
            if trip.budget > 0 {
                row("overall budget", Money.format(trip.budget))
                row(total > trip.budget ? "over budget" : "remaining budget", Money.format(abs(trip.budget - total)))
                ProgressView(value: min(1, NSDecimalNumber(decimal: total / trip.budget).doubleValue)).tint(Theme.ink)
            }
            Divider(); SectionLabel("personal budget")
            let own = entries.reduce(Decimal.zero) { $0 + ($1.shares["me"] ?? 0) }
            if let personal = trip.personalBudget, personal > 0 {
                row("your personal budget", Money.format(personal))
                row(own > personal ? "over personal budget" : "personal budget remaining", Money.format(abs(personal - own)))
                row("your share per scheduled day", Money.format(own / Decimal(days)))
                ProgressView(value: min(1, NSDecimalNumber(decimal: own / personal).doubleValue)).tint(Theme.ink).accessibilityLabel("Personal budget used")
            } else { row("personal budget", "not set") }
            Divider(); SectionLabel("by category · full bills")
            let grouped = Dictionary(grouping: entries, by: { $0.categoryId?.uuidString ?? "none" })
            ForEach(grouped.keys.sorted(), id: \.self) { key in
                row(categories.first { $0.id.uuidString == key }?.name ?? "uncategorized", Money.format(grouped[key]!.reduce(0) { $0 + $1.amount }))
            }
            Divider(); SectionLabel("participants")
            ForEach(["me"] + people.map { $0.id.uuidString.lowercased() }, id: \.self) { id in
                VStack(alignment: .leading, spacing: 4) {
                    Text(id == "me" ? "you" : people.first { $0.id.uuidString.lowercased() == id }?.name ?? "participant").font(Theme.font(13))
                    row("paid upfront", Money.format(entries.filter { ($0.payer?.uuidString.lowercased() ?? "me") == id }.reduce(0) { $0 + $1.amount }))
                    row("allocated share", Money.format(entries.reduce(0) { $0 + ($1.shares[id] ?? 0) }))
                }.padding(.vertical, 5)
            }
            Divider(); SectionLabel("open Tabs · your balances only")
            row("owed to you", Money.format(debts.filter { $0.direction == .collect }.reduce(0) { $0 + $1.remainingAmount }))
            row("you owe", Money.format(debts.filter { $0.direction != .collect }.reduce(0) { $0 + $1.remainingAmount }))
            Divider(); SectionLabel("largest bills")
            ForEach(Array(entries.sorted { $0.amount > $1.amount }.prefix(5))) { entry in row(entry.reason, Money.format(entry.amount)) }
            if entries.isEmpty { Text("Log a trip expense to see breakdowns.").font(Theme.font(12)).foregroundStyle(.secondary) }
        }.pageTitle("trip statistics")
    }
}

struct Trip: Decodable, Identifiable, Sendable {
    let id: UUID; let profileId: UUID; let name: String; let budget: Decimal
    let startsOn: String; let endsOn: String; let completed: Bool
    var personalBudget: Decimal? = nil
}
struct TripMember: Decodable, Sendable { let personId: UUID }
struct TripEntry: Decodable, Identifiable, Sendable {
    let id: UUID; let reason: String; let amount: Decimal; let payer: UUID?
    let shares: [String: Decimal]; let createdAt: Date
    var categoryId: UUID? = nil
    var version: Int? = nil
    var hasEqualShares: Bool {
        let values = Array(shares.values)
        return !values.isEmpty && values.reduce(0,+) == amount && (values.max()! - values.min()!) <= Decimal(string: "0.01")!
    }
}

struct TripSnapshot: Sendable {
    let trip: Trip; let members: [TripMember]; let entries: [TripEntry]; let debts: [Debt]
}

struct TripLoadingView: View {
    var body: some View {
        VStack(alignment: .leading, spacing: 18) {
            LoadingState(title: "loading trip")
            RoundedRectangle(cornerRadius: 4).frame(width: 100, height: 12)
            RoundedRectangle(cornerRadius: 6).frame(width: 180, height: 30)
            RoundedRectangle(cornerRadius: 4).frame(height: 12)
        }.foregroundStyle(Theme.ink.opacity(0.07)).padding(20)
            .frame(maxWidth: .infinity, alignment: .leading)
            .overlay(Rectangle().stroke(Theme.ink.opacity(0.15)))
            .accessibilityElement(children: .ignore).accessibilityLabel("Loading trip details")
    }
}

struct TripPeopleChips: View {
    let people: [(String, String)]
    @Binding var selected: Set<String>
    var body: some View {
        ScrollView(.horizontal) {
            HStack(spacing: 8) {
                ForEach(people, id: \.0) { id,name in
                    Button {
                        if selected.contains(id) { selected.remove(id) } else { selected.insert(id) }
                    } label: {
                        Text(name).font(Theme.font(12)).fixedSize()
                            .padding(.horizontal, 14).padding(.vertical, 10)
                            .foregroundStyle(selected.contains(id) ? Theme.onInk : Theme.ink)
                            .background(selected.contains(id) ? Theme.ink : Theme.ink.opacity(0.06), in: Capsule())
                            .frame(minHeight: 44)
                    }.buttonStyle(.plain).accessibilityAddTraits(selected.contains(id) ? .isSelected : [])
                }
            }
        }.scrollIndicators(.hidden)
    }
}

struct TripsView: View {
    @Environment(AppStore.self) private var store
    @State private var rows: [Trip] = []
    @State private var adding = false
    @State private var error: String?
    @State private var loading = true
    @State private var loadId = UUID()
    var body: some View {
        Page {
            ProfilePicker()
            if let profile = store.active {
                HStack {
                    Text("your getaways, together").font(Theme.font(11)).foregroundStyle(.secondary)
                    Spacer()
                    Button { adding = true } label: { Label("new trip", systemImage: "plus").fixedSize() }
                        .font(Theme.font(12)).buttonStyle(PrimaryActionStyle(compact: true))
                }
                if loading && rows.isEmpty { TripLoadingView(); TripLoadingView() }
                if rows.isEmpty && !loading && error == nil { EmptyState(title: "your next trip", detail: "Plan a budget. Split the costs. Keep it all in one place.") }
                ForEach(rows) { trip in
                    NavigationLink { TripDetailView(trip: trip, initial: store.tripDetails[trip.id]) } label: {
                        HStack(spacing: 12) {
                            VStack(alignment: .leading, spacing: 9) {
                                Text(trip.name).font(Theme.font(16, weight: .medium)).foregroundStyle(Theme.ink)
                                Text("\(trip.startsOn) — \(trip.endsOn)").font(Theme.font(11)).foregroundStyle(.secondary)
                                if trip.completed { Text("completed").font(Theme.font(10)).foregroundStyle(.secondary) }
                            }
                            Spacer(minLength: 8)
                            Image(systemName: "chevron.right").font(.caption).foregroundStyle(.secondary)
                        }.frame(maxWidth: .infinity, alignment: .leading).padding(18)
                            .overlay(Rectangle().stroke(Theme.ink.opacity(0.15)))
                    }.buttonStyle(.plain)
                }
                if let error { ErrorNotice(message: error, retry: { Task { await load() } }) }
                Color.clear.frame(height: 0).sheet(isPresented: $adding, onDismiss: { Task { await load() } }) { TripForm(profile: profile) }
            }
        }.pageTitle("trips")
            .task(id: "\(store.user?.id.uuidString ?? "")/\(store.activeId?.uuidString ?? "")") {
                rows = store.activeId.flatMap { store.tripLists[$0] } ?? []
                await load()
            }
            .refreshable { await load() }
    }
    private func load() async {
        guard let profile = store.activeId, let owner = store.user?.id else { return }
        let current = UUID(); loadId = current
        loading = true; error = nil
        defer { if loadId == current { loading = false } }
        do {
            let result = try await API.shared.list(Trip.self, table: "trips", query: [.init(name: "profile_id", value: "eq.\(profile)"), .init(name: "order", value: "created_at.desc,id.desc")])
            guard !Task.isCancelled, loadId == current, store.activeId == profile, store.user?.id == owner else { return }
            rows = result; store.tripLists[profile] = result
        } catch { if !Task.isCancelled && loadId == current && store.user?.id == owner { self.error = error.localizedDescription } }
    }
}

struct TripForm: View {
    @Environment(AppStore.self) private var store
    @Environment(\.dismiss) private var dismiss
    let profile: Profile
    var editing: Trip? = nil
    var initialPeople: Set<UUID> = []
    @State private var name = ""
    @State private var budget = ""
    @State private var personalBudget = ""
    @State private var start = Date()
    @State private var end = Date()
    @State private var selected: Set<UUID> = []
    @State private var search = ""
    @State private var request = UUID()
    @State private var busy = false
    @State private var error: String?
    private enum Field: Hashable { case name, budget, personalBudget, search }
    @FocusState private var focus: Field?
    private var nextField: Field? { focus == .name ? .budget : focus == .budget ? .personalBudget : focus == .personalBudget ? .search : nil }
    var body: some View {
        SheetFrame(title: editing == nil ? "new trip" : "edit trip", busy: busy, error: error, nextInput: nextField.map { next in { focus = next } }, dismissInput: { focus = nil }, inputFocused: focus != nil, save: save) {
            Section("details") {
                TextField("trip name", text: $name).focused($focus, equals: .name).submitLabel(.next).onSubmit { focus = .budget }
                TextField("total budget (optional)", text: $budget).keyboardType(.numbersAndPunctuation).focused($focus, equals: .budget).submitLabel(.next).onSubmit { focus = .personalBudget }
                TextField("your personal budget (optional)", text: $personalBudget).keyboardType(.numbersAndPunctuation).focused($focus, equals: .personalBudget).submitLabel(.next).onSubmit { focus = .search }
                Text("Overall covers full bills. Personal covers your allocated share, whoever pays. Blank or zero means no limit.").font(Theme.font(10)).foregroundStyle(.secondary)
                DatePicker("from", selection: $start, displayedComponents: .date)
                DatePicker("to", selection: $end, in: start..., displayedComponents: .date)
            }
            Section("participants · you are included") {
                TextField("search or add a person", text: $search).focused($focus, equals: .search).submitLabel(.done).onSubmit { focus = nil }
                TripPeopleChips(people: store.people(for: profile.id).filter { search.isEmpty || $0.name.localizedCaseInsensitiveContains(search) }.map { ($0.id.uuidString, $0.name) }, selected: Binding(get: { Set(selected.map(\.uuidString)) }, set: { selected = Set($0.compactMap(UUID.init(uuidString:))) }))
                if !search.trimmed.isEmpty && !store.people(for: profile.id).contains(where: { $0.name.lowercased() == search.trimmed.lowercased() }) {
                    Button("+ add \(search.trimmed)") {
                        busy = true
                        Task {
                            defer { busy = false }
                            do { let person = try await store.addPerson(id: UUID(), name: search, profile: profile.id); selected.insert(person.id); search = "" }
                            catch { self.error = error.localizedDescription }
                        }
                    }.disabled(busy)
                }
            }
            if let editing { Section { TripDeleteControl(trip: editing) } }
        }.onAppear {
            if let editing {
                request = editing.id; name = editing.name; budget = NSDecimalNumber(decimal: editing.budget).stringValue
                personalBudget = NSDecimalNumber(decimal: editing.personalBudget ?? 0).stringValue
                let f = DateFormatter(); f.dateFormat = "yyyy-MM-dd"; f.locale = Locale(identifier: "en_US_POSIX")
                start = f.date(from: editing.startsOn) ?? Date(); end = f.date(from: editing.endsOn) ?? start
                selected = initialPeople
            }
        }.task { try? await Task.sleep(for: .milliseconds(300)); focus = .name }
    }
    private func save() {
        guard !busy else { return }
        do {
            let amount = try Money.parse(budget.isEmpty ? "0" : budget, allowZero: true)
            let personal = try Money.parse(personalBudget.isEmpty ? "0" : personalBudget, allowZero: true)
            guard !name.trimmed.isEmpty else { throw AppError.message("Enter a trip name.") }
            busy = true; error = nil
            Task {
                defer { busy = false }
                do {
                    struct Payload: Encodable, Sendable { let pId: UUID; let pProfile: UUID; let pName: String; let pBudget: Decimal; let pPersonalBudget: Decimal; let pStart: String; let pEnd: String; let pPeople: [UUID] }
                    try await API.shared.write(Payload(pId: request, pProfile: profile.id, pName: name.trimmed, pBudget: amount, pPersonalBudget: personal, pStart: RecurringExpensesView.day(start), pEnd: RecurringExpensesView.day(end), pPeople: Array(selected)), path: "rpc/save_trip_budgets")
                    dismiss()
                } catch { self.error = error.localizedDescription }
            }
        } catch { self.error = error.localizedDescription }
    }
}

struct TripDetailView: View {
    @Environment(AppStore.self) private var store
    @Environment(\.dismiss) private var dismiss
    @State var trip: Trip
    @State private var members: [TripMember] = []
    @State private var entries: [TripEntry] = []
    @State private var debts: [Debt] = []
    @State private var adding = false
    @State private var editing = false
    @State private var editingExpense: TripEntry?
    @State private var completed = false
    @State private var busy = false
    @State private var ready = false
    @State private var loadId = UUID()
    @State private var changing = false
    @State private var error: String?
    init(trip: Trip, initial: TripSnapshot? = nil) {
        _trip = State(initialValue: initial?.trip ?? trip)
        _members = State(initialValue: initial?.members ?? [])
        _entries = State(initialValue: initial?.entries ?? [])
        _debts = State(initialValue: initial?.debts ?? [])
        _ready = State(initialValue: initial != nil)
        _completed = State(initialValue: initial?.trip.completed ?? trip.completed)
    }
    private var total: Decimal { entries.reduce(0) { $0 + $1.amount } }
    private var own: Decimal { entries.reduce(0) { $0 + ($1.shares["me"] ?? 0) } }
    private var tripDays: Int {
        let f = DateFormatter(); f.dateFormat = "yyyy-MM-dd"; f.locale = Locale(identifier: "en_US_POSIX")
        guard let start = f.date(from: trip.startsOn), let end = f.date(from: trip.endsOn) else { return 1 }
        return max(1, Calendar.current.dateComponents([.day], from: start, to: end).day! + 1)
    }
    private var people: [Person] { store.people(for: trip.profileId).filter { person in members.contains { $0.personId == person.id } } }
    var body: some View {
        Page {
            Text("\(trip.startsOn) — \(trip.endsOn)").font(Theme.font(11)).foregroundStyle(.secondary)
            if !ready { TripLoadingView() } else {
            VStack(alignment: .leading, spacing: 10) {
                SectionLabel("total trip spending")
                Text(Money.format(total)).font(Theme.font(38, weight: .medium, relativeTo: .largeTitle)).minimumScaleFactor(0.5).lineLimit(1).monospacedDigit()
                Text("your share \(Money.format(own))").font(Theme.font(12))
                if let personal = trip.personalBudget, personal > 0 {
                    Text("personal \(Money.format(personal)) · \(Money.format(abs(personal-own))) \(own > personal ? "over" : "remaining")").font(Theme.font(11)).foregroundStyle(.secondary)
                } else { Text("personal not set").font(Theme.font(11)).foregroundStyle(.secondary) }
                if trip.budget > 0 { Text("overall \(Money.format(trip.budget)) · \(Money.format(abs(trip.budget - total))) \(total > trip.budget ? "over" : "remaining")").font(Theme.font(11)).foregroundStyle(.secondary) }
            }.frame(maxWidth: .infinity, alignment: .leading).padding(20)
                .overlay(Rectangle().stroke(Theme.ink, lineWidth: 1))

            }
            HStack {
                if !completed { Button { adding = true } label: { Label("log expense", systemImage: "plus").frame(maxWidth: .infinity) }.buttonStyle(PrimaryActionStyle()).disabled(!ready || changing) }
                NavigationLink { TripStatisticsView(trip: trip, entries: entries, people: people, debts: debts, categories: store.categories) } label: {
                    Image(systemName: "chart.bar.xaxis").frame(width: 44, height: 44)
                        .glassEffect(.regular.interactive(), in: Circle())
                }.buttonStyle(.plain).accessibilityLabel("Trip statistics").disabled(!ready || changing)
                Menu {
                    Button("edit trip", systemImage: "pencil") { editing = true }
                    Button(completed ? "reopen trip" : "finish trip", systemImage: completed ? "arrow.uturn.backward" : "checkmark") { finish() }
                } label: {
                    Image(systemName: "ellipsis").frame(width: 44, height: 44)
                        .glassEffect(.regular.interactive(), in: Circle())
                }.buttonStyle(.plain)
                    .accessibilityLabel("Trip options").disabled(!ready || changing)
            }.font(Theme.font(12))
            if let error { ErrorNotice(message: error, retry: { Task { await load() } }) }
            if ready {
            VStack(alignment: .leading, spacing: 12) {
                HStack {
                    Text("settlement").font(Theme.font(13, weight: .medium))
                    Spacer()
                    NavigationLink { TabsView() } label: { Text("open Tabs").font(Theme.font(11)).padding(.horizontal, 4) }
                        .buttonStyle(.glass).controlSize(.regular)
                }
                ForEach(people) { person in
                    let net = debts.filter { $0.personId == person.id }.reduce(Decimal.zero) { $0 + ($1.direction == .collect ? $1.remainingAmount : -$1.remainingAmount) }
                    if net != 0 { Text("\(person.name) · \(net > 0 ? "owes you" : "you owe") \(Money.format(abs(net)))").font(Theme.font(12)) }
                }
                if debts.isEmpty { Text("all clear").font(Theme.font(12)) }
                Text("Payments in Tabs include your other balances with each person.").font(Theme.font(10)).foregroundStyle(.secondary)
            }
            Divider()
            Text("expenses").font(Theme.font(13, weight: .medium))
            if entries.isEmpty { Text("No expenses yet.").font(Theme.font(12)).foregroundStyle(.secondary) }
            ForEach(entries) { entry in
                Button { editingExpense = entry } label: {
                HStack(alignment: .top) {
                    VStack(alignment: .leading, spacing: 6) {
                        Text(entry.reason)
                        Text("\(entry.payer.flatMap { id in people.first { $0.id == id }?.name } ?? "you") paid · your share \(Money.format(entry.shares["me"] ?? 0))").font(Theme.font(11)).foregroundStyle(.secondary)
                    }
                    Spacer()
                    VStack(alignment: .trailing, spacing: 6) {
                        Text(Money.format(entry.amount))
                    }
                }.font(Theme.font(13)).padding(.vertical, 8).frame(maxWidth: .infinity, minHeight: 44).contentShape(Rectangle())
                }.buttonStyle(.plain).disabled(changing || !ready).accessibilityHint("Opens expense editing")
            }
            }
        }.pageTitle(trip.name)
            .task {
                completed = trip.completed
                if let saved = store.tripDetails[trip.id] {
                    trip = saved.trip; completed = saved.trip.completed
                    members = saved.members; entries = saved.entries; debts = saved.debts; ready = true
                }
                await load()
            }
            .refreshable { await load() }
            .sheet(isPresented: $adding, onDismiss: { Task { await load() } }) { TripExpenseForm(trip: trip, people: people) }
            .sheet(item: $editingExpense, onDismiss: { Task { await load() } }) { entry in
                TripExpenseForm(trip: trip, people: people, editing: entry)
            }
            .sheet(isPresented: $editing, onDismiss: { Task { await load() } }) {
                if let profile = store.profiles.first(where: { $0.id == trip.profileId }) {
                    TripForm(profile: profile, editing: trip, initialPeople: Set(members.map(\.personId)))
                }
            }
    }
    private func load() async {
        guard let owner = store.user?.id else { return }
        let current = UUID(); loadId = current
        busy = true; error = nil
        defer { if loadId == current { busy = false } }
        do {
            async let latest = API.shared.list(Trip.self, table: "trips", query: [.init(name: "id", value: "eq.\(trip.id)")])
            let filter = [URLQueryItem(name: "trip_id", value: "eq.\(trip.id)")]
            async let m = API.shared.list(TripMember.self, table: "trip_members", query: filter + [.init(name: "order", value: "person_id")])
            async let e = API.shared.list(TripEntry.self, table: "trip_entries", query: filter + [.init(name: "order", value: "created_at.desc,id.desc")])
            async let d = API.shared.list(Debt.self, table: "debts", query: filter + [.init(name: "remaining_amount", value: "gt.0"), .init(name: "order", value: "id")])
            let (latestRows,loadedMembers,loadedEntries,loadedDebts) = try await (latest,m,e,d)
            guard !Task.isCancelled, loadId == current, store.user?.id == owner else { return }
            guard let latestTrip = latestRows.first else {
                ready = false; store.tripDetails[trip.id] = nil; dismiss()
                throw AppError.message("This trip is no longer available.")
            }
            trip = latestTrip; completed = trip.completed
            members = loadedMembers; entries = loadedEntries; debts = loadedDebts; ready = true
            store.tripDetails[trip.id] = TripSnapshot(trip: trip, members: members, entries: entries, debts: debts)
            if store.tripDetails.count > 20 { store.tripDetails = [trip.id: store.tripDetails[trip.id]!] }
        } catch { if !Task.isCancelled && loadId == current && store.user?.id == owner { self.error = error.localizedDescription } }
    }
    private func finish() {
        guard !changing else { return }
        changing = true
        Task {
            defer { changing = false }
            do {
                struct Payload: Encodable, Sendable { let pTrip: UUID; let pCompleted: Bool }
                try await API.shared.write(Payload(pTrip: trip.id, pCompleted: !completed), path: "rpc/complete_trip")
                completed.toggle()
                await load()
            } catch { self.error = error.localizedDescription }
        }
    }
}

struct TripExpenseForm: View {
    @Environment(AppStore.self) private var store
    @Environment(\.dismiss) private var dismiss
    let trip: Trip; let people: [Person]
    var editing: TripEntry? = nil
    @State private var reason = ""
    @State private var amount = ""
    @State private var payer = "me"
    @State private var selected: Set<String> = []
    @State private var custom = false
    @State private var amounts: [String: String] = [:]
    @State private var category: UUID?
    @State private var request = UUID()
    @State private var busy = false
    @State private var error: String?
    private enum Field: Hashable { case reason, amount, share(String) }
    @FocusState private var focus: Field?
    private var inputFields: [Field] { [.reason, .amount] + (custom ? participants.filter { selected.contains($0.0) }.map { .share($0.0) } : []) }
    private var nextField: Field? {
        guard let focus, let index = inputFields.firstIndex(of: focus), index + 1 < inputFields.count else { return nil }
        return inputFields[index + 1]
    }
    private var participants: [(String,String)] { [("me","you")] + people.map { ($0.id.uuidString.lowercased(),$0.name) } }
    var body: some View {
        SheetFrame(title: editing == nil ? "trip expense" : "edit expense", busy: busy, error: error, nextInput: nextField.map { next in { focus = next } }, dismissInput: { focus = nil }, inputFocused: focus != nil, save: save) {
            Section("details") {
                TextField("what for?", text: $reason).focused($focus, equals: .reason).submitLabel(.next).onSubmit { focus = .amount }
                TextField("total amount", text: $amount).keyboardType(.numbersAndPunctuation).focused($focus, equals: .amount).submitLabel(custom ? .next : .done).onSubmit { focus = nextField }
                Picker("paid by", selection: $payer) { ForEach(participants, id: \.0) { Text($0.1).tag($0.0) } }
                CategoryChips(categories: store.categories.filter { $0.archived != true }, selection: $category)
            }
            Section("split between") {
                TripPeopleChips(people: participants, selected: $selected)
                Toggle("custom shares", isOn: $custom)
                if custom {
                    ForEach(participants.filter { selected.contains($0.0) }, id: \.0) { id,name in
                        HStack {
                            Text(name)
                            TextField((try? shares()[id]).map { Money.format($0) } ?? "leave one blank", text: Binding(get: { amounts[id] ?? "" }, set: { amounts[id] = $0 })).keyboardType(.numbersAndPunctuation).multilineTextAlignment(.trailing).focused($focus, equals: .share(id)).submitLabel(id == participants.filter { selected.contains($0.0) }.last?.0 ? .done : .next).onSubmit { focus = nextField }
                        }
                    }
                }
            }
            Section {
                Text(payer == "me" ? "The full payment leaves this profile. Your share is spending; the rest is owed to you in Tabs." : "Your share becomes an amount you owe the payer in Tabs. Your balance changes when you record payment.").font(Theme.font(11)).foregroundStyle(.secondary)
                Text("Other participants’ debts to each other are not tracked. Trip expenses require a connection.").font(Theme.font(11)).foregroundStyle(.secondary)
            }
            if editing != nil { Section { Text("Updates this bill, your balance and its open Tabs together. If a payment or linked expense has changed, editing is blocked to protect those records.").font(Theme.font(11)).foregroundStyle(.secondary) } }
            if let editing { Section { TripDeleteControl(trip: trip, entry: editing) } }
        }.onAppear {
            if let editing {
                reason = editing.reason; amount = NSDecimalNumber(decimal: editing.amount).stringValue
                payer = editing.payer?.uuidString.lowercased() ?? "me"; category = editing.categoryId
                selected = Set(editing.shares.keys); custom = !editing.hasEqualShares
                amounts = editing.shares.mapValues { NSDecimalNumber(decimal: $0).stringValue }
            } else { selected = Set(participants.map(\.0)) }
        }.task { try? await Task.sleep(for: .milliseconds(300)); focus = .reason }
    }
    private func shares() throws -> [String: Decimal] {
        let total = try Money.parse(amount)
        let ids = participants.map(\.0).filter { selected.contains($0) }
        guard !ids.isEmpty else { throw AppError.message("Choose participants.") }
        if !custom {
            if let editing, editing.hasEqualShares, total == editing.amount, selected == Set(editing.shares.keys) { return editing.shares }
            let cents = NSDecimalNumber(decimal: total * 100).int64Value
            return Dictionary(uniqueKeysWithValues: ids.enumerated().map { i,id in (id, Decimal(cents / Int64(ids.count) + (Int64(i) < cents % Int64(ids.count) ? 1 : 0)) / 100) })
        }
        let blank = ids.filter { (amounts[$0] ?? "").trimmed.isEmpty }
        guard blank.count <= 1 else { throw AppError.message("Fill all but one share; the last is calculated automatically.") }
        var result: [String: Decimal] = [:]
        for id in ids where !blank.contains(id) { result[id] = try Money.parse(amounts[id] ?? "", allowZero: true) }
        let used = result.values.reduce(0,+)
        if let last = blank.first { result[last] = total - used }
        guard result.values.allSatisfy({ $0 >= 0 }), result.values.reduce(0,+) == total else { throw AppError.message("Shares must add up to the total.") }
        return result
    }
    private func save() {
        guard !busy else { return }
        do {
            let shares = try shares(), value = try Money.parse(amount)
            guard !reason.trimmed.isEmpty else { throw AppError.message("Enter a reason.") }
            busy = true; error = nil
            Task {
                defer { busy = false }
                do {
                    struct Payload: Encodable, Sendable {
                        let pId: UUID; let pTrip: UUID; let pReason: String; let pAmount: Decimal
                        let pPayer: UUID?; let pShares: [String: Decimal]; let pCategory: UUID?
                        let pRequest: UUID?; let pVersion: Int?
                        enum CodingKeys: String, CodingKey { case pId,pTrip,pReason,pAmount,pPayer,pShares,pCategory,pRequest,pVersion }
                        func encode(to encoder: Encoder) throws {
                            var c = encoder.container(keyedBy: CodingKeys.self)
                            try c.encode(pId, forKey: .pId)
                            if let pRequest { try c.encode(pRequest, forKey: .pRequest); try c.encode(pVersion, forKey: .pVersion) }
                            else { try c.encode(pTrip, forKey: .pTrip) }
                            try c.encode(pReason, forKey: .pReason); try c.encode(pAmount, forKey: .pAmount)
                            try c.encode(pPayer, forKey: .pPayer); try c.encode(pShares, forKey: .pShares); try c.encode(pCategory, forKey: .pCategory)
                        }
                    }
                    try await API.shared.write(Payload(pId: editing?.id ?? request, pTrip: trip.id, pReason: reason.trimmed, pAmount: value, pPayer: UUID(uuidString: payer), pShares: shares, pCategory: category, pRequest: editing == nil ? nil : request, pVersion: editing?.version ?? 1), path: editing == nil ? "rpc/add_trip_expense" : "rpc/edit_trip_expense")
                    await store.synchronize(); dismiss()
                } catch { self.error = error.localizedDescription }
            }
        } catch { self.error = error.localizedDescription }
    }
}
