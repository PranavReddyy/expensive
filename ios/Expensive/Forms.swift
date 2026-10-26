import SwiftUI

struct RecurringExpensesView: View {
    @Environment(AppStore.self) private var store
    @State private var rows: [RecurringExpense] = []
    @State private var adding = false
    @State private var busy = false
    @State private var error: String?
    static func day(_ date: Date) -> String {
        let f = DateFormatter(); f.calendar = Calendar(identifier: .gregorian)
        f.locale = Locale(identifier: "en_US_POSIX"); f.dateFormat = "yyyy-MM-dd"
        return f.string(from: date)
    }
    var body: some View {
        List {
            Section {
                Text("Review each occurrence before recording. Schedules never deduct money automatically.").font(Theme.font(11)).foregroundStyle(.secondary)
                Button("add schedule") { adding = true }.disabled(store.profiles.isEmpty)
            }
            if let error { Text(error).foregroundStyle(.red) }
            ForEach(rows) { row in
                Section {
                    HStack { Text(row.reason); Spacer(); Text(Money.format(row.amount)) }
                    Text("\(store.profiles.first { $0.id == row.profileId }?.name ?? "account") · \(row.cadence) · \(row.paused ? "paused" : "due " + row.nextDue)").font(Theme.font(11)).foregroundStyle(.secondary)
                    HStack {
                        if !row.paused && row.nextDue <= Self.day(Date()) {
                            Button("record") { review(row, action: "record") }.buttonStyle(PrimaryActionStyle(compact: true))
                            Button("skip") { review(row, action: "skip") }.buttonStyle(.borderless)
                        }
                        Spacer()
                        Button(row.paused ? "resume" : "pause") {
                            run {
                                struct Payload: Encodable, Sendable { let pId: UUID; let pPaused: Bool }
                                try await API.shared.write(Payload(pId: row.id, pPaused: !row.paused), path: "rpc/pause_recurring_expense")
                            }
                        }.buttonStyle(.borderless)
                    }
                }
            }
            if rows.isEmpty && !busy && error == nil { Text("No schedules yet.").foregroundStyle(.secondary) }
        }.font(Theme.font()).disabled(busy).navigationTitle("recurring expenses").navigationBarTitleDisplayMode(.inline)
            .scrollContentBackground(.hidden).background(Theme.background)
            .task { await load() }.refreshable { await load() }
            .sheet(isPresented: $adding, onDismiss: { Task { await load() } }) { RecurringExpenseForm() }
    }
    private func load() async {
        let owner = store.user?.id
        do {
            let result = try await API.shared.list(RecurringExpense.self, table: "recurring_expenses", query: [.init(name: "order", value: "next_due.asc,id.asc")])
            guard store.user?.id == owner, !Task.isCancelled else { return }; rows = result; error = nil
        } catch { self.error = error.localizedDescription }
    }
    private func run(_ action: @escaping @MainActor () async throws -> Void) {
        guard !busy else { return }; busy = true; error = nil
        Task { defer { busy = false }; do { try await action(); await store.synchronize(); await load() } catch { self.error = error.localizedDescription } }
    }
    private func review(_ row: RecurringExpense, action: String) {
        run {
            struct Payload: Encodable, Sendable { let pId: UUID; let pDue: String; let pAction: String; let pDate: Date }
            let f = DateFormatter(); f.calendar = Calendar(identifier: .gregorian); f.locale = Locale(identifier: "en_US_POSIX"); f.dateFormat = "yyyy-MM-dd HH:mm"
            guard let date = f.date(from: row.nextDue + " 12:00") else { throw AppError.message("Invalid due date.") }
            try await API.shared.write(Payload(pId: row.id, pDue: row.nextDue, pAction: action, pDate: date), path: "rpc/review_recurring_expense")
        }
    }
}

