import SwiftUI
import Charts

enum Theme {
    static let background = Color(uiColor: .systemBackground)
    static let ink = Color(uiColor: .label)
    static let onInk = Color(uiColor: .systemBackground)
    static func font(_ size: CGFloat = 13, weight: Font.Weight = .regular, relativeTo style: Font.TextStyle = .body) -> Font {
        .custom(weight == .semibold ? "IBMPlexMono-SmBld" : weight == .medium ? "IBMPlexMono-Medm" : "IBMPlexMono", size: size, relativeTo: style)
    }
}

enum AppAppearance: String, CaseIterable {
    case system, light, dark
    var colorScheme: ColorScheme? {
        switch self { case .system: nil; case .light: .light; case .dark: .dark }
    }
}

struct PrimaryActionStyle: ButtonStyle {
    var compact = false
    @Environment(\.isEnabled) private var enabled
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .foregroundStyle(.white)
            .padding(.horizontal, compact ? 12 : 18).padding(.vertical, compact ? 8 : 12)
            .glassEffect(.regular.tint(.black).interactive(), in: Capsule())
            .opacity(enabled ? (configuration.isPressed ? 0.75 : 1) : 0.45)
    }
}

struct CategoryChips: View {
    let categories: [Category]
    @Binding var selection: UUID?
    var body: some View {
        ScrollView(.horizontal) {
            HStack(spacing: 6) {
                ForEach(categories) { category in
                    Button { selection = selection == category.id ? nil : category.id } label: {
                        Text(category.name).font(Theme.font(11)).fixedSize()
                            .padding(.horizontal, 12).padding(.vertical, 8)
                            .foregroundStyle(selection == category.id ? Theme.onInk : Theme.ink)
                            .background(selection == category.id ? Theme.ink : Theme.ink.opacity(0.06), in: Capsule())
                            .frame(minHeight: 44)
                    }.buttonStyle(.plain).accessibilityAddTraits(selection == category.id ? .isSelected : [])
                }
            }
        }.scrollIndicators(.hidden).accessibilityLabel("Categories; tap selected category to clear")
    }
}

struct Page<Content: View>: View {
    @Environment(AppStore.self) private var store
    @ViewBuilder let content: () -> Content
    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 24) {
                if !store.validating && (!store.pendingExpenses.isEmpty || !store.online) {
                    PageSyncStatus()
                }
                content()
            }
                .frame(maxWidth: 640, alignment: .leading)
                .padding(.horizontal, 22).padding(.top, 12).padding(.bottom, 32)
                .frame(maxWidth: .infinity)
        }
        .scrollDismissesKeyboard(.interactively)
        .background(Theme.background)
    }
}

// A small inline status, never an overlay over navigation or saved content.
struct LoadingState: View {
    var title = "loading"
    var body: some View {
        HStack(spacing: 9) {
            ProgressView().controlSize(.small).tint(Theme.ink)
            Text(title).font(Theme.font(11)).foregroundStyle(.secondary)
        }.frame(maxWidth: .infinity, minHeight: 32, alignment: .leading)
            .accessibilityElement(children: .ignore).accessibilityLabel(title)
    }
}

// Exceptional states belong to page content, not an inset around TabView's
// navigation chrome. Startup verification and normal refreshes stay silent.
struct PageSyncStatus: View {
    @Environment(AppStore.self) private var store
    var body: some View {
        if !store.pendingExpenses.isEmpty {
            VStack(alignment: .leading, spacing: 6) {
                Text("\(store.pendingExpenses.count) pending · \(Money.format(store.pendingExpenses.reduce(0) { $0 + $1.amount })) not confirmed")
                    .fixedSize(horizontal: false, vertical: true)
                Button(store.syncingExpenses ? "syncing…" : "retry sync") {
                    Task { await store.flushExpenses(retry: true) }
                }.disabled(store.syncingExpenses)
            }.font(Theme.font(11)).foregroundStyle(.secondary)
        } else if !store.online {
            Text("offline · showing saved data").font(Theme.font(11)).foregroundStyle(.secondary)
        }
    }
}

struct SectionLabel: View {
    let text: String
    init(_ text: String) { self.text = text }
    var body: some View { Text(text).font(Theme.font(11, weight: .medium, relativeTo: .caption)).foregroundStyle(.secondary).textCase(.lowercase) }
}

