import SwiftUI
import Observation

@MainActor @Observable final class ExpenseLoader {
    var rows: [Expense] = []
    var loading = false
    var error: String?
    private var dataKey = ""
    private var request = UUID()
    func load(_ store: AppStore, interval: DateInterval?) async {
        let key = "\(store.activeId?.uuidString ?? "")/\(interval?.start.timeIntervalSince1970 ?? 0)/\(interval?.end.timeIntervalSince1970 ?? 0)"
        if key != dataKey { rows = []; dataKey = key }
        let current = UUID(); request = current
        loading = true; error = nil
        defer { if request == current { loading = false } }
        do {
            let loaded = try await store.expenses(interval: interval)
            guard !Task.isCancelled, request == current else { return }
            rows = loaded
        } catch {
            guard !Task.isCancelled, request == current, !(error is CancellationError) else { return }
            if case AppError.signedOut = error { store.handle(error) }
            self.error = error.localizedDescription
        }
    }
}

enum HomeSheet: String, Identifiable { case expense, profile, balance, transfer; var id: String { rawValue } }

struct HomeView: View {
    @Environment(AppStore.self) private var store
    @State private var loader = ExpenseLoader()
    @State private var sheet: HomeSheet?
    @State private var logout = false
    private var now: Date { Date() }
    private var month: DateInterval { Calendar.current.dateInterval(of: .month, for: now)! }
    private var week: DateInterval {
        let end = Calendar.current.date(byAdding: .day, value: 1, to: Calendar.current.startOfDay(for: now))!
        return DateInterval(start: Calendar.current.date(byAdding: .day, value: -6, to: Calendar.current.startOfDay(for: now))!, end: end)
    }
    private var range: DateInterval { DateInterval(start: min(month.start, week.start), end: month.end) }
    private var monthly: [Expense] { loader.rows.filter { $0.createdAt >= month.start && $0.createdAt <= now } }
    var body: some View {
        Page {
            ProfilePicker()
            if let error = store.error { ErrorNotice(message: error, retry: { Task { await store.refresh() } }) }
            if store.active != nil {
                BalanceBlock(edit: { sheet = .balance })
                HStack {
                    Button("+ log expense") { sheet = .expense }.buttonStyle(.glassProminent)
                    Spacer()
                    if store.profiles.count > 1 { Button("transfer money") { sheet = .transfer }.buttonStyle(.glass) }
                }.font(Theme.font(12)).controlSize(.large)
                VStack(alignment: .leading, spacing: 18) {
                    SectionLabel("spending · \(now.formatted(.dateTime.month(.wide)))")
                    if loader.loading && loader.rows.isEmpty { ProgressView().frame(maxWidth: .infinity) }
                    else {
                        HStack(spacing: 10) {
                            Stat(label: "spent today", value: Money.format(monthly.filter { Calendar.current.isDateInToday($0.createdAt) }.reduce(0) { $0 + $1.amount }))
                            Stat(label: "this month", value: Money.format(monthly.reduce(0) { $0 + $1.amount }))
                        }
                        SectionLabel("last 7 days")
                        SpendingChart(points: Insights.points(loader.rows.filter { $0.createdAt <= now }, interval: week), height: 120)
                        let categories = Insights.categories(monthly)
                        if !categories.isEmpty {
                            SectionLabel("top categories this month")
                            ForEach(Array(categories.prefix(3)), id: \.name) { category in
                                HStack { Text(category.name); Spacer(); Text(Money.format(category.amount)).monospacedDigit() }.font(Theme.font(12))
                            }
                        } else { Text("No expenses this month yet.").foregroundStyle(.secondary).font(Theme.font(12)) }
                    }
                    if let error = loader.error { ErrorNotice(message: error, retry: { Task { await loader.load(store, interval: range) } }) }
                }
            } else if store.loading { ProgressView() }
            else {
                EmptyState(title: "your first account", detail: "Create a profile for your cash, bank account, or any other pool of money.")
                Button("+ create profile") { sheet = .profile }.buttonStyle(.glassProminent).controlSize(.large)
            }
            if let email = store.user?.email {
                Text((store.user?.username.map { "@\($0) · " } ?? "") + email)
                    .font(Theme.font(10)).foregroundStyle(.secondary).textSelection(.enabled)
            }
        }
        .pageTitle("EXPENS***")
        .toolbar {
            ToolbarItem(placement: .topBarLeading) { Button { logout = true } label: { Image(systemName: "rectangle.portrait.and.arrow.right") }.accessibilityLabel("Sign out") }
            ToolbarItem(placement: .topBarTrailing) { Button { sheet = .profile } label: { Image(systemName: "plus") }.accessibilityLabel("New profile") }
        }
        .confirmationDialog("Sign out of this account?", isPresented: $logout, titleVisibility: .visible) {
            Button("sign out", role: .destructive) { Task { do { try await store.logout() } catch { store.handle(error) } } }
        }
        .sheet(item: $sheet) { type in
            if type == .expense, let profile = store.active { ExpenseForm(profile: profile) }
            else { AccountForm(kind: type, profile: store.active) }
        }
        .refreshable { await store.synchronize() }
        .task(id: "\(store.activeId?.uuidString ?? "")-\(store.revision)-\(range.start)") { await loader.load(store, interval: range) }
    }
}

