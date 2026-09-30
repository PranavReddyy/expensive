import SwiftUI

struct TabsView: View {
    @Environment(AppStore.self) private var store
    @State private var search = ""
    @State private var filter = "all"
    @State private var highToLow = false
    @State private var adding = false
    @State private var splitting = false
    @State private var selected: PersonTab?
    private var visible: [PersonTab] {
        store.tabs.filter { (search.trimmed.isEmpty || $0.person.name.localizedCaseInsensitiveContains(search.trimmed)) && (filter == "all" || (filter == "owed" ? $0.net > 0 : $0.net < 0)) }
            .sorted { highToLow && abs($0.net) != abs($1.net) ? abs($0.net) > abs($1.net) : $0.person.name.localizedCaseInsensitiveCompare($1.person.name) == .orderedAscending }
    }
    var body: some View {
        Page {
            ProfilePicker()
            if let error = store.error { ErrorNotice(message: error, retry: { Task { await store.refreshLedger() } }) }
            if store.active == nil { EmptyState(title: "no profile yet", detail: "Create your first profile from Home.") }
            else {
                BalanceBlock()
                ViewThatFits(in: .horizontal) {
                    HStack { actions }
                    VStack(alignment: .leading, spacing: 12) { actions }
                }
                if visible.isEmpty { EmptyState(title: search.isEmpty && filter == "all" ? "nothing outstanding" : "no matching tabs", detail: "Add an amount or split a payment to start a tab.") }
                else {
                    LazyVStack(spacing: 0) {
                        ForEach(visible) { tab in
                            HStack(alignment: .top, spacing: 16) {
                                VStack(alignment: .leading, spacing: 6) {
                                    Text(tab.person.name).font(Theme.font(14, weight: .medium))
                                    Text(tab.label).font(Theme.font(11)).foregroundStyle(.secondary)
                                    if tab.collect > 0 && tab.pay > 0 { Text("owed \(Money.format(tab.collect)) · owing \(Money.format(tab.pay))").font(Theme.font(10)).foregroundStyle(.secondary) }
                                }
                                Spacer(minLength: 0)
                                VStack(alignment: .trailing, spacing: 10) {
                                    Text(Money.format(abs(tab.net))).monospacedDigit()
                                    if tab.open { Button(tab.net == 0 ? "clear tab" : "record payment") { selected = tab }.buttonStyle(.glass).font(Theme.font(10)) }
                                }
                            }.padding(.vertical, 18)
                            Divider()
                        }
                    }
                }
            }
        }.pageTitle("TABS").searchable(text: $search, prompt: "search people")
        .sheet(isPresented: $adding) { if let profile = store.active { AddTabForm(profile: profile, split: false) } }
        .sheet(isPresented: $splitting) { if let profile = store.active { AddTabForm(profile: profile, split: true) } }
        .sheet(item: $selected) { SettlementForm(tab: $0) }
        .onChange(of: store.activeId) { selected = nil; search = "" }
        .refreshable { await store.synchronize() }
    }
    private var actions: some View {
        Group {
            Button("+ add amount") { adding = true }.buttonStyle(.glassProminent)
            Button("split a payment") { splitting = true }.buttonStyle(.glass)
            Menu {
                Picker("show", selection: $filter) { Text("all").tag("all"); Text("owed to me").tag("owed"); Text("I owe").tag("owing") }
                Toggle("amount: high to low", isOn: $highToLow)
            } label: { Image(systemName: filter == "all" && !highToLow ? "line.3.horizontal.decrease" : "line.3.horizontal.decrease.circle.fill").frame(minWidth: 24) }
                .buttonStyle(.glass).accessibilityLabel("Filter and sort tabs")
        }.font(Theme.font(11)).controlSize(.large)
    }
}

