import SwiftUI
import Observation
@preconcurrency import WatchConnectivity

@MainActor @Observable final class WatchStore: NSObject, WCSessionDelegate {
    var snapshot: WatchSnapshot?
    var draft: WatchRequest?
    var busy = false
    var message = ""
    var selectedProfile: UUID?
    var profiles: [WatchSnapshot.Profile] {
        guard let snapshot, snapshot.owner != nil else { return [] }
        return snapshot.profiles ?? snapshot.profile.map { [.init(id: $0, name: snapshot.name, balance: snapshot.balance)] } ?? []
    }
    var currentProfile: WatchSnapshot.Profile? { profiles.first { $0.id == selectedProfile } ?? profiles.first { $0.id == snapshot?.profile } }
    private static func file(_ name: String) throws -> URL {
        var folder = try FileManager.default.url(for: .applicationSupportDirectory, in: .userDomainMask, appropriateFor: nil, create: true)
        var values = URLResourceValues(); values.isExcludedFromBackup = true; try folder.setResourceValues(values)
        return folder.appending(path: name + ".json")
    }
    override init() {
        super.init()
        if let file = try? Self.file("snapshot"), let data = try? Data(contentsOf: file), let saved = try? JSONDecoder().decode(WatchSnapshot.self, from: data), Date().timeIntervalSince(saved.updated) < 86400 { snapshot = saved }
        if let file = try? Self.file("draft"), let data = try? Data(contentsOf: file) { draft = try? JSONDecoder().decode(WatchRequest.self, from: data) }
        WCSession.default.delegate = self; WCSession.default.activate()
    }
    private func install(_ snapshot: WatchSnapshot) {
        if let current = self.snapshot, current.updated > snapshot.updated { return }
        if self.snapshot?.owner != snapshot.owner { selectedProfile = nil }
        self.snapshot = snapshot
        if !profiles.contains(where: { $0.id == selectedProfile }) { selectedProfile = snapshot.profile }
        if let file = try? Self.file("snapshot"), let data = try? JSONEncoder().encode(snapshot) { try? data.write(to: file, options: [.atomic, .completeFileProtection]) }
    }
    func refresh() {
        guard !busy else { return }
        send(WatchRequest(action: "refresh", id: UUID(), owner: snapshot?.owner, profile: currentProfile?.id, reason: "", amount: "", date: Date()))
    }
    func select(_ id: UUID) {
        guard !busy, currentProfile?.id != id, profiles.contains(where: { $0.id == id }) else { return }
        selectedProfile = id
        refresh()
    }
    func log(amount: String, reason: String, category: UUID?) {
        guard !busy, draft == nil, let snapshot, let owner = snapshot.owner, let profile = currentProfile?.id else { return }
        guard let value = try? AmountCalculation.parse(amount), value > 0,
              !reason.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty, reason.count <= 200 else { message = "Enter an amount and a short reason (up to 200 characters)."; return }
        let request = WatchRequest(action: "expense", id: UUID(), owner: owner, profile: profile, reason: reason, amount: NSDecimalNumber(decimal: value).stringValue, date: Date(), category: category)
        do {
            try JSONEncoder().encode(request).write(to: Self.file("draft"), options: [.atomic, .completeFileProtection])
            draft = request; send(request)
        } catch { message = "Could not save your draft. Please retry." }
    }
    func retry() { if let draft, !busy { send(draft) } }
    func discardDraft() {
        guard !busy, draft != nil else { return }
        do { try FileManager.default.removeItem(at: Self.file("draft")); draft = nil; message = "Draft discarded. Check iPhone for any expense already saved." }
        catch { message = "Could not discard the draft. Retry." }
    }
    private func send(_ request: WatchRequest) {
        guard WCSession.default.activationState == .activated, WCSession.default.isReachable else {
            message = request.action == "expense" ? "Draft saved. Open the iPhone app, then tap retry." : "Open Expens*** on your iPhone to connect."; return
        }
        guard let data = try? JSONEncoder().encode(request) else { return }
        busy = true; message = ""
        // WatchConnectivity invokes these on a background queue. Explicitly
        // Sendable callbacks must hop to MainActor before touching view state.
        WCSession.default.sendMessageData(data, replyHandler: { @Sendable [weak self] data in
            Task { @MainActor in
                guard let self else { return }; self.busy = false
                do {
                    let reply = try JSONDecoder().decode(WatchReply.self, from: data)
                    if let snapshot = reply.snapshot { self.install(snapshot) }
                    self.message = reply.message
                    if reply.accepted && request.action == "expense" {
                        // Delete only after the phone confirms durable receipt.
                        try FileManager.default.removeItem(at: Self.file("draft")); self.draft = nil
                    }
                } catch { self.message = "Could not confirm. Your draft is kept for retry." }
            }
        }, errorHandler: { @Sendable [weak self] _ in
            Task { @MainActor in self?.busy = false; self?.message = "iPhone unavailable. Open the app there, then retry." }
        })
    }
    nonisolated func session(_ session: WCSession, activationDidCompleteWith activationState: WCSessionActivationState, error: Error?) {
        let data = session.receivedApplicationContext["snapshot"] as? Data
        Task { @MainActor in
            if let data, let snapshot = try? JSONDecoder().decode(WatchSnapshot.self, from: data) { self.install(snapshot) }
            self.refresh()
        }
    }
    nonisolated func session(_ session: WCSession, didReceiveApplicationContext applicationContext: [String: Any]) {
        guard let data = applicationContext["snapshot"] as? Data else { return }
        Task { @MainActor in if let snapshot = try? JSONDecoder().decode(WatchSnapshot.self, from: data) { self.install(snapshot) } }
    }
}

