import SwiftUI
import Charts

enum Theme {
    static func font(_ size: CGFloat = 13, weight: Font.Weight = .regular, relativeTo style: Font.TextStyle = .body) -> Font {
        .custom(weight == .semibold ? "IBMPlexMono-SmBld" : weight == .medium ? "IBMPlexMono-Medm" : "IBMPlexMono", size: size, relativeTo: style)
    }
}

struct Page<Content: View>: View {
    @ViewBuilder let content: () -> Content
    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 24, content: content)
                .frame(maxWidth: 640, alignment: .leading)
                .padding(.horizontal, 22).padding(.top, 12).padding(.bottom, 32)
                .frame(maxWidth: .infinity)
        }
        .scrollDismissesKeyboard(.interactively)
        .background(Color.white)
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
            .overlay(Rectangle().stroke(Color.black.opacity(0.12), lineWidth: 1))
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

// Let the system handle selection, contrast, and accessibility.
struct ProfileSegments: View {
    let profiles: [Profile]
    let selection: UUID?
    let select: (UUID?) -> Void
    @Environment(\.dynamicTypeSize) private var typeSize
    private var selectedProfile: Binding<UUID?> {
        Binding(get: { selection }, set: { if $0 != selection { select($0) } })
    }

    var body: some View {
        ViewThatFits(in: .horizontal) {
            if !typeSize.isAccessibilitySize {
                Picker("Accounts", selection: selectedProfile) { profileOptions }
                    .pickerStyle(.segmented)
                    .fixedSize(horizontal: true, vertical: false)
                    .frame(maxWidth: .infinity)
            }
            // Keep names readable when many accounts or large text won't fit in segments.
            Menu {
                Picker("Accounts", selection: selectedProfile) { profileOptions }
            } label: {
                HStack(spacing: 12) {
                    Text(profiles.first { $0.id == selection }?.name ?? "Choose account")
                        .multilineTextAlignment(.leading)
                    Spacer(minLength: 8)
                    Image(systemName: "chevron.up.chevron.down").font(.caption)
                }
                .font(Theme.font(13, weight: .medium))
                .foregroundStyle(.black)
                .padding(.horizontal, 14).padding(.vertical, 12)
                .frame(maxWidth: .infinity, minHeight: 44)
                .background(Color.black.opacity(0.05), in: RoundedRectangle(cornerRadius: 10))
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Accounts")
            .accessibilityValue(profiles.first { $0.id == selection }?.name ?? "Choose account")
        }
        .tint(.black)
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
                Text("owed to you \(Money.format(store.collect)) · you owe \(Money.format(store.pay))")
                Text("after settlement \(Money.format((store.active?.balance ?? 0) + store.collect - store.pay))")
            }.font(Theme.font(10, relativeTo: .caption)).foregroundStyle(.secondary)
        }.padding(20).frame(maxWidth: .infinity, alignment: .leading)
            .overlay(Rectangle().stroke(Color.black, lineWidth: 1))
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
            }
        }
    }
}

struct SpendingChart: View {
    let points: [SpendPoint]
    var cumulative = false
    var unit: Calendar.Component = .day
    var height: CGFloat = 160
    private var plotted: [SpendPoint] {
        guard cumulative else { return points }
        var total: Decimal = 0
        return points.map { total += $0.amount; return SpendPoint(date: $0.date, amount: total) }
    }
    var body: some View {
        Chart(plotted) { point in
            if cumulative {
                LineMark(x: .value("Date", point.date), y: .value("Spent", NSDecimalNumber(decimal: point.amount).doubleValue))
                    .foregroundStyle(Color.black).interpolationMethod(.linear)
            } else {
                BarMark(x: .value("Date", point.date, unit: unit), y: .value("Spent", NSDecimalNumber(decimal: point.amount).doubleValue))
                    .foregroundStyle(Color.black.opacity(0.8))
            }
        }
        .chartXAxis { AxisMarks(values: .automatic(desiredCount: 5)) }
        .chartYAxis { AxisMarks(position: .leading, values: .automatic(desiredCount: 3)) }
        .frame(height: height)
        .accessibilityLabel("Spending chart")
    }
}

struct ErrorNotice: View {
    let message: String
    var retry: (() -> Void)? = nil
    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(message).font(Theme.font(12)).foregroundStyle(.secondary)
            if let retry { Button("retry", action: retry).buttonStyle(.glass) }
        }.padding(14).frame(maxWidth: .infinity, alignment: .leading).background(Color.black.opacity(0.04))
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
    let save: () -> Void
    @ViewBuilder let content: () -> Content
    var body: some View {
        NavigationStack {
            Form {
                content()
                if let error { Section { Text(error).foregroundStyle(.red).font(Theme.font(12)) } }
            }
            .font(Theme.font()).scrollContentBackground(.hidden).background(Color.white)
            .navigationTitle(title).navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("cancel") { dismiss() }.disabled(busy) }
                ToolbarItem(placement: .confirmationAction) {
                    Button(action: save) { if busy { ProgressView() } else { Text(actionTitle) } }.disabled(busy)
                }
            }
            .disabled(busy)
        }
        .interactiveDismissDisabled(busy).presentationDragIndicator(.visible)
        .presentationDetents([.large])
    }
}