struct ExpensesView: View {
    @Environment(AppStore.self) private var store
    @State private var loader = ExpenseLoader()
    @State private var period: Period = .month
    @State private var anchor = Date()
    @State private var category: UUID?
    @State private var search = ""
    @State private var detail: Expense?
    @State private var adding = false
    private var visible: [Expense] {
        loader.rows.filter { (category == nil || $0.categoryId == category) && (search.trimmed.isEmpty || ($0.reason + " " + ($0.notes ?? "")).localizedCaseInsensitiveContains(search.trimmed)) }
    }
    var body: some View {
        Page {
            ProfilePicker()
            if store.active == nil { EmptyState(title: "no profile yet", detail: "Create your first profile from Home.") }
            else {
                PeriodPicker(period: $period, anchor: $anchor)
                HStack {
                    Menu {
                        Button("all categories") { category = nil }
                        ForEach(store.categories) { item in Button(item.name) { category = item.id } }
                    } label: { Label(store.categories.first { $0.id == category }?.name ?? "all categories", systemImage: "line.3.horizontal.decrease") }
                        .buttonStyle(.glass).font(Theme.font(11))
                    Spacer()
                    Text(Money.format(visible.reduce(0) { $0 + $1.amount })).font(Theme.font(15, weight: .medium))
                }
                if let error = loader.error { ErrorNotice(message: error, retry: { Task { await loader.load(store, interval: period.interval(containing: anchor)) } }) }
                if loader.loading && loader.rows.isEmpty { ProgressView() }
                else if visible.isEmpty { EmptyState(title: "no expenses here", detail: "Try another period or category, or log an expense.") }
                else {
                    LazyVStack(spacing: 0) {
                        ForEach(visible) { expense in
                            Button { detail = expense } label: { ExpenseRow(expense: expense) }.buttonStyle(.plain)
                            Divider()
                        }
                    }
                }
            }
        }
        .pageTitle("EXPENSES").searchable(text: $search, prompt: "search expenses")
        .toolbar { ToolbarItem(placement: .topBarTrailing) { Button { adding = true } label: { Image(systemName: "plus") }.disabled(store.active == nil).accessibilityLabel("Log expense") } }
        .sheet(item: $detail) { ExpenseDetail(expense: $0) }
        .sheet(isPresented: $adding) { if let profile = store.active { ExpenseForm(profile: profile) } }
        .onChange(of: store.activeId) { category = nil; detail = nil; search = "" }
        .refreshable { await store.synchronize() }
        .task(id: "\(store.activeId?.uuidString ?? "")/\(period)/\(anchor)/\(store.revision)") { await loader.load(store, interval: period.interval(containing: anchor)) }
    }
}