@main struct ExpensiveWatchApp: App {
    @State private var store = WatchStore()
    @Environment(\.scenePhase) private var phase
    var body: some Scene {
        WindowGroup {
            NavigationStack { WatchHome().environment(store) }
                .tint(.gray).preferredColorScheme(.dark)
                .onChange(of: phase) { if phase == .active { store.refresh() } }
        }
    }
}

struct WatchHome: View {
    @Environment(WatchStore.self) private var store
    @State private var logging = false
    @State private var discarding = false
    private func money(_ amount: Decimal) -> String { (store.snapshot?.currency ?? "") + NSDecimalNumber(decimal: amount).stringValue }
    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 10) {
                if let snapshot = store.snapshot, snapshot.owner != nil {
                    WatchProfileStrip()
                    VStack(alignment: .leading, spacing: 5) {
                        Text("balance").font(.caption2).foregroundStyle(.secondary)
                        Text(money(store.currentProfile?.balance ?? snapshot.balance)).font(.system(.title2, design: .monospaced).weight(.semibold)).minimumScaleFactor(0.6).lineLimit(1)
                        Text("Updated \(snapshot.updated, style: .relative) ago").font(.system(size: 10)).foregroundStyle(.secondary)
                    }.frame(maxWidth: .infinity, alignment: .leading).padding(12)
                        .background(.white.opacity(0.07), in: RoundedRectangle(cornerRadius: 14))
                    Button("+ log expense") { logging = true }.buttonStyle(.borderedProminent).tint(.white).foregroundStyle(.black).disabled(store.draft != nil)
                    if let draft = store.draft {
                        Text(draft.owner == snapshot.owner ? "Pending · \(draft.reason)" : "A draft belongs to your previous account. Sign back in on iPhone to retry it.").font(.caption)
                        Button("retry pending expense") { store.retry() }.disabled(store.busy || draft.owner != snapshot.owner)
                        Button("discard draft", role: .destructive) { discarding = true }.disabled(store.busy)
                    }
                    if snapshot.profile == store.currentProfile?.id {
                    Text("recent").font(.caption2).foregroundStyle(.secondary)
                    ForEach(snapshot.recent) { row in
                        HStack { Text(row.reason).lineLimit(1); Spacer(); Text(money(row.amount)).lineLimit(1) }.font(.caption)
                    }
                    if snapshot.recent.isEmpty { Text("No expenses yet.").font(.caption).foregroundStyle(.secondary) }
                    } else { Text("Refresh to see this profile’s expenses.").font(.caption2).foregroundStyle(.secondary) }
                } else { Text("Open Expens*** on your iPhone and choose a profile.").font(.caption) }
                if !store.message.isEmpty { Text(store.message).font(.caption2).foregroundStyle(.secondary) }
                Button { store.refresh() } label: {
                    Label(store.busy ? "syncing…" : "refresh", systemImage: "arrow.clockwise").font(.caption2)
                }.buttonStyle(.plain).foregroundStyle(.secondary).frame(maxWidth: .infinity).padding(.vertical, 8).disabled(store.busy)
            }.frame(maxWidth: .infinity, alignment: .leading).padding(.horizontal, 4).padding(.bottom, 8)
        }.navigationTitle("")
            .sheet(isPresented: $logging) {
                NavigationStack { WatchExpenseForm().environment(store) }
                    .tint(.gray).preferredColorScheme(.dark)
            }
            .confirmationDialog("Check iPhone first. Discard stops retrying; it does not delete an expense already saved.", isPresented: $discarding, titleVisibility: .visible) {
                Button("discard draft", role: .destructive) { store.discardDraft() }
            }
    }
}

