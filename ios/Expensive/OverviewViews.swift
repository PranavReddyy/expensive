import SwiftUI
import Observation
import Charts

@MainActor @Observable final class ExpenseLoader {
    var rows: [Expense] = []
    var loading = false
    var error: String?
    private var dataKey = ""
    private var request = UUID()
    func load(_ store: AppStore, interval: DateInterval?) async {
        let key = "\(store.user?.id.uuidString ?? "")/\(store.activeId?.uuidString ?? "")/\(interval?.start.timeIntervalSince1970 ?? 0)/\(interval?.end.timeIntervalSince1970 ?? 0)"
        if key != dataKey { rows = store.cachedExpenses(interval: interval) ?? []; dataKey = key }
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
    @State private var accountSettings = false
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
                    Button { sheet = .expense } label: { Text("+ log expense").frame(maxWidth: .infinity) }.buttonStyle(PrimaryActionStyle())
                    if store.profiles.count > 1 { Button("transfer") { sheet = .transfer }.buttonStyle(.glass).accessibilityLabel("Transfer money between profiles") }
                }.font(Theme.font(12)).controlSize(.large)
                Divider()
                VStack(alignment: .leading, spacing: 18) {
                    if loader.loading && loader.rows.isEmpty { ProgressView().frame(maxWidth: .infinity) }
                    else if loader.error == nil || !loader.rows.isEmpty {
                        HomeSpendingSummary(today: monthly.filter { Calendar.current.isDateInToday($0.createdAt) }.reduce(0) { $0 + $1.amount },
                                            month: monthly.reduce(0) { $0 + $1.amount },
                                            points: Insights.points(loader.rows.filter { $0.createdAt <= now }, interval: week))
                    }
                    if let error = loader.error { ErrorNotice(message: error, retry: { Task { await loader.load(store, interval: range) } }) }
                }
            } else if store.loading { ProgressView() }
            else {
                EmptyState(title: "your first account", detail: "Create a profile for your cash, bank account, or any other pool of money.")
                Button("+ create profile") { sheet = .profile }.buttonStyle(PrimaryActionStyle()).controlSize(.large)
            }
        }
        .pageTitle("EXPENS***")
        .toolbar {
            ToolbarItem(placement: .topBarLeading) {
                Button { accountSettings = true } label: { Image(systemName: "person.crop.circle") }
                    .accessibilityLabel("Your account")
            }
            ToolbarItem(placement: .topBarTrailing) { Button { sheet = .profile } label: { Image(systemName: "plus") }.accessibilityLabel("New profile") }
        }
        .sheet(item: $sheet) { type in
            if type == .expense, let profile = store.active { ExpenseForm(profile: profile) }
            else { AccountForm(kind: type, profile: store.active) }
        }
        .sheet(isPresented: $accountSettings) { AccountSettingsView() }
        .refreshable { await store.synchronize() }
        .task(id: "\(store.activeId?.uuidString ?? "")-\(store.revision)-\(range.start)") { await loader.load(store, interval: range) }
    }
}