struct AddTabForm: View {
    @Environment(AppStore.self) private var store
    @Environment(\.dismiss) private var dismiss
    let profile: Profile
    let split: Bool
    @State private var query = ""
    @State private var selected: [UUID] = []
    @State private var amount = ""
    @State private var reason = ""
    @State private var direction: Direction = .collect
    @State private var includesYou = true
    @State private var requestId = UUID()
    @State private var personRequestId = UUID()
    @State private var busy = false
    @State private var error: String?
    private var matches: [Person] { store.people.filter { $0.profileId == profile.id && $0.name.localizedCaseInsensitiveContains(query.trimmed) && !selected.contains($0.id) } }
    private var preview: (amounts: [Decimal], own: Decimal)? {
        guard split, let value = try? Money.parse(amount) else { return nil }
        return try? Money.split(value, people: selected.count, includesYou: includesYou)
    }
    var body: some View {
        SheetFrame(title: split ? "split a payment" : "add amount", busy: busy, error: error, save: save) {
            Section("people") {
                ForEach(selected, id: \.self) { id in
                    HStack { Text(store.people.first { $0.id == id }?.name ?? "person"); Spacer(); Button { selected.removeAll { $0 == id } } label: { Image(systemName: "xmark") }.accessibilityLabel("Remove person") }
                }
                TextField("search or add a name", text: $query).autocorrectionDisabled()
                if !query.trimmed.isEmpty {
                    ForEach(matches) { person in Button(person.name) { choose(person) } }
                    if !store.people.contains(where: { $0.profileId == profile.id && $0.name.caseInsensitiveCompare(query.trimmed) == .orderedSame }) {
                        Button("+ add “\(query.trimmed)”") { addPerson() }
                    }
                }
            }
            if !split {
                Section { Picker("direction", selection: $direction) { ForEach(Direction.allCases, id: \.self) { Text($0.label).tag($0) } }.pickerStyle(.segmented) }
            }
            Section {
                TextField("what was it for?", text: $reason)
                TextField(split ? "total you paid (₹)" : "amount (₹)", text: $amount).keyboardType(.decimalPad)
                if split { Toggle("include my share", isOn: $includesYou) }
            }
            if let preview {
                Section("split preview") {
                    ForEach(Array(selected.enumerated()), id: \.element) { index, id in
                        HStack { Text(store.people.first { $0.id == id }?.name ?? "person"); Spacer(); Text(Money.format(preview.amounts[index])) }
                    }
                    if includesYou { HStack { Text("your expense"); Spacer(); Text(Money.format(preview.own)) } }
                }
            }
            Section {
                Text(split ? "The full payment leaves your balance. Only your own share is recorded as an expense." : direction == .collect ? "This amount leaves your balance now." : "Your balance changes when you record the payment.").font(Theme.font(11)).foregroundStyle(.secondary)
            }
        }
        .onChange(of: query) { personRequestId = UUID() }
        .onChange(of: amount + reason) { requestId = UUID() }.onChange(of: selected) { requestId = UUID() }
        .onChange(of: direction) { requestId = UUID() }.onChange(of: includesYou) { requestId = UUID() }
    }
    private func choose(_ person: Person) {
        selected = split ? Array(Set(selected + [person.id])).sorted { $0.uuidString < $1.uuidString } : [person.id]
        query = ""
    }
    private func addPerson() {
        guard !busy, !query.trimmed.isEmpty else { return }; busy = true; error = nil
        Task {
            defer { busy = false }
            do { let person = try await store.addPerson(id: personRequestId, name: query, profile: profile.id); choose(person) }
            catch { self.error = error.localizedDescription }
        }
    }
    private func save() {
        guard !busy else { return }
        do {
            let value = try Money.parse(amount)
            guard !selected.isEmpty else { throw AppError.message("Search for a person or add a name.") }
            guard !reason.trimmed.isEmpty else { throw AppError.message("Add what this amount was for.") }
            let division = split ? try Money.split(value, people: selected.count, includesYou: includesYou) : (amounts: [value], own: Decimal.zero)
            let rows = selected.enumerated().map { AppStore.TabRow(personId: $0.element, amount: division.amounts[$0.offset], direction: split ? .collect : direction, description: reason.trimmed) }
            busy = true; error = nil
            Task {
                defer { busy = false }
                do { try await store.addTabs(id: requestId, profile: profile.id, rows: rows, ownShare: division.own); dismiss() }
                catch { self.error = error.localizedDescription }
            }
        } catch { self.error = error.localizedDescription }
    }
}

struct SettlementForm: View {
    @Environment(AppStore.self) private var store
    @Environment(\.dismiss) private var dismiss
    let tab: PersonTab
    @State private var amount = ""
    @State private var busy = false
    @State private var error: String?
    var body: some View {
        SheetFrame(title: tab.person.name, busy: busy, error: error, actionTitle: tab.net == 0 ? "clear" : "record", save: save) {
            Section {
                Text(tab.net > 0 ? "payment received from them" : tab.net < 0 ? "payment you made to them" : "clear matching amounts")
                Text("net remaining \(Money.format(abs(tab.net)))")
                if tab.collect > 0 && tab.pay > 0 { Text("\(Money.format(min(tab.collect, tab.pay))) cancels out in both directions when confirmed.").font(Theme.font(11)).foregroundStyle(.secondary) }
            }
            if tab.net != 0 { Section("amount (₹)") { TextField("0.00", text: $amount).keyboardType(.decimalPad) } }
            Section {
                Text(tab.net > 0 ? "Adds this payment to your balance." : tab.net < 0 ? "Deducts this payment and saves it as an expense." : "Your balance stays the same.").font(Theme.font(11)).foregroundStyle(.secondary)
            }
            Section {
                DisclosureGroup("view entries") {
                    ForEach(tab.entries) { entry in
                        VStack(alignment: .leading, spacing: 5) {
                            Text(entry.description)
                            Text("\(entry.direction.label) · \(Money.format(entry.remainingAmount))").font(Theme.font(11)).foregroundStyle(.secondary)
                        }.padding(.vertical, 4)
                    }
                }
            }
        }.onAppear { amount = NSDecimalNumber(decimal: abs(tab.net)).stringValue }
    }
    private func save() {
        guard !busy else { return }
        do {
            let payment = try Money.parse(amount, allowZero: tab.net == 0)
            guard payment <= abs(tab.net) else { throw AppError.message("Enter a payment up to the net amount.") }
            busy = true; error = nil
            Task {
                defer { busy = false }
                do { try await store.settle(tab, payment: payment); dismiss() }
                catch { self.error = error.localizedDescription }
            }
        } catch { self.error = error.localizedDescription }
    }
}
