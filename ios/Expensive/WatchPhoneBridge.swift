import Foundation
@preconcurrency import WatchConnectivity

@MainActor final class WatchPhoneBridge: NSObject, WCSessionDelegate {
    static let shared = WatchPhoneBridge()
    private weak var store: AppStore?
    private var publishing = false
    private var publishAgain = false
    private var watchOwner: UUID?
    private var watchProfile: UUID?
    func start(store: AppStore) {
        self.store = store
        guard WCSession.isSupported() else { return }
        WCSession.default.delegate = self
        WCSession.default.activate()
    }
    func publish() async {
        if publishing { publishAgain = true; return }
        guard let store, !store.starting, !store.validating,
              WCSession.default.activationState == .activated, WCSession.default.isWatchAppInstalled else { return }
        publishing = true
        defer {
            publishing = false
            if publishAgain { publishAgain = false; Task { await self.publish() } }
        }
        do {
            let snapshot = try await snapshot()
            guard !store.validating, store.user?.id == snapshot.owner else { return }
            try WCSession.default.updateApplicationContext(["snapshot": try JSONEncoder().encode(snapshot)])
        } catch { /* Keep the last good watch snapshot; explicit refresh reports errors. */ }
    }
    private func snapshot() async throws -> WatchSnapshot {
        guard let store, !store.starting, !store.validating else { throw AppError.message("Open Expens*** on your iPhone to finish signing in.") }
        guard let owner = store.user?.id else { return .signedOut }
        if watchOwner != owner { watchOwner = owner; watchProfile = nil }
        guard let profile = store.profiles.first(where: { $0.id == watchProfile }) ?? store.active, store.ledgerReady else { throw AppError.message("Choose a profile on your iPhone first.") }
        let recent = try await API.shared.watchRecent(profile: profile.id, owner: owner)
        guard store.user?.id == owner, !store.validating, !store.deletingData, let current = store.profiles.first(where: { $0.id == profile.id }) else { throw AppError.signedOut }
        return WatchSnapshot(owner: owner, profile: profile.id, name: current.name, balance: current.balance,
            currency: CurrencyPreference.shared.symbol, recent: recent.map { .init(id: $0.id, reason: $0.reason, amount: $0.amount, date: $0.createdAt) }, updated: Date(),
            profiles: store.profiles.map { .init(id: $0.id, name: $0.name, balance: $0.balance) },
            categories: store.categories.map { .init(id: $0.id, name: $0.name) })
    }
    private func receive(_ data: Data) async -> Data {
        let reply: WatchReply
        do {
            let request = try JSONDecoder().decode(WatchRequest.self, from: data)
            guard let store, !store.starting, !store.validating, !store.deletingData else { throw AppError.message("Open Expens*** on your iPhone first.") }
            if request.action == "refresh" {
                if let profile = request.profile {
                    guard request.owner == store.user?.id, request.owner != nil,
                          store.profiles.contains(where: { $0.id == profile }) else { throw AppError.message("Account changed. Refresh from your iPhone.") }
                    watchOwner = request.owner; watchProfile = profile
                }
                await store.synchronizeIfStale()
                reply = WatchReply(accepted: true, message: "", snapshot: try await snapshot())
            } else if request.action == "expense" {
                guard let owner = request.owner, store.user?.id == owner, let profile = request.profile,
                      store.profiles.contains(where: { $0.id == profile }) else { throw AppError.message("Account changed. Open the iPhone app and refresh your watch.") }
                let amount = try Money.parse(request.amount)
                guard !request.reason.trimmed.isEmpty, request.reason.count <= 200, request.date <= Date().addingTimeInterval(300) else { throw AppError.message("Enter a reason and a valid date.") }
                // Durable phone outbox + stable request ID: retries never create a second charge.
                guard request.category == nil || store.categories.contains(where: { $0.id == request.category }) else { throw AppError.message("Category changed. Refresh and choose a category again.") }
                try await store.addExpense(id: request.id, profile: profile, reason: request.reason, amount: amount, category: request.category, notes: "", date: request.date, expectedOwner: owner)
                reply = WatchReply(accepted: true, message: "Queued on iPhone", snapshot: nil)
            } else { throw AppError.message("Update both apps and retry.") }
        } catch { reply = WatchReply(accepted: false, message: error.localizedDescription, snapshot: nil) }
        return (try? JSONEncoder().encode(reply)) ?? Data()
    }
    nonisolated func session(_ session: WCSession, didReceiveMessageData messageData: Data, replyHandler: @escaping (Data) -> Void) {
        let reply = WatchReplyHandler(replyHandler)
        Task { @MainActor in reply.send(await self.receive(messageData)) }
    }
    nonisolated func session(_ session: WCSession, activationDidCompleteWith activationState: WCSessionActivationState, error: Error?) {
        Task { @MainActor in await self.publish() }
    }
    nonisolated func sessionDidBecomeInactive(_ session: WCSession) {}
    nonisolated func sessionDidDeactivate(_ session: WCSession) { session.activate() }
    nonisolated func sessionWatchStateDidChange(_ session: WCSession) { Task { @MainActor in await self.publish() } }
}