struct AccountSettingsView: View {
    @AppStorage("appearance") private var appearance = AppAppearance.system.rawValue
    @Environment(AppStore.self) private var store
    @Environment(\.dismiss) private var dismiss
    @State private var confirmLogout = false
    @Bindable private var currency = CurrencyPreference.shared
    var body: some View {
        NavigationStack {
            Form {
                Section("account details") {
                    if let username = store.user?.username { detail("username", "@\(username)") }
                    if let email = store.user?.email { detail("email", email) }
                }
                Section("appearance") {
                    Picker("theme", selection: $appearance) {
                        ForEach(AppAppearance.allCases, id: \.rawValue) { Text($0.rawValue).tag($0.rawValue) }
                    }.pickerStyle(.segmented)
                }
                Section {
                    Picker("preferred currency", selection: $currency.code) {
                        ForEach(CurrencyPreference.choices, id: \.self) { Text($0).tag($0) }
                    }
                } footer: {
                    Text("Display symbol only. Amounts are not converted. Saved for your account on this device.")
                }
                Section { Button("sign out", role: .destructive) { confirmLogout = true } }
                if let error = store.error { Text(error).font(Theme.font(11)) }
            }.font(Theme.font()).scrollContentBackground(.hidden).background(Theme.background)
                .navigationTitle("your account").navigationBarTitleDisplayMode(.inline)
                .toolbar { ToolbarItem(placement: .confirmationAction) { Button("done") { dismiss() } } }
                .confirmationDialog("Sign out of this account?", isPresented: $confirmLogout, titleVisibility: .visible) {
                    Button("sign out", role: .destructive) {
                        Task { do { try await store.logout(); dismiss() } catch { store.handle(error) } }
                    }
                }
        }.presentationDetents([.medium, .large]).presentationDragIndicator(.visible)
    }
    private func detail(_ label: String, _ value: String) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            SectionLabel(label)
            Text(value).font(Theme.font(12)).textSelection(.enabled)
                .fixedSize(horizontal: false, vertical: true).frame(maxWidth: .infinity, alignment: .leading)
        }.padding(.vertical, 4)
    }
}