struct RecurringExpenseForm: View {
    private enum Field: Hashable { case reason, amount, notes }
    @Environment(AppStore.self) private var store
    @Environment(\.dismiss) private var dismiss
    @State private var profile: UUID?
    @State private var reason = ""
    @State private var amount = ""
    @State private var cadence = "monthly"
    @State private var category: UUID?
    @State private var notes = ""
    @State private var start = Date()
    @State private var request = UUID()
    @State private var busy = false
    @State private var error: String?
    @FocusState private var focus: Field?
    var body: some View {
        SheetFrame(title: "recurring expense", busy: busy, error: error, nextInput: focus == .reason ? { focus = .amount } : focus == .amount ? { focus = .notes } : nil, dismissInput: { focus = nil }, inputFocused: focus != nil, save: save) {
            Section {
                Picker("profile", selection: $profile) { ForEach(store.profiles) { Text($0.name).tag(Optional($0.id)) } }
                TextField("reason", text: $reason).focused($focus, equals: .reason).submitLabel(.next).onSubmit { focus = .amount }
                TextField("amount", text: $amount).keyboardType(.numbersAndPunctuation).focused($focus, equals: .amount).submitLabel(.next).onSubmit { focus = .notes }
                CategoryChips(categories: store.categories.filter { $0.archived != true }, selection: $category)
                TextField("notes (optional)", text: $notes).focused($focus, equals: .notes).submitLabel(.done).onSubmit { focus = nil }
                Picker("repeat", selection: $cadence) { ForEach(["weekly","monthly","yearly"], id: \.self) { Text($0).tag($0) } }
                DatePicker("first due date", selection: $start, displayedComponents: .date)
            } footer: { Text("Review and record each occurrence in account settings. Nothing is deducted automatically.") }
        }.task { profile = store.activeId; do { try await Task.sleep(for: .milliseconds(300)); focus = .reason } catch {} }
            .onChange(of: reason + amount + notes + cadence + (profile?.uuidString ?? "") + RecurringExpensesView.day(start)) { request = UUID() }
            .onChange(of: category) { request = UUID() }
    }
    private func save() {
        guard !busy else { return }
        do {
            let value = try Money.parse(amount)
            guard let profile, !reason.trimmed.isEmpty else { throw AppError.message("Choose a profile and enter a reason.") }
            struct Payload: Encodable, Sendable {
                let pId: UUID; let pProfile: UUID; let pReason: String; let pAmount: Decimal
                let pCategory: UUID?; let pNotes: String; let pCadence: String; let pStart: String
                enum CodingKeys: String, CodingKey { case pId,pProfile,pReason,pAmount,pCategory,pNotes,pCadence,pStart }
                func encode(to encoder: Encoder) throws {
                    var c = encoder.container(keyedBy: CodingKeys.self)
                    try c.encode(pId, forKey: .pId); try c.encode(pProfile, forKey: .pProfile)
                    try c.encode(pReason, forKey: .pReason); try c.encode(pAmount, forKey: .pAmount)
                    try c.encode(pCategory, forKey: .pCategory); try c.encode(pNotes, forKey: .pNotes)
                    try c.encode(pCadence, forKey: .pCadence); try c.encode(pStart, forKey: .pStart)
                }
            }
            let payload = Payload(pId: request, pProfile: profile, pReason: reason.trimmed, pAmount: value, pCategory: category, pNotes: notes.trimmed, pCadence: cadence, pStart: RecurringExpensesView.day(start))
            busy = true; error = nil
            Task { defer { busy = false }; do { try await API.shared.write(payload, path: "rpc/add_recurring_expense"); dismiss() } catch { self.error = error.localizedDescription } }
        } catch { self.error = error.localizedDescription }
    }
}

struct AccountForm: View {
    private enum Field: Hashable { case name, amount }
    @FocusState private var focus: Field?
    @Environment(AppStore.self) private var store
    @Environment(\.dismiss) private var dismiss
    let kind: HomeSheet
    let profile: Profile?
    @State private var name = ""
    @State private var amount = ""
    @State private var target: UUID?
    @State private var balanceMode = "set"
    @State private var requestId = UUID()
    @State private var busy = false
    @State private var error: String?
    private var title: String { kind == .profile ? "new profile" : kind == .balance ? "edit balance" : "transfer money" }
    var body: some View {
        SheetFrame(title: title, busy: busy, error: error, nextInput: focus == .name ? { focus = .amount } : nil, dismissInput: { focus = nil }, inputFocused: focus != nil, save: save) {
            if kind == .profile { Section("name") { TextField("cash, bank…", text: $name).textInputAutocapitalization(.words).focused($focus, equals: .name).submitLabel(.next).onSubmit { focus = .amount } } }
            if let profile, kind != .profile { Section { Text(profile.name); Text("available \(Money.format(profile.balance))").foregroundStyle(.secondary) } }
            if kind == .transfer {
                Section("to account") {
                    Picker("account", selection: $target) { ForEach(store.profiles.filter { $0.id != profile?.id }) { Text($0.name).tag(Optional($0.id)) } }
                }
            }
            if kind == .balance {
                Section {
                    Picker("change balance", selection: $balanceMode) {
                        Text("set").tag("set"); Text("add").tag("add"); Text("subtract").tag("subtract")
                    }.pickerStyle(.segmented)
                    if balanceMode != "set" { Text("Adjusts your balance only; this is not recorded as spending.").font(Theme.font(11)).foregroundStyle(.secondary) }
                }
            }
            Section("\(kind == .transfer ? "amount" : balanceMode == "set" ? "current balance" : "amount to \(balanceMode)") (\(CurrencyPreference.shared.symbol))") { TextField("0.00", text: $amount).keyboardType(.numbersAndPunctuation).focused($focus, equals: .amount).submitLabel(.done).onSubmit { focus = nil } }
            Section {
                Text(kind == .transfer ? "Moves money between these profiles. Your total money and spending stay the same." : balanceMode != "set" ? "Enter only the amount to \(balanceMode), not your new total balance." : "Enter the money you have right now, including money you still owe and excluding money others haven't repaid.")
                    .font(Theme.font(11)).foregroundStyle(.secondary)
            }
        }
        .onAppear { if kind == .balance { amount = NSDecimalNumber(decimal: profile?.balance ?? 0).stringValue }; target = store.profiles.first { $0.id != profile?.id }?.id }
        .task { do { try await Task.sleep(for: .milliseconds(300)); focus = kind == .profile ? .name : .amount } catch {} }
        .onChange(of: amount) { requestId = UUID() }.onChange(of: name) { requestId = UUID() }.onChange(of: target) { requestId = UUID() }
        .onChange(of: balanceMode) { amount = balanceMode == "set" ? NSDecimalNumber(decimal: profile?.balance ?? 0).stringValue : ""; requestId = UUID(); focus = .amount }
    }
    private func save() {
        guard !busy else { return }
        do {
            let relative = kind == .balance && balanceMode != "set"
            let value = try Money.parse(amount.isEmpty && kind == .profile ? "0" : amount, allowNegative: kind != .transfer && !relative, allowZero: kind != .transfer && !relative)
            if kind == .profile && name.trimmed.isEmpty { throw AppError.message("Enter a profile name.") }
            if kind == .transfer && target == nil { throw AppError.message("Choose another profile.") }
            busy = true; error = nil
            Task {
                defer { busy = false }
                do {
                    if kind == .profile { try await store.createProfile(id: requestId, name: name, balance: value) }
                    else if let profile {
                        if kind == .balance { try await store.balance(id: requestId, profile: profile.id, amount: value, mode: balanceMode) }
                        else if let target { try await store.transfer(id: requestId, from: profile.id, to: target, amount: value) }
                    }
                    dismiss()
                } catch { self.error = error.localizedDescription }
            }
        } catch { self.error = error.localizedDescription }
    }
}