struct ExpenseRow: View {
    let expense: Expense
    var body: some View {
        HStack(alignment: .top, spacing: 16) {
            VStack(alignment: .leading, spacing: 6) {
                Text(expense.reason).font(Theme.font(13, weight: .medium)).foregroundStyle(.primary)
                if let notes = expense.notes, !notes.isEmpty { Text(notes).font(Theme.font(11)).foregroundStyle(.secondary).lineLimit(2) }
                Text(expense.createdAt.formatted(.dateTime.day().month(.abbreviated).hour().minute())).font(Theme.font(10)).foregroundStyle(.secondary)
                if let name = expense.categories?.name { Text(name).font(Theme.font(10)).foregroundStyle(.secondary) }
            }
            Spacer(minLength: 0)
            Text(Money.format(expense.amount)).font(Theme.font(13, weight: .medium)).monospacedDigit()
        }.padding(.vertical, 18).contentShape(Rectangle())
    }
}

struct AnalyticsView: View {
    @Environment(AppStore.self) private var store
    @State private var loader = ExpenseLoader()
    @State private var period: Period = .month
    @State private var anchor = Date()
    @State private var cumulative = false
    private var interval: DateInterval { period.interval(containing: anchor)! }
    private var previous: DateInterval { period.interval(containing: period.shifted(anchor, by: -1))! }
    private var range: DateInterval { DateInterval(start: previous.start, end: interval.end) }
    private var current: [Expense] { loader.rows.filter { $0.createdAt >= interval.start && $0.createdAt < interval.end } }
    private var total: Decimal { current.reduce(0) { $0 + $1.amount } }
    private var previousTotal: Decimal { loader.rows.filter { $0.createdAt >= previous.start && $0.createdAt < previous.end }.reduce(0) { $0 + $1.amount } }
    private var unit: Calendar.Component { period == .day ? .hour : period == .year ? .month : .day }
    var body: some View {
        Page {
            ProfilePicker()
            if store.active == nil { EmptyState(title: "no profile yet", detail: "Create a profile and log an expense to see your analytics.") }
            else {
                PeriodPicker(period: $period, anchor: $anchor, allowAll: false)
                if let error = loader.error { ErrorNotice(message: error, retry: { Task { await loader.load(store, interval: range) } }) }
                if loader.loading && loader.rows.isEmpty { ProgressView() }
                else {
                    HStack(spacing: 10) { Stat(label: "total spent", value: Money.format(total)); Stat(label: "expenses", value: "\(current.count)") }
                    if previousTotal > 0 {
                        let change = NSDecimalNumber(decimal: (total - previousTotal) / previousTotal * 100).doubleValue
                        Text(String(format: "%+.0f%%", change) + " vs previous \(period.rawValue)").foregroundStyle(.secondary).font(Theme.font(11))
                    } else { Text("Previous \(period.rawValue): \(Money.format(previousTotal))").font(Theme.font(11)).foregroundStyle(.secondary) }
                    if current.isEmpty { EmptyState(title: "no spending this period", detail: "Use the arrows to look through previous periods.") }
                    else {
                        Picker("Chart", selection: $cumulative) { Text("spending").tag(false); Text("cumulative").tag(true) }.pickerStyle(.segmented)
                        SpendingChart(points: Insights.points(current, interval: interval, unit: unit), cumulative: cumulative, unit: unit, height: 190)
                        HStack(spacing: 10) {
                            Stat(label: "per expense", value: Money.format(total / Decimal(current.count)))
                            Stat(label: "largest", value: Money.format(current.map(\.amount).max() ?? 0))
                        }
                        VStack(alignment: .leading, spacing: 16) {
                            SectionLabel("categories")
                            ForEach(Insights.categories(current), id: \.name) { category in
                                VStack(spacing: 8) {
                                    HStack { Text(category.name); Spacer(); Text(Money.format(category.amount)) }.font(Theme.font(12))
                                    GeometryReader { geo in Rectangle().fill(.black).frame(width: geo.size.width * CGFloat(NSDecimalNumber(decimal: category.amount / max(1, total)).doubleValue)) }.frame(height: 3).background(Color.black.opacity(0.07))
                                }
                            }
                        }
                    }
                }
            }
        }.pageTitle("ANALYTICS")
        .refreshable { await store.synchronize() }
        .task(id: "\(store.activeId?.uuidString ?? "")/\(period)/\(anchor)/\(store.revision)") { await loader.load(store, interval: range) }
    }
}