struct HomeSpendingSummary: View {
    let today: Decimal
    let month: Decimal
    let points: [SpendPoint]
    private var weekTotal: Decimal { points.reduce(0) { $0 + $1.amount } }
    var body: some View {
        VStack(alignment: .leading, spacing: 24) {
            HStack(alignment: .top, spacing: 20) {
                metric("spent today", today)
                metric("this month", month)
            }
            if weekTotal > 0 {
                VStack(alignment: .leading, spacing: 12) {
                    HStack { SectionLabel("last 7 days"); Spacer(); Text(Money.format(weekTotal)).font(Theme.font(11)).monospacedDigit() }
                    Chart(points) { point in
                        BarMark(x: .value("Day", point.date, unit: .day), y: .value("Spent", NSDecimalNumber(decimal: point.amount).doubleValue))
                            .foregroundStyle(Calendar.current.isDateInToday(point.date) ? Theme.ink : Theme.ink.opacity(0.2))
                            .cornerRadius(3)
                            .accessibilityLabel(point.date.formatted(.dateTime.weekday().day().month()))
                            .accessibilityValue(Money.format(point.amount))
                    }.chartXAxis(.hidden).chartYAxis(.hidden).frame(height: 64)
                    HStack {
                        Text(points.first?.date.formatted(.dateTime.day().month(.abbreviated)) ?? "")
                        Spacer(); Text("today")
                    }.font(Theme.font(10)).foregroundStyle(.secondary)
                }
            } else {
                Text("No spending in the last 7 days.").font(Theme.font(11)).foregroundStyle(.secondary)
            }
        }
    }
    private func metric(_ label: String, _ amount: Decimal) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            SectionLabel(label)
            Text(Money.format(amount)).font(Theme.font(20, weight: .medium, relativeTo: .title2))
                .monospacedDigit().lineLimit(1).minimumScaleFactor(0.6)
        }.frame(maxWidth: .infinity, alignment: .leading)
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
    private var summary: Insights.Summary { Insights.summary(loader.rows, interval: interval) }
    private var current: [Expense] { summary.expenses }
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
                else if loader.error == nil || !loader.rows.isEmpty {
                    VStack(alignment: .leading, spacing: 12) {
                    HStack { SectionLabel("total spent"); Spacer(); Text("\(current.count) expenses").font(Theme.font(11)).foregroundStyle(.secondary) }
                    Text(Money.format(total)).font(Theme.font(34, weight: .medium, relativeTo: .largeTitle))
                        .monospacedDigit().lineLimit(1).minimumScaleFactor(0.5)
                    if previousTotal > 0 {
                        let change = NSDecimalNumber(decimal: (total - previousTotal) / previousTotal * 100).doubleValue
                        Text(String(format: "%+.0f%%", change) + " vs previous full \(period.rawValue)").foregroundStyle(.secondary).font(Theme.font(11))
                    } else { Text("Previous \(period.rawValue): \(Money.format(previousTotal))").font(Theme.font(11)).foregroundStyle(.secondary) }
                    if previousTotal > 0 { Text("previously \(Money.format(previousTotal))").font(Theme.font(10)).foregroundStyle(.secondary) }
                    }.padding(20).frame(maxWidth: .infinity, alignment: .leading).overlay(Rectangle().stroke(Theme.ink.opacity(0.15)))
                    if current.isEmpty { EmptyState(title: "no spending this period", detail: "Use the arrows to look through previous periods.") }
                    else {
                        Picker("Chart", selection: $cumulative) { Text("spending").tag(false); Text("cumulative").tag(true) }.pickerStyle(.segmented)
                        SpendingChart(points: Insights.points(current, interval: interval, unit: unit).filter { $0.date <= Date() }, cumulative: cumulative, unit: unit, height: 190, interactive: true)
                            .id("\(store.activeId?.uuidString ?? "")/\(period)/\(anchor)")
                        HStack(spacing: 10) {
                            Stat(label: "per expense", value: Money.format(total / Decimal(current.count)))
                            Stat(label: "daily average", value: Money.format(summary.dailyAverage))
                        }
                        if period != .day {
                            VStack(alignment: .leading, spacing: 12) {
                                HStack {
                                    SectionLabel("\(summary.elapsedDays) of \(summary.totalDays) days")
                                    Spacer()
                                    Text("\(summary.completedNoSpendDays) no-spend days").font(Theme.font(11))
                                }
                                ProgressView(value: Double(summary.elapsedDays), total: Double(summary.totalDays)).tint(Theme.ink)
                                if let estimate = summary.estimate {
                                    HStack { SectionLabel("estimated \(period.rawValue) total"); Spacer(); Text(Money.format(estimate)).font(Theme.font(14, weight: .medium)).monospacedDigit() }
                                    Text("Based on your pace so far. Actual spending may differ.").font(Theme.font(10)).foregroundStyle(.secondary)
                                }
                                Text("Daily average includes today; no-spend days count completed days only.").font(Theme.font(10)).foregroundStyle(.secondary)
                            }.padding(.vertical, 8)
                        }
                        VStack(alignment: .leading, spacing: 16) {
                            SectionLabel("categories")
                            ForEach(Insights.categories(current), id: \.name) { category in
                                let share: Decimal = total > 0 ? category.amount / total : 0
                                VStack(spacing: 8) {
                                    HStack(alignment: .firstTextBaseline) {
                                        Text(category.name); Spacer()
                                        VStack(alignment: .trailing, spacing: 4) {
                                            Text(Money.format(category.amount))
                                            Text(String(format: "%.0f%%", NSDecimalNumber(decimal: share * 100).doubleValue)).font(Theme.font(10)).foregroundStyle(.secondary)
                                        }
                                    }.font(Theme.font(12))
                                    GeometryReader { geo in Rectangle().fill(Theme.ink).frame(width: geo.size.width * CGFloat(NSDecimalNumber(decimal: share).doubleValue)) }.frame(height: 3).background(Theme.ink.opacity(0.07))
                                }
                            }
                        }
                        Divider()
                        VStack(alignment: .leading, spacing: 0) {
                            SectionLabel("largest expenses").padding(.bottom, 4)
                            ForEach(summary.largest) { expense in ExpenseRow(expense: expense) }
                        }
                    }
                }
            }
        }.pageTitle("ANALYTICS")
        .refreshable { await store.synchronize() }
        .task(id: "\(store.activeId?.uuidString ?? "")/\(period)/\(anchor)/\(store.revision)") { await loader.load(store, interval: range) }
    }
}