struct Stat: View {
    let label: String
    let value: String
    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            SectionLabel(label)
            Text(value).font(Theme.font(21, weight: .medium, relativeTo: .title2)).monospacedDigit().minimumScaleFactor(0.65)
        }.frame(maxWidth: .infinity, alignment: .leading).padding(16)
            .overlay(Rectangle().stroke(Theme.ink.opacity(0.12), lineWidth: 1))
    }
}

struct ProfilePicker: View {
    @Environment(AppStore.self) private var store
    var body: some View {
        if !store.profiles.isEmpty {
            ProfileSegments(profiles: store.profiles, selection: store.activeId, select: store.select)
        }
    }
}

// A readable account rail: names never compress into tiny system segments.
struct ProfileSegments: View {
    let profiles: [Profile]
    let selection: UUID?
    let select: (UUID?) -> Void
    @Environment(\.dynamicTypeSize) private var typeSize
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Namespace private var highlight
    private var selectedProfile: Binding<UUID?> {
        Binding(get: { selection }, set: { if $0 != selection { select($0) } })
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                SectionLabel("account")
                Spacer()
                Text("\((profiles.firstIndex { $0.id == selection } ?? 0) + 1) / \(profiles.count)")
                    .font(Theme.font(10)).foregroundStyle(.secondary).monospacedDigit()
                    .accessibilityHidden(true)
            }
            if !typeSize.isAccessibilitySize {
                ScrollViewReader { proxy in
                    ScrollView(.horizontal) {
                        HStack(spacing: 4) {
                            ForEach(profiles) { profile in
                                Button {
                                    guard selection != profile.id else { return }
                                    select(profile.id)
                                } label: {
                                    HStack(spacing: 7) {
                                        Text(profile.name).font(Theme.font(12, weight: .medium)).fixedSize()
                                    }
                                    .padding(.horizontal, 15).frame(minHeight: 44)
                                    .foregroundStyle(selection == profile.id ? Theme.onInk : Theme.ink)
                                    .background {
                                        if selection == profile.id {
                                            Capsule().fill(Theme.ink).matchedGeometryEffect(id: "selected-account", in: highlight)
                                        }
                                    }
                                    .contentShape(Capsule())
                                }.buttonStyle(.plain).id(profile.id)
                                    .accessibilityLabel(profile.name)
                                    .accessibilityAddTraits(selection == profile.id ? .isSelected : [])
                            }
                        }.padding(4)
                    }.scrollIndicators(.hidden)
                        .background(Theme.ink.opacity(0.045), in: Capsule())
                        .animation(reduceMotion ? nil : .smooth(duration: 0.24), value: selection)
                        .onChange(of: selection) {
                            guard let selection else { return }
                            withAnimation(reduceMotion ? nil : .smooth(duration: 0.24)) { proxy.scrollTo(selection, anchor: .center) }
                        }
                        .onAppear { if let selection { proxy.scrollTo(selection, anchor: .center) } }
                }
            } else { Menu {
                Picker("Accounts", selection: selectedProfile) { profileOptions }
            } label: {
                HStack(spacing: 12) {
                    Text(profiles.first { $0.id == selection }?.name ?? "Choose account")
                        .multilineTextAlignment(.leading)
                    Spacer(minLength: 8)
                    Image(systemName: "chevron.up.chevron.down").font(.caption)
                }
                .font(Theme.font(13, weight: .medium))
                .foregroundStyle(Theme.ink)
                .padding(.horizontal, 14).padding(.vertical, 12)
                .frame(maxWidth: .infinity, minHeight: 44)
                .background(Theme.ink.opacity(0.05), in: RoundedRectangle(cornerRadius: 10))
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Accounts")
            .accessibilityValue(profiles.first { $0.id == selection }?.name ?? "Choose account")
            }
        }
        .tint(Theme.ink)
        .accessibilityIdentifier("profile-switcher")
    }

    private var profileOptions: some View {
        ForEach(profiles) { profile in
            Text(profile.name).tag(Optional(profile.id))
        }
    }
}

