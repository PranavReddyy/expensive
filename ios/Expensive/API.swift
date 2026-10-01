import Foundation
import Security

struct AuthUser: Codable, Sendable {
    let id: UUID
    let email: String?
    let emailConfirmedAt: Date?
    var username: String? = nil
}

struct Session: Codable, Sendable {
    let accessToken: String
    let refreshToken: String
    let expiresIn: Double?
    let expiresAt: Double?
    let user: AuthUser
    var withExpiry: Session {
        Session(accessToken: accessToken, refreshToken: refreshToken, expiresIn: expiresIn,
                expiresAt: expiresAt ?? Date().timeIntervalSince1970 + (expiresIn ?? 3600), user: user)
    }
}

enum Wire {
    static func decoder() -> JSONDecoder {
        let decoder = JSONDecoder()
        decoder.keyDecodingStrategy = .convertFromSnakeCase
        decoder.dateDecodingStrategy = .custom { decoder in
            let text = try decoder.singleValueContainer().decode(String.self)
            let formatter = ISO8601DateFormatter()
            formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
            if let date = formatter.date(from: text) { return date }
            formatter.formatOptions = [.withInternetDateTime]
            guard let date = formatter.date(from: text) else { throw AppError.message("The server returned an invalid date.") }
            return date
        }
        return decoder
    }
    static func encoder() -> JSONEncoder {
        let encoder = JSONEncoder()
        encoder.keyEncodingStrategy = .convertToSnakeCase
        encoder.dateEncodingStrategy = .iso8601
        return encoder
    }
}

enum Vault {
    private static var query: [String: Any] { [kSecClass as String: kSecClassGenericPassword,
        kSecAttrService as String: "com.itsbypranav.expensive.session", kSecAttrAccount as String: "firebase-v1"] }
    static func read() throws -> Session? {
        var request = query
        request[kSecReturnData as String] = true
        request[kSecMatchLimit as String] = kSecMatchLimitOne
        var result: CFTypeRef?
        let status = SecItemCopyMatching(request as CFDictionary, &result)
        if status == errSecItemNotFound { return nil }
        guard status == errSecSuccess, let data = result as? Data else { throw AppError.message("Unlock your device to restore your account.") }
        return try Wire.decoder().decode(Session.self, from: data)
    }
    static func save(_ session: Session) throws {
        let data = try Wire.encoder().encode(session)
        let status = SecItemUpdate(query as CFDictionary, [kSecValueData as String: data] as CFDictionary)
        if status == errSecItemNotFound {
            var request = query
            request[kSecValueData as String] = data
            request[kSecAttrAccessible as String] = kSecAttrAccessibleWhenUnlockedThisDeviceOnly
            guard SecItemAdd(request as CFDictionary, nil) == errSecSuccess else { throw AppError.message("Could not securely save your session.") }
        } else if status != errSecSuccess { throw AppError.message("Could not securely save your session.") }
    }
    static func clear() throws {
        let status = SecItemDelete(query as CFDictionary)
        guard status == errSecSuccess || status == errSecItemNotFound else { throw AppError.message("Could not clear the saved session. Please retry.") }
    }
}