struct WatchExpenseForm: View {
    @Environment(WatchStore.self) private var store
    @Environment(\.dismiss) private var dismiss
    @State private var amount = ""
    @State private var reason = ""
    @State private var category: UUID?
    @State private var enteringAmount = false
    private var canSave: Bool {
        !store.busy && store.draft == nil &&
        ((try? AmountCalculation.parse(amount)) ?? 0) > 0 &&
        !reason.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }
    var body: some View {
        ScrollView {
          VStack(alignment: .leading, spacing: 12) {
            WatchProfileStrip()
            VStack(alignment: .leading, spacing: 0) {
                Button { enteringAmount = true } label: {
                    VStack(alignment: .leading, spacing: 4) {
                        Text("amount").font(.caption2).foregroundStyle(.secondary)
                        Text((store.snapshot?.currency ?? "") + (amount.isEmpty ? "0" : amount))
                            .font(.system(size: 26, weight: .medium, design: .monospaced))
                            .lineLimit(1).minimumScaleFactor(0.5).foregroundStyle(.white)
                    }.frame(maxWidth: .infinity, alignment: .leading).padding(12)
                        .contentShape(Rectangle())
                }.buttonStyle(.plain)
                    .accessibilityLabel("Amount").accessibilityValue(amount.isEmpty ? "Not entered" : amount)
                Divider().overlay(.white.opacity(0.08)).padding(.horizontal, 12)
                TextField("what was it for?", text: $reason)
                    .font(.system(size: 14)).textFieldStyle(.plain)
                    .padding(12).accessibilityLabel("Reason")
            }.background(.white.opacity(0.07), in: RoundedRectangle(cornerRadius: 14))
            if let categories = store.snapshot?.categories, !categories.isEmpty {
                VStack(alignment: .leading, spacing: 6) {
                    Text("category · optional").font(.caption2).foregroundStyle(.secondary)
                    ScrollView(.horizontal) {
                        HStack(spacing: 6) {
                            ForEach(categories) { item in
                                Button { category = category == item.id ? nil : item.id } label: {
                                    WatchChip(title: item.name, selected: category == item.id)
                                }.buttonStyle(.plain).accessibilityAddTraits(category == item.id ? .isSelected : [])
                            }
                        }
                    }.scrollIndicators(.hidden)
                }
            }
            Button { store.log(amount: amount, reason: reason, category: category); if store.draft != nil { dismiss() } } label: {
                Text("save").font(.system(size: 15, weight: .semibold, design: .monospaced))
                    .frame(maxWidth: .infinity, minHeight: 44)
                    .foregroundStyle(canSave ? .black : .white.opacity(0.45))
                    .background(canSave ? Color.white : Color.white.opacity(0.1), in: Capsule())
            }.buttonStyle(.plain).disabled(!canSave)
            if !store.message.isEmpty { Text(store.message).font(.caption2).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true) }
          }.padding(.horizontal, 4).padding(.bottom, 8)
        }.navigationTitle("")
            .sheet(isPresented: $enteringAmount) {
                NavigationStack { WatchAmountPad(amount: $amount) }
                    .tint(.gray).preferredColorScheme(.dark)
            }
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button { dismiss() } label: {
                        Image(systemName: "chevron.left").foregroundStyle(.white)
                    }.buttonStyle(.glass).buttonBorderShape(.circle).tint(.gray).accessibilityLabel("Back")
                }
            }
            .onChange(of: store.snapshot?.owner) { dismiss() }
            .onChange(of: store.snapshot?.categories?.map(\.id)) {
                if !(store.snapshot?.categories ?? []).contains(where: { $0.id == category }) { category = nil }
            }
    }
}