struct BalanceBlock: View {
    @Environment(AppStore.self) private var store
    var edit: (() -> Void)? = nil
    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                SectionLabel("current balance")
                Spacer()
                if let edit { Button("edit", action: edit).buttonStyle(.glass).font(Theme.font(11)).accessibilityLabel("Edit current balance") }
            }
            Text(Money.format(store.active?.balance ?? 0))
                .font(Theme.font(38, weight: .medium, relativeTo: .largeTitle)).minimumScaleFactor(0.5).lineLimit(1).monospacedDigit()
            VStack(alignment: .leading, spacing: 5) {
                ViewThatFits(in: .horizontal) {
                    HStack(spacing: 12) { Text("owed to you \(Money.format(store.collect))"); Text("you owe \(Money.format(store.pay))") }
                    VStack(alignment: .leading, spacing: 5) { Text("owed to you \(Money.format(store.collect))"); Text("you owe \(Money.format(store.pay))") }
                }
                Text("after settlement \(Money.format((store.active?.balance ?? 0) + store.collect - store.pay))")
            }.font(Theme.font(10, relativeTo: .caption)).foregroundStyle(.secondary)
                .redacted(reason: store.ledgerReady ? [] : .placeholder)
                .accessibilityHidden(!store.ledgerReady)
        }.padding(20).frame(maxWidth: .infinity, alignment: .leading)
            .overlay(Rectangle().stroke(Theme.ink, lineWidth: 1))
    }
}

struct PeriodPicker: View {
    @Binding var period: Period
    @Binding var anchor: Date
    var allowAll = true
    var body: some View {
        VStack(spacing: 14) {
            Picker("Period", selection: $period) {
                ForEach(Period.allCases.filter { allowAll || $0 != .all }) { Text($0.rawValue).tag($0) }
            }.pickerStyle(.segmented).onChange(of: period) { anchor = Date() }
            if period != .all {
                HStack {
                    Button { anchor = period.shifted(anchor, by: -1) } label: { Image(systemName: "chevron.left").frame(width: 32, height: 32) }
                        .buttonStyle(.glass).accessibilityLabel("Previous \(period.rawValue)")
                    Spacer(minLength: 4)
                    Text(period.label(anchor)).font(Theme.font(12)).multilineTextAlignment(.center)
                    Spacer(minLength: 4)
                    Button { anchor = period.shifted(anchor, by: 1) } label: { Image(systemName: "chevron.right").frame(width: 32, height: 32) }
                        .buttonStyle(.glass).disabled(period.contains(Date(), anchor: anchor))
                        .accessibilityLabel("Next \(period.rawValue)")
                }
                if !period.contains(Date(), anchor: anchor) {
                    Button("back to this \(period.rawValue)") { anchor = Date() }
                        .font(Theme.font(11)).buttonStyle(.plain).frame(minHeight: 32)
                }
            }
        }
    }
}

struct SpendingChart: View {
    @Environment(\.dynamicTypeSize) private var typeSize
    let points: [SpendPoint]
    var cumulative = false
    var unit: Calendar.Component = .day
    var height: CGFloat = 160
    var interactive = false
    @State private var selectedDate: Date?
    private var selectedPoint: SpendPoint? {
        guard let selectedDate else { return nil }
        return plotted.first {
            guard let bucket = Calendar.current.dateInterval(of: unit, for: $0.date) else { return false }
            return selectedDate >= bucket.start && selectedDate < bucket.end
        }
    }
    private var plotted: [SpendPoint] {
        guard cumulative else { return points }
        var total: Decimal = 0
        return points.map { total += $0.amount; return SpendPoint(date: $0.date, amount: total) }
    }
    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
        if interactive {
            HStack {
                Text(selectedPoint.map { unit == .hour ? $0.date.formatted(.dateTime.hour().minute()) : unit == .month ? $0.date.formatted(.dateTime.month(.abbreviated).year()) : $0.date.formatted(.dateTime.day().month(.abbreviated)) } ?? "touch chart to explore")
                    .foregroundStyle(.secondary)
                Spacer()
                Text(selectedPoint.map { Money.format($0.amount) } ?? " ").monospacedDigit()
            }.font(Theme.font(11)).accessibilityElement(children: .combine)
        }
        Chart {
        ForEach(plotted) { point in
            if cumulative {
                LineMark(x: .value("Date", point.date), y: .value("Spent", NSDecimalNumber(decimal: point.amount).doubleValue))
                    .foregroundStyle(Theme.ink).interpolationMethod(.linear)
            } else {
                BarMark(x: .value("Date", point.date, unit: unit), y: .value("Spent", NSDecimalNumber(decimal: point.amount).doubleValue))
                    .foregroundStyle(Theme.ink.opacity(0.8))
            }
        }
        if interactive, let selectedPoint {
            RuleMark(x: .value("Selected date", selectedPoint.date))
                .foregroundStyle(Theme.ink.opacity(0.25)).lineStyle(StrokeStyle(lineWidth: 1, dash: [3]))
        }
        }
        .chartXSelection(value: interactive ? $selectedDate : .constant(nil))
        .chartXAxis { AxisMarks(values: .automatic(desiredCount: typeSize.isAccessibilitySize ? 2 : 5)) }
        .chartYAxis { AxisMarks(position: .leading, values: .automatic(desiredCount: 3)) }
        .frame(height: height)
        .accessibilityLabel("Spending chart")
        }.onChange(of: cumulative) { selectedDate = nil }
            .onChange(of: points.first?.date) { selectedDate = nil }
    }
}

