import SwiftUI

@main struct ExpensiveApp: App {
    @State private var store = AppStore()
    @AppStorage("appearance") private var appearance = AppAppearance.system.rawValue
    @Environment(\.scenePhase) private var scenePhase
    var body: some Scene {
        WindowGroup {
            Group {
                if store.starting {
                    VStack(spacing: 20) { Text("EXPENS***").font(Theme.font(20, weight: .semibold)); ProgressView() }
                } else if let user = store.user {
                    MainTabs().id(user.id)
                } else {
                    LoginView()
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .background(Theme.background).tint(Theme.ink)
            .preferredColorScheme((AppAppearance(rawValue: appearance) ?? .system).colorScheme)
            .font(Theme.font()).environment(store)
            .overlay {
                if scenePhase != .active {
                    Theme.background.ignoresSafeArea().overlay(Text("EXPENS***").font(Theme.font(20, weight: .semibold)))
                }
            }
            .task { await store.bootstrap() }
            .task(id: scenePhase) {
                guard scenePhase == .active else { return }
                if !store.starting { await store.synchronizeIfStale() }
                while !Task.isCancelled {
                    do { try await Task.sleep(for: .seconds(120)) } catch { break }
                    guard !Task.isCancelled else { break }
                    if store.user != nil { await store.synchronizeIfStale() }
                }
            }
        }
    }
}

struct MainTabs: View {
    var body: some View {
        TabView {
            Tab("Home", systemImage: "house") { NavigationStack { HomeView() } }
            Tab("Expenses", systemImage: "list.bullet.rectangle") { NavigationStack { ExpensesView() } }
            Tab("Analytics", systemImage: "chart.bar.xaxis") { NavigationStack { AnalyticsView() } }
            Tab("Tabs", systemImage: "person.2") { NavigationStack { TabsView() } }
        }
    }
}

extension View {
    func pageTitle(_ title: String) -> some View {
        navigationTitle(title).navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .principal) { Text(title).font(Theme.font(15, weight: .semibold)) } }
    }
}