struct ExpenseForm: View {
    private enum Field: Hashable { case reason, amount, notes }
    @FocusState private var focus: Field?
    @Environment(AppStore.self) private var store
    @Environment(\.dismiss) private var dismiss
    let profile: Profile
    var editing: Expense? = nil
    private enum QuickEntry: String, Identifiable { case tabs, split; var id: String { rawValue } }
    @State private var quickEntry: QuickEntry?
    @State private var savedQuickEntry = false
    @State private var selectedProfileId: UUID?
    private var expenseProfileId: UUID { selectedProfileId ?? profile.id }
    private var expenseProfileName: String { store.profiles.first { $0.id == expenseProfileId }?.name ?? profile.name }
    @State private var reason = ""
    @State private var amount = ""
    @State private var notes = ""
    @State private var category: UUID?
    @State private var date = Date()
    @State private var requestId = UUID()
    @State private var busy = false
    @State private var error: String?
    var body: some View {
        SheetFrame(title: editing == nil ? "log expense" : "edit expense", busy: busy, error: error, nextInput: focus == .reason ? { focus = .amount } : focus == .amount ? { focus = .notes } : nil, dismissInput: { focus = nil }, inputFocused: focus != nil, openTabs: editing == nil ? { focus = nil; quickEntry = .tabs } : nil, openSplit: editing == nil ? { focus = nil; quickEntry = .split } : nil, save: save) {
            Section {
                TextField("what was it for?", text: $reason).focused($focus, equals: .reason).submitLabel(.next).onSubmit { focus = .amount }
                TextField("amount (\(CurrencyPreference.shared.symbol))", text: $amount).keyboardType(.numbersAndPunctuation).focused($focus, equals: .amount).submitLabel(.next).onSubmit { focus = .notes }
            } header: {
                if editing == nil && store.profiles.count > 1 {
                    ScrollViewReader { proxy in
                        ScrollView(.horizontal) {
                            HStack(spacing: 6) {
                                ForEach(store.profiles) { option in
                                    Button { selectedProfileId = option.id } label: {
                                        Text(option.name)
                                            .font(Theme.font(11, weight: .medium)).fixedSize()
                                            .padding(.horizontal, 12).padding(.vertical, 7)
                                            .foregroundStyle(expenseProfileId == option.id ? Theme.onInk : Theme.ink)
                                            .background(expenseProfileId == option.id ? Theme.ink : Theme.ink.opacity(0.06), in: Capsule())
                                            .frame(minHeight: 44).contentShape(Rectangle())
                                    }.buttonStyle(.plain).id(option.id)
                                        .accessibilityLabel("Expense profile, \(option.name)")
                                        .accessibilityAddTraits(expenseProfileId == option.id ? .isSelected : [])
                                }
                            }
                        }.scrollIndicators(.hidden)
                            .onAppear { proxy.scrollTo(expenseProfileId, anchor: .center) }
                            .onChange(of: selectedProfileId) { proxy.scrollTo(expenseProfileId, anchor: .center) }
                    }.textCase(nil).disabled(busy)
                } else { Text(expenseProfileName).textCase(nil) }
            }
            Section {
                if !store.categories.isEmpty { CategoryChips(categories: store.categories.filter { $0.archived != true || $0.id == category }, selection: $category) }
                DatePicker("when", selection: $date, in: ...Date(), displayedComponents: [.date, .hourAndMinute])
                TextField("notes (optional)", text: $notes).focused($focus, equals: .notes).submitLabel(.done).onSubmit { focus = nil }
            }
        }
        .sheet(item: $quickEntry, onDismiss: { if savedQuickEntry { dismiss() } }) { destination in
            if let target = store.profiles.first(where: { $0.id == expenseProfileId }) {
                AddTabForm(profile: target, split: destination == .split, initialAmount: amount, initialReason: reason, onSaved: { savedQuickEntry = true })
            }
        }
        .task {
            if let editing {
                reason = editing.reason; amount = NSDecimalNumber(decimal: editing.amount).stringValue
                notes = editing.notes ?? ""; category = editing.categoryId; date = editing.createdAt
            }
            do { try await Task.sleep(for: .milliseconds(300)); focus = .reason } catch {}
        }
        .onChange(of: reason + amount + notes) { requestId = UUID() }.onChange(of: category) { requestId = UUID() }.onChange(of: date) { requestId = UUID() }
        .onChange(of: selectedProfileId) { requestId = UUID(); error = nil }
    }
    private func save() {
        guard !busy else { return }
        do {
            let value = try Money.parse(amount)
            guard !reason.trimmed.isEmpty else { throw AppError.message("Add what this expense was for.") }
            let target = expenseProfileId
            guard store.profiles.contains(where: { $0.id == target }) else { throw AppError.message("Choose an available profile.") }
            busy = true; error = nil
            Task {
                defer { busy = false }
                do {
                    if let editing { try await store.editExpense(request: requestId, expense: editing, reason: reason, amount: value, category: category, notes: notes, date: date) }
                    else { try await store.addExpense(id: requestId, profile: target, reason: reason, amount: value, category: category, notes: notes, date: date) }
                    dismiss()
                }
                catch { self.error = error.localizedDescription }
            }
        } catch { self.error = error.localizedDescription }
    }
}