struct ErrorNotice: View {
    let message: String
    var retry: (() -> Void)? = nil
    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(message).font(Theme.font(12)).foregroundStyle(.secondary)
            if let retry { Button("retry", action: retry).buttonStyle(.glass) }
        }.padding(14).frame(maxWidth: .infinity, alignment: .leading).background(Theme.ink.opacity(0.04))
            .accessibilityElement(children: .combine)
    }
}

struct EmptyState: View {
    let title: String
    let detail: String
    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text(title).font(Theme.font(16, weight: .medium))
            Text(detail).font(Theme.font(12)).foregroundStyle(.secondary)
        }.frame(maxWidth: .infinity, alignment: .leading).padding(.vertical, 28)
    }
}

struct SheetFrame<Content: View>: View {
    @Environment(\.dismiss) private var dismiss
    let title: String
    let busy: Bool
    let error: String?
    var actionTitle = "save"
    var prominentAction = true
    var nextInput: (() -> Void)? = nil
    var dismissInput: (() -> Void)? = nil
    var inputFocused = false
    var openTabs: (() -> Void)? = nil
    var openSplit: (() -> Void)? = nil
    let save: () -> Void
    @ViewBuilder let content: () -> Content
    var body: some View {
        NavigationStack {
            Form {
                content()
                if let error { Section { Text(error).foregroundStyle(.red).font(Theme.font(12)) } }
            }
            .font(Theme.font()).scrollContentBackground(.hidden).background(Theme.background)
            .navigationTitle(title).navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("cancel") { dismiss() }.disabled(busy) }
                ToolbarItem(placement: .confirmationAction) {
                    if prominentAction {
                        Button(action: save) {
                            Text(actionTitle).font(Theme.font(13, weight: .medium))
                                .foregroundStyle(.white).lineLimit(1).fixedSize(horizontal: true, vertical: false)
                                .opacity(busy ? 0 : 1)
                                .overlay { if busy { ProgressView().tint(.white) } }
                        }.buttonStyle(PrimaryActionStyle(compact: true))
                            .fixedSize(horizontal: true, vertical: false)
                            .tint(Theme.ink).disabled(busy)
                    } else {
                        Button(action: save) { if busy { ProgressView() } else { Text(actionTitle) } }.disabled(busy)
                    }
                }.sharedBackgroundVisibility(.hidden)
            }
            .disabled(busy)
        }
        .safeAreaInset(edge: .bottom, alignment: .trailing, spacing: 0) {
            if inputFocused, let dismissInput {
                HStack(alignment: .center, spacing: 8) {
                    if openTabs != nil || openSplit != nil {
                        HStack(spacing: 0) {
                            if let openTabs {
                                Button("tabs", action: openTabs).padding(.horizontal, 14).frame(minHeight: 44)
                                    .accessibilityLabel("Add an amount to Tabs")
                            }
                            if let openSplit {
                                Button("split", action: openSplit).padding(.horizontal, 14).frame(minHeight: 44)
                                    .accessibilityLabel("Split this payment")
                            }
                        }.glassEffect(.regular.interactive(), in: Capsule())
                    }
                    Spacer(minLength: 0)
                    HStack(spacing: 0) {
                        if let nextInput {
                            Button("next", action: nextInput).padding(.horizontal, 14).frame(minHeight: 44)
                        }
                        Button("done", action: dismissInput).padding(.horizontal, 14).frame(minHeight: 44)
                    }.glassEffect(.regular.interactive(), in: Capsule())
                }
                .font(Theme.font(13, weight: .medium))
                .buttonStyle(.plain).foregroundStyle(Theme.ink)
                .disabled(busy)
                .padding(.horizontal, 16).padding(.bottom, 12).padding(.top, 8)
                .frame(maxWidth: .infinity)

            }
        }
        .interactiveDismissDisabled(busy).presentationDragIndicator(.visible)
        .presentationDetents([.large])
    }
}
