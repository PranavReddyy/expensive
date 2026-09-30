import SwiftUI

struct AccountForm: View {
    @Environment(AppStore.self) private var store
    @Environment(\.dismiss) private var dismiss
    let kind: HomeSheet
    let profile: Profile?
    @State private var name = ""
    @State private var amount = ""
    @State private var target: UUID?
    @State private var requestId = UUID()
    @State private var busy = false
    @State private var error: String?
    private var title: String { kind == .profile ? "new profile" : kind == .balance ? "edit balance" : "transfer money" }
    var body: some View {
        SheetFrame(title: title, busy: busy, error: error, save: save) {
            if kind == .profile { Section("name") { TextField("cash, bank…", text: $name).textInputAutocapitalization(.words) } }
            if let profile, kind != .profile { Section { Text(profile.name); Text("available \(Money.format(profile.balance))").foregroundStyle(.secondary) } }
            if kind == .transfer {
                Section("to account") {
                    Picker("account", selection: $target) { ForEach(store.profiles.filter { $0.id != profile?.id }) { Text($0.name).tag(Optional($0.id)) } }
                }
            }
            Section(kind == .transfer ? "amount (₹)" : "current balance (₹)") { TextField("0.00", text: $amount).keyboardType(kind == .transfer ? .decimalPad : .numbersAndPunctuation) }
            Section {
                Text(kind == .transfer ? "Moves money between these profiles. Your total money and spending stay the same." : "Enter the money you have right now, including money you still owe and excluding money others haven't repaid.")
                    .font(Theme.font(11)).foregroundStyle(.secondary)
            }
        }
        .onAppear { if kind == .balance { amount = NSDecimalNumber(decimal: profile?.balance ?? 0).stringValue }; target = store.profiles.first { $0.id != profile?.id }?.id }
        .onChange(of: amount) { requestId = UUID() }.onChange(of: name) { requestId = UUID() }.onChange(of: target) { requestId = UUID() }
    }
    private func save() {
        guard !busy else { return }
        do {
            let value = try Money.parse(amount.isEmpty && kind == .profile ? "0" : amount, allowNegative: kind != .transfer, allowZero: kind != .transfer)
            if kind == .profile && name.trimmed.isEmpty { throw AppError.message("Enter a profile name.") }
            if kind == .transfer && target == nil { throw AppError.message("Choose another profile.") }
            busy = true; error = nil
            Task {
                defer { busy = false }
                do {
                    if kind == .profile { try await store.createProfile(id: requestId, name: name, balance: value) }
                    else if let profile {
                        if kind == .balance { try await store.balance(profile: profile.id, amount: value) }
                        else if let target { try await store.transfer(id: requestId, from: profile.id, to: target, amount: value) }
                    }
                    dismiss()
                } catch { self.error = error.localizedDescription }
            }
        } catch { self.error = error.localizedDescription }
    }
}

struct ExpenseForm: View {
    @Environment(AppStore.self) private var store
    @Environment(\.dismiss) private var dismiss
    let profile: Profile
    @State private var reason = ""
    @State private var amount = ""
    @State private var notes = ""
    @State private var category: UUID?
    @State private var date = Date()
    @State private var requestId = UUID()
    @State private var busy = false
    @State private var error: String?
    var body: some View {
        SheetFrame(title: "log expense", busy: busy, error: error, save: save) {
            Section(profile.name) {
                TextField("what was it for?", text: $reason)
                TextField("amount (₹)", text: $amount).keyboardType(.decimalPad)
            }
            Section {
                Picker("category", selection: $category) {
                    Text("uncategorized").tag(nil as UUID?)
                    ForEach(store.categories) { Text($0.name).tag(Optional($0.id)) }
                }
                DatePicker("when", selection: $date, in: ...Date(), displayedComponents: [.date, .hourAndMinute])
                TextField("notes (optional)", text: $notes, axis: .vertical).lineLimit(3...5)
            }
        }
        .onChange(of: reason + amount + notes) { requestId = UUID() }.onChange(of: category) { requestId = UUID() }.onChange(of: date) { requestId = UUID() }
    }
    private func save() {
        guard !busy else { return }
        do {
            let value = try Money.parse(amount)
            guard !reason.trimmed.isEmpty else { throw AppError.message("Add what this expense was for.") }
            busy = true; error = nil
            Task {
                defer { busy = false }
                do { try await store.addExpense(id: requestId, profile: profile.id, reason: reason, amount: value, category: category, notes: notes, date: date); dismiss() }
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
    var body: some View {
        NavigationStack {
            Form {
                Section { ExpenseRow(expense: expense) }
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
                if busy { ProgressView() }
            }.font(Theme.font()).disabled(busy).scrollContentBackground(.hidden).background(Color.white)
                .navigationTitle("expense").navigationBarTitleDisplayMode(.inline)
                .toolbar { ToolbarItem(placement: .cancellationAction) { Button("done") { dismiss() }.disabled(busy) } }
                .confirmationDialog("Delete this expense and restore \(Money.format(expense.amount))?", isPresented: $deleting, titleVisibility: .visible) {
                    Button("delete expense", role: .destructive) { perform { try await store.delete(expense) } }
                }
        }.interactiveDismissDisabled(busy).presentationDragIndicator(.visible)
    }
    private func perform(_ action: @escaping @MainActor () async throws -> Void) {
        guard !busy else { return }; busy = true; error = nil
        Task { defer { busy = false }; do { try await action(); dismiss() } catch { self.error = error.localizedDescription } }
    }
}