actor API {
    static let shared = API()
    private let url: URL?
    private let key: String
    private let firebaseKey: String
    private let appURL: URL?
    private let identityURL: URL?
    private var session: Session?
    private var refreshTask: Task<Session, Error>?
    private var generation = 0
    private let transport: URLSession

    init() {
        url = URL(string: Bundle.main.object(forInfoDictionaryKey: "SupabaseURL") as? String ?? "")
        key = Bundle.main.object(forInfoDictionaryKey: "SupabaseKey") as? String ?? ""
        firebaseKey = Bundle.main.object(forInfoDictionaryKey: "FirebaseAPIKey") as? String ?? ""
        appURL = URL(string: Bundle.main.object(forInfoDictionaryKey: "AppURL") as? String ?? "")
        identityURL = URL(string: Bundle.main.object(forInfoDictionaryKey: "IdentityURL") as? String ?? "")
        let config = URLSessionConfiguration.ephemeral
        config.timeoutIntervalForRequest = 25
        config.timeoutIntervalForResource = 40
        config.urlCache = nil
        transport = URLSession(configuration: config)
    }

    // Local display hint only. It never authorizes a request or refreshes a token.
    func cachedUser() throws -> AuthUser? {
        guard let saved = try Vault.read(), saved.user.emailConfirmedAt != nil,
              saved.user.username != nil else { return nil }
        return saved.user
    }

    func restore() async throws -> AuthUser? {
        session = try Vault.read()
        guard let saved = session else { return nil }
        if saved.user.emailConfirmedAt != nil, saved.user.username != nil {
            // The bootstrap endpoint verifies revocation, current email and ownership.
            // Returning users do not need to repeat the signup/username handshake.
            let version = generation
            let user = try Wire.decoder().decode(AuthUser.self, from: try await service(appURL, path: "api/auth/bootstrap", method: "POST"))
            guard version == generation, let current = session else { throw AppError.signedOut }
            let updated = Session(accessToken: current.accessToken, refreshToken: current.refreshToken,
                expiresIn: current.expiresIn, expiresAt: current.expiresAt, user: user)
            try Vault.save(updated); session = updated
            return user
        }
        return try await completeAuthentication()
    }

    func pendingEmail() -> String { session?.user.email ?? "" }

    struct FirebaseCredentials: Decodable {
        let idToken: String
        let refreshToken: String
        let expiresIn: String
    }
    struct FirebaseRefresh: Decodable {
        let idToken: String
        let refreshToken: String
        let expiresIn: String
    }
    private func persist(_ credentials: FirebaseCredentials, user: AuthUser) throws {
        let next = Session(accessToken: credentials.idToken, refreshToken: credentials.refreshToken,
            expiresIn: Double(credentials.expiresIn), expiresAt: nil, user: user).withExpiry
        try Vault.save(next); session = next
    }

    func authenticate(email: String, password: String, create: Bool) async throws -> AuthUser {
        if create && password.count < 12 { throw AppError.message("Use at least 12 characters for your password.") }
        let data: Data
        do {
            if create {
                data = try await firebase("accounts:signUp", body: ["email": email, "password": password, "returnSecureToken": true])
            } else {
                struct LoginResult: Decodable { let customToken: String }
                let result = try await service(identityURL, path: "api/identity/login", method: "POST",
                    body: ["identifier": email, "password": password], authenticated: false)
                let login = try JSONDecoder().decode(LoginResult.self, from: result)
                data = try await firebase("accounts:signInWithCustomToken", body: ["token": login.customToken, "returnSecureToken": true])
            }
        } catch AppError.message(let text) where text == "EMAIL_NOT_FOUND" {
            throw AppError.message("Email or password is incorrect.")
        }
        let credentials = try JSONDecoder().decode(FirebaseCredentials.self, from: data)
        generation += 1
        try persist(credentials, user: AuthUser(id: UUID(), email: email, emailConfirmedAt: nil))
        if create {
            try await sendVerification()
            throw AppError.verificationRequired
        }
        return try await completeAuthentication()
    }

    func sendVerification() async throws {
        try await accountEmail(kind: "verify")
    }

    func usernameAvailable(_ username: String) async throws -> Bool {
        guard let identityURL, identityURL.scheme == "https" else { throw AppError.message("Identity service is not configured.") }
        var components = URLComponents(url: identityURL.appendingPathComponent("api/identity/username"), resolvingAgainstBaseURL: false)!
        components.queryItems = [URLQueryItem(name: "username", value: username)]
        guard let url = components.url else { throw AppError.message("Invalid username.") }
        struct Availability: Decodable { let available: Bool }
        let data = try await send(URLRequest(url: url))
        return try JSONDecoder().decode(Availability.self, from: data).available
    }

    func resetPassword(email: String) async throws {
        try await accountEmail(kind: "reset", email: email)
    }

    private func accountEmail(kind: String, email: String = "") async throws {
        struct Delivery: Decodable { let sent: Bool? }
        let result = try await service(identityURL, path: "api/identity/email", method: "POST",
            body: ["kind": kind, "email": email], authenticated: kind == "verify")
        guard try JSONDecoder().decode(Delivery.self, from: result).sent == true else {
            throw AppError.message("Email delivery is unavailable. Please try again shortly.")
        }
    }

    func chooseUsername(_ username: String) async throws -> AuthUser {
        _ = try await service(identityURL, path: "api/identity", method: "POST", body: ["username": username])
        return try await completeAuthentication()
    }

    func completeAuthentication() async throws -> AuthUser {
        let version = generation
        let token = try await accessToken(force: true)
        struct Lookup: Decodable {
            struct User: Decodable { let email: String?; let emailVerified: Bool? }
            let users: [User]
        }
        let data = try await firebase("accounts:lookup", body: ["idToken": token])
        let account = try JSONDecoder().decode(Lookup.self, from: data).users.first
        if let email = account?.email, let current = session, version == generation {
            let updated = Session(accessToken: current.accessToken, refreshToken: current.refreshToken,
                expiresIn: current.expiresIn, expiresAt: current.expiresAt,
                user: AuthUser(id: current.user.id, email: email, emailConfirmedAt: nil))
            try Vault.save(updated); session = updated
        }
        guard account?.emailVerified == true else { throw AppError.verificationRequired }
        struct Identity: Decodable { let needsUsername: Bool?; let refreshToken: Bool? }
        let identity = try JSONDecoder().decode(Identity.self, from: try await service(identityURL, path: "api/identity", method: "GET"))
        if identity.needsUsername == true { throw AppError.usernameRequired }
        if identity.refreshToken == true { _ = try await accessToken(force: true) }
        let user = try Wire.decoder().decode(AuthUser.self, from: try await service(appURL, path: "api/auth/bootstrap", method: "POST"))
        guard version == generation, let current = session else { throw AppError.signedOut }
        let updated = Session(accessToken: current.accessToken, refreshToken: current.refreshToken,
            expiresIn: current.expiresIn, expiresAt: current.expiresAt, user: user)
        try Vault.save(updated); session = updated
        return user
    }

    func signOut() async throws {
        try Vault.clear(); generation += 1
        refreshTask?.cancel(); refreshTask = nil; session = nil
    }

    private func accessToken(force: Bool = false) async throws -> String {
        guard let session else { throw AppError.signedOut }
        if !force && (session.expiresAt ?? 0) > Date().timeIntervalSince1970 + 60 { return session.accessToken }
        if let refreshTask { return try await refreshTask.value.accessToken }
        guard !firebaseKey.isEmpty, !firebaseKey.contains("$(") else { throw AppError.message("Sign-in is not configured yet.") }
        let currentGeneration = generation
        let task = Task<Session, Error> {
            var components = URLComponents(string: "https://securetoken.googleapis.com/v1/token")!
            components.queryItems = [.init(name: "key", value: self.firebaseKey)]
            var request = URLRequest(url: components.url!)
            request.httpMethod = "POST"
            request.setValue("application/x-www-form-urlencoded", forHTTPHeaderField: "Content-Type")
            var form = URLComponents()
            form.queryItems = [.init(name: "grant_type", value: "refresh_token"), .init(name: "refresh_token", value: session.refreshToken)]
            request.httpBody = form.percentEncodedQuery?.replacingOccurrences(of: "+", with: "%2B").data(using: .utf8)
            let data = try await self.send(request)
            let result = try Wire.decoder().decode(FirebaseRefresh.self, from: data)
            return Session(accessToken: result.idToken, refreshToken: result.refreshToken,
                expiresIn: Double(result.expiresIn), expiresAt: nil, user: session.user).withExpiry
        }
        refreshTask = task
        defer { refreshTask = nil }
        do {
            let updated = try await task.value
            guard currentGeneration == generation else { throw AppError.signedOut }
            try Vault.save(updated); self.session = updated
            return updated.accessToken
        } catch AppError.signedOut {
            if currentGeneration == generation { self.session = nil; try? Vault.clear() }
            throw AppError.signedOut
        }
    }

    private func firebase(_ path: String, body: [String: Any]) async throws -> Data {
        guard !firebaseKey.isEmpty, !firebaseKey.contains("$(") else { throw AppError.message("Sign-in is not configured yet.") }
        var components = URLComponents(string: "https://identitytoolkit.googleapis.com/v1/" + path)!
        components.queryItems = [.init(name: "key", value: firebaseKey)]
        var request = URLRequest(url: components.url!)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONSerialization.data(withJSONObject: body)
        return try await send(request)
    }

    private func service(_ base: URL?, path: String, method: String, body: [String: String]? = nil, authenticated: Bool = true) async throws -> Data {
        guard let base, base.scheme == "https", base.host != nil else { throw AppError.message("Account service is not configured yet.") }
        var request = URLRequest(url: base.appending(path: path))
        request.httpMethod = method
        if authenticated { request.setValue("Bearer " + (try await accessToken()), forHTTPHeaderField: "Authorization") }
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        if let body { request.httpBody = try JSONSerialization.data(withJSONObject: body) }
        return try await send(request)
    }

    private func send(_ request: URLRequest) async throws -> Data {
        let (data, response) = try await transport.data(for: request)
        guard let response = response as? HTTPURLResponse else { throw AppError.message("Check your connection and retry.") }
        if (200..<300).contains(response.statusCode) { return data }
        let json = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any]
        let firebaseError = (json?["error"] as? [String: Any])?["message"] as? String
        if response.statusCode == 401 && request.url?.path == "/api/identity/login" { throw AppError.message("Username, email, or password is incorrect.") }
        if response.statusCode == 401 || ["TOKEN_EXPIRED", "INVALID_REFRESH_TOKEN", "USER_DISABLED", "USER_NOT_FOUND", "INVALID_ID_TOKEN"].contains(firebaseError ?? "") { throw AppError.signedOut }
        if response.statusCode == 429 || firebaseError == "TOO_MANY_ATTEMPTS_TRY_LATER" { throw AppError.message("Too many attempts. Wait a minute and try again.") }
        switch firebaseError {
        case "EMAIL_EXISTS": throw AppError.message("This email already has an account. Sign in or reset your password.")
        case "INVALID_LOGIN_CREDENTIALS", "INVALID_PASSWORD": throw AppError.message("Email or password is incorrect.")
        case "EMAIL_NOT_FOUND": throw AppError.message("EMAIL_NOT_FOUND")
        case "INVALID_EMAIL": throw AppError.message("Enter a valid email address.")
        case .some(let value) where value.hasPrefix("WEAK_PASSWORD") || value.hasPrefix("PASSWORD_DOES_NOT_MEET_REQUIREMENTS"):
            throw AppError.message("Choose a stronger password with at least 12 characters.")
        default: throw AppError.message(json?["error"] as? String ?? "Could not connect to your account. Please try again.")
        }
    }

    func list<T: Decodable & Sendable>(_ type: T.Type, table: String, query: [URLQueryItem] = []) async throws -> [T] {
        let token = try await accessToken()
        var rows: [T] = []
        var offset = 0
        while true {
            try Task.checkCancellation()
            let data = try await raw(path: "rest/v1/" + table, query: query + [.init(name: "offset", value: String(offset)), .init(name: "limit", value: "1000")], token: token)
            let batch = try Wire.decoder().decode([T].self, from: data)
            rows += batch
            if batch.count < 1000 { return rows }
            offset += 1000
        }
    }

    func write<T: Encodable & Sendable>(_ payload: T, path: String, method: String = "POST", query: [URLQueryItem] = [], upsert: Bool = false) async throws {
        let token = try await accessToken()
        _ = try await raw(path: "rest/v1/" + path, query: query, method: method, token: token, body: Wire.encoder().encode(payload), prefer: upsert ? "resolution=ignore-duplicates,return=minimal" : "return=minimal")
    }

    private func raw(path: String, query: [URLQueryItem] = [], method: String = "GET", token: String? = nil, body: Data? = nil, prefer: String? = nil) async throws -> Data {
        guard let url, url.scheme == "https", !key.isEmpty, !key.contains("your-") else { throw AppError.message("This build is missing its Supabase configuration.") }
        var components = URLComponents(url: url.appending(path: path), resolvingAgainstBaseURL: false)!
        components.queryItems = query.isEmpty ? nil : query
        var request = URLRequest(url: components.url!)
        request.httpMethod = method
        request.httpBody = body
        request.setValue(key, forHTTPHeaderField: "apikey")
        if let token { request.setValue("Bearer " + token, forHTTPHeaderField: "Authorization") }
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        if let prefer { request.setValue(prefer, forHTTPHeaderField: "Prefer") }
        let (data, response) = try await transport.data(for: request)
        guard let response = response as? HTTPURLResponse else { throw AppError.message("The server did not respond. Please retry.") }
        guard (200..<300).contains(response.statusCode) else {
            struct Failure: Decodable { let message: String?; let msg: String?; let errorDescription: String?; let code: String?; let errorCode: String? }
            let failure = try? Wire.decoder().decode(Failure.self, from: data)
            let code = failure?.code ?? failure?.errorCode ?? ""
            if response.statusCode == 401 || ["refresh_token_not_found", "refresh_token_already_used"].contains(code) { throw AppError.signedOut }
            if response.statusCode == 429 { throw AppError.message("Too many attempts. Wait a minute and try again.") }
            if code == "otp_expired" { throw AppError.message("That code is invalid or expired. Request a new code.") }
            if code == "PGRST202" { throw AppError.message("The native database update has not been installed yet.") }
            throw AppError.message(failure?.message ?? failure?.msg ?? failure?.errorDescription ?? "Could not save. Check your connection and retry.")
        }
        return data
    }
}