struct ExpenseDetail: View {
    @Environment(AppStore.self) private var store
    @Environment(\.dismiss) private var dismiss
    let expense: Expense
    @State private var target: UUID?
    @State private var deleting = false
    @State private var busy = false
    @State private var error: String?
    @State private var editing = false
    var body: some View {
        NavigationStack {
            Form {
                Section { ExpenseRow(expense: expense) }
                Section { Button("edit expense") { editing = true } }
                if store.profiles.count > 1 {
                    Section("move expense") {
                        Picker("to profile", selection: $target) {
                            Text("choose account").tag(nil as UUID?)
                            ForEach(store.profiles.filter { $0.id != expense.profileId }) { Text($0.name).tag(Optional($0.id)) }
                        }
                        Text("Restores the amount to the original profile and deducts it from the selected profile.").font(Theme.font(11)).foregroundStyle(.secondary)
                        Button("move expense") { perform { if let target { try await store.move(expense, to: target) } } }.disabled(target == nil)
                    }
                }
                Section { Button("delete expense", role: .destructive) { deleting = true } }
                if let error { Text(error).foregroundStyle(.red) }
                if busy { LoadingState(title: "updating") }
            }.font(Theme.font()).disabled(busy).scrollContentBackground(.hidden).background(Theme.background)
                .navigationTitle("expense").navigationBarTitleDisplayMode(.inline)
                .toolbar { ToolbarItem(placement: .cancellationAction) { Button("done") { dismiss() }.disabled(busy) } }
                .confirmationDialog("Delete this expense and restore \(Money.format(expense.amount))?", isPresented: $deleting, titleVisibility: .visible) {
                    Button("delete expense", role: .destructive) { perform { try await store.delete(expense) } }
                }
        }.interactiveDismissDisabled(busy).presentationDragIndicator(.visible)
            .sheet(isPresented: $editing, onDismiss: { dismiss() }) {
                if let profile = store.profiles.first(where: { $0.id == expense.profileId }) { ExpenseForm(profile: profile, editing: expense) }
            }
    }
    private func perform(_ action: @escaping @MainActor () async throws -> Void) {
        guard !busy else { return }; busy = true; error = nil
        Task { defer { busy = false }; do { try await action(); dismiss() } catch { self.error = error.localizedDescription } }
    }
}