struct LoginView: View {
    private enum Field: Hashable { case email, password, username }
    @FocusState private var focus: Field?
    @Environment(AppStore.self) private var store
    @State private var email = ""
    @State private var password = ""
    @State private var username = ""
    @State private var creating = false
    @State private var busy = false
    @State private var notice: String?
    @State private var retryAt = Date.distantPast
    @State private var availability = ""
    private var choosingUsername: Bool { store.authStep == .username || (store.authStep == .signIn && creating) }
    private var title: String {
        switch store.authStep {
        case .verify: "I've verified my email"
        case .username: "save username"
        case .signIn: creating ? "create account" : "sign in"
        }
    }
    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 24) {
                VStack(alignment: .leading, spacing: 8) {
                    Text("EXPENS***").font(Theme.font(24, weight: .semibold, relativeTo: .title))
                    Text("your money, at a glance").foregroundStyle(.secondary)
                }.padding(.bottom, 12)
                switch store.authStep {
                case .signIn:
                    VStack(alignment: .leading, spacing: 8) {
                        SectionLabel(creating ? "email" : "username or email")
                        TextField(creating ? "you@example.com" : "username or email", text: $email)
                            .focused($focus, equals: .email).submitLabel(.next).onSubmit { focus = .password }
                            .keyboardType(creating ? .emailAddress : .default).textContentType(creating ? .emailAddress : .username)
                            .textInputAutocapitalization(.never).autocorrectionDisabled()
                            .padding(14).overlay(Rectangle().stroke(Theme.ink.opacity(0.2)))
                    }
                    VStack(alignment: .leading, spacing: 8) {
                        SectionLabel("password")
                        SecureField("password", text: $password)
                            .focused($focus, equals: .password).submitLabel(creating ? .next : .done).onSubmit { focus = creating ? .username : nil }
                            .textContentType(creating ? .newPassword : .password)
                            .padding(14).overlay(Rectangle().stroke(Theme.ink.opacity(0.2)))
                    }
                    if creating {
                        Text("Use at least 12 characters. If you previously used email codes, create your password with the same email to keep your data.")
                            .font(Theme.font(11)).foregroundStyle(.secondary)
                    }
                case .verify:
                    Text("Open the verification link sent to \(email), then continue here.")
                        .font(Theme.font(12)).foregroundStyle(.secondary)
                case .username:
                    Text("Confirm your username, shared across our apps.").foregroundStyle(.secondary)
                }
                if choosingUsername {
                    TextField("username", text: $username)
                        .focused($focus, equals: .username).submitLabel(.done).onSubmit { focus = nil }
                        .textContentType(.username).textInputAutocapitalization(.never).autocorrectionDisabled()
                        .padding(14).overlay(Rectangle().stroke(Theme.ink.opacity(0.2)))
                    Text(availability.isEmpty ? "3–24 letters, numbers, or underscores, starting with a letter." : availability)
                        .font(Theme.font(11)).foregroundStyle(.secondary)
                    Text("Your username is reserved after email verification and cannot currently be changed.")
                        .font(Theme.font(11)).foregroundStyle(.secondary)
                }
                if let notice { Text(notice).font(Theme.font(11)).foregroundStyle(.secondary) }
                if let error = store.error { ErrorNotice(message: error) }
                Button(action: submit) {
                    HStack { if busy { ProgressView().tint(Theme.onInk) }; Text(title); Spacer(); Image(systemName: "arrow.right") }.padding(12)
                }.buttonStyle(PrimaryActionStyle()).disabled(busy || store.starting)
                if store.authStep == .signIn {
                    HStack {
                        Button(creating ? "sign in instead" : "create account") { creating.toggle(); store.error = nil; notice = nil }
                        Spacer()
                        Button("forgot password?") {
                            run {
                                guard email.trimmed.contains("@") else { throw AppError.message("Enter your email address first.") }
                                try await API.shared.resetPassword(email: email.trimmed.lowercased())
                                notice = "If this email has an account, a reset link is on its way."
                            }
                        }
                    }.font(Theme.font(11)).buttonStyle(.plain).disabled(busy)
                } else {
                    if store.authStep == .verify {
                        TimelineView(.periodic(from: .now, by: 1)) { context in
                            let seconds = max(0, Int(ceil(retryAt.timeIntervalSince(context.date))))
                            Button(seconds > 0 ? "resend in \(seconds)s" : "resend verification email") {
                                run { try await API.shared.sendVerification(); retryAt = Date().addingTimeInterval(60); notice = "Verification email sent." }
                            }.disabled(busy || seconds > 0)
                        }.font(Theme.font(11)).buttonStyle(.plain)
                    }
                    Button("use another account") { run { try await store.logout(); password = "" } }
                        .font(Theme.font(11)).buttonStyle(.plain).disabled(busy)
                }
            }.font(Theme.font()).frame(maxWidth: 380).padding(28).padding(.top, 90).frame(maxWidth: .infinity)
        }.scrollDismissesKeyboard(.interactively)
        .task { if email.isEmpty { email = await API.shared.pendingEmail() } }
        .task(id: store.authStep) {
            if store.authStep == .verify { email = await API.shared.pendingEmail() }
            do {
                try await Task.sleep(for: .milliseconds(300))
                focus = store.authStep == .signIn ? .email : store.authStep == .username ? .username : nil
            } catch {}
        }
        .task(id: "\(choosingUsername)-\(username)") {
            availability = ""
            guard choosingUsername, !username.trimmed.isEmpty else { return }
            availability = "checking…"
            do {
                try await Task.sleep(for: .milliseconds(400))
                let available = try await API.shared.usernameAvailable(username.trimmed.lowercased())
                try Task.checkCancellation()
                availability = available ? "available" : "already taken"
            } catch { if !Task.isCancelled { availability = error.localizedDescription } }
        }
    }
    private func submit() {
        run {
            switch store.authStep {
            case .signIn:
                defer { password = "" }
                if creating {
                    guard try await API.shared.usernameAvailable(username.trimmed.lowercased()) else { throw AppError.message("That username is already taken.") }
                }
                try await store.signIn(email: email.trimmed.lowercased(), password: password, create: creating)
            case .verify: try await store.completeSignIn()
            case .username: try await store.completeSignIn(username: username.trimmed.lowercased())
            }
        }
    }
    private func run(_ action: @escaping @MainActor () async throws -> Void) {
        guard !busy else { return }
        busy = true; notice = nil; store.error = nil
        Task {
            defer { busy = false }
            do { try await action() }
            catch { store.handle(error) }
        }
    }
}