struct WatchAmountPad: View {
    @Binding var amount: String
    @Environment(\.dismiss) private var dismiss
    private let keys = ["1", "2", "3", "4", "5", "6", "7", "8", "9", ".", "0", "delete"]
    var body: some View {
        ScrollView {
            VStack(spacing: 6) {
                Text(amount.isEmpty ? "0" : amount)
                    .font(.system(size: 25, weight: .medium, design: .monospaced))
                    .lineLimit(1).minimumScaleFactor(0.5)
                    .frame(maxWidth: .infinity, minHeight: 30, alignment: .trailing)
                    .accessibilityLabel("Amount \(amount.isEmpty ? "0" : amount)")
                LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 6), count: 3), spacing: 6) {
                    ForEach(keys, id: \.self) { key in
                        Button { amount = WatchAmountInput.applying(key, to: amount) } label: {
                            Group {
                                if key == "delete" { Image(systemName: "delete.left") }
                                else { Text(key) }
                            }.font(.system(size: 20, weight: .medium, design: .monospaced))
                                .frame(maxWidth: .infinity, minHeight: 38)
                                .foregroundStyle(.white)
                                .background(.white.opacity(0.12), in: RoundedRectangle(cornerRadius: 10))
                        }.buttonStyle(.plain)
                            .accessibilityLabel(key == "delete" ? "Delete last digit" : key == "." ? "Decimal point" : key)
                    }
                }
                HStack(spacing: 5) {
                    ForEach(["=", "+", "-", "×", "÷"], id: \.self) { key in
                        Button(key) { amount = WatchAmountInput.applying(key, to: amount) }
                            .buttonStyle(.plain).font(.system(size: 18, design: .monospaced))
                            .frame(maxWidth: .infinity, minHeight: 34)
                            .background(.white.opacity(0.08), in: Capsule())
                            .disabled(key != "=" && !amount.hasPrefix("="))
                    }
                }
                if amount.hasPrefix("=") {
                    Text((try? AmountCalculation.parse(amount)).map { "= " + NSDecimalNumber(decimal: $0).stringValue } ?? "finish calculation")
                        .font(.caption2).foregroundStyle(.secondary)
                }
            }.padding(.horizontal, 4)
        }.toolbar {
            ToolbarItem(placement: .confirmationAction) {
                Button("done") { dismiss() }.buttonStyle(.glass).tint(.gray).foregroundStyle(.white)
            }
        }
    }
}

struct WatchChip: View {
    let title: String
    let selected: Bool
    var body: some View {
        Text(title).font(.system(size: 12, weight: .medium, design: .monospaced))
            .lineLimit(1).padding(.horizontal, 12).frame(minHeight: 36)
            .foregroundStyle(selected ? .black : .white)
            .background(selected ? Color.white : Color.white.opacity(0.1), in: Capsule())
    }
}

struct WatchProfileStrip: View {
    @Environment(WatchStore.self) private var store
    var body: some View {
        ScrollView(.horizontal) {
            HStack(spacing: 6) {
                ForEach(store.profiles) { profile in
                    Button { store.select(profile.id) } label: {
                        WatchChip(title: profile.name, selected: store.currentProfile?.id == profile.id)
                    }.buttonStyle(.plain).disabled(store.busy)
                        .accessibilityAddTraits(store.currentProfile?.id == profile.id ? .isSelected : [])
                }
            }
        }.scrollIndicators(.hidden)
    }
}
