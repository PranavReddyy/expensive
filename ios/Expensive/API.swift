import Foundation
import Security

struct AuthUser: Codable, Sendable {
    let id: UUID
    let email: String?
    let emailConfirmedAt: Date?
    var username: String? = nil
}

extension AuthUser {
    private enum CodingKeys: String, CodingKey { case id, email, emailConfirmedAt, username, appMetadata }
    init(from decoder: Decoder) throws {
        let values = try decoder.container(keyedBy: CodingKeys.self)
        id = try values.decode(UUID.self, forKey: .id)
        email = try values.decodeIfPresent(String.self, forKey: .email)
        emailConfirmedAt = try values.decodeIfPresent(Date.self, forKey: .emailConfirmedAt)
        struct Metadata: Decodable { let username: String? }
        username = try values.decodeIfPresent(Metadata.self, forKey: .appMetadata)?.username
            ?? values.decodeIfPresent(String.self, forKey: .username)
    }
    func encode(to encoder: Encoder) throws {
        var values = encoder.container(keyedBy: CodingKeys.self)
        try values.encode(id, forKey: .id)
        try values.encodeIfPresent(email, forKey: .email)
        try values.encodeIfPresent(emailConfirmedAt, forKey: .emailConfirmedAt)
        try values.encodeIfPresent(username, forKey: .username)
    }
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
        kSecAttrService as String: "com.itsbypranav.expensive.session", kSecAttrAccount as String: "supabase-v2"] }
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
    private let appURL: URL?
    private var session: Session?
    private var refreshTask: Task<Session, Error>?
    private var generation = 0
    private let transport: URLSession

    init() {
        url = URL(string: Bundle.main.object(forInfoDictionaryKey: "SupabaseURL") as? String ?? "")
        key = Bundle.main.object(forInfoDictionaryKey: "SupabaseKey") as? String ?? ""
        appURL = URL(string: Bundle.main.object(forInfoDictionaryKey: "AppURL") as? String ?? "")
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
        // Keychain session permits local views and draft saving immediately.
        // Every remote operation still refreshes its token and is checked by RLS.
        guard saved.user.emailConfirmedAt != nil else { throw AppError.verificationRequired }
        guard saved.user.username != nil else { throw AppError.usernameRequired }
        return saved.user
    }

    private var verificationEmail = ""
    private var verificationPassword = ""

    func pendingEmail() -> String { session?.user.email ?? verificationEmail }

    func watchChanges(owner: UUID, onChange: @escaping @Sendable () async -> Void) async throws {
        guard session?.user.id == owner, let url, url.scheme == "https", !key.isEmpty else { throw AppError.signedOut }
        var components = URLComponents(url: url.appending(path: "realtime/v1/websocket"), resolvingAgainstBaseURL: false)!
        components.scheme = "wss"
        components.queryItems = [.init(name: "apikey", value: key), .init(name: "vsn", value: "1.0.0")]
        guard let address = components.url else { throw AppError.message("Realtime is unavailable.") }
        let token = try await accessToken()
        guard session?.user.id == owner else { throw AppError.signedOut }
        let socket = transport.webSocketTask(with: address)
        let topic = "realtime:expense-ledger"
        socket.resume()
        defer { socket.cancel(with: .goingAway, reason: nil) }
        let join: [String: Any] = ["topic": topic, "event": "phx_join", "ref": "join", "join_ref": "join",
            "payload": ["access_token": token, "config": ["broadcast": ["ack": false, "self": false], "presence": ["enabled": false],
                "postgres_changes": [["event": "*", "schema": "public"]], "private": false]]]
        let joinData = try JSONSerialization.data(withJSONObject: join)
        try await socket.send(.string(String(decoding: joinData, as: UTF8.self)))
        let health = RealtimeHealth()
        try await withTaskCancellationHandler {
            try await withThrowingTaskGroup(of: Void.self) { group in
                group.addTask {
                    while !Task.isCancelled {
                        let message = try await socket.receive()
                        let data: Data
                        switch message { case .string(let text): data = Data(text.utf8); case .data(let value): data = value; @unknown default: continue }
                        guard let json = try JSONSerialization.jsonObject(with: data) as? [String: Any] else { continue }
                        await health.received()
                        let event = json["event"] as? String
                        let payload = json["payload"] as? [String: Any]
                        if event == "phx_error" || event == "phx_close" || payload?["status"] as? String == "error" { throw AppError.message("Realtime reconnecting.") }
                        if event == "postgres_changes" || (event == "phx_reply" && json["ref"] as? String == "join") { await onChange() }
                    }
                }
                group.addTask {
                    var previousToken = token
                    while !Task.isCancelled {
                        try await Task.sleep(for: .seconds(25))
                        guard await health.isAlive() else { throw AppError.message("Realtime timed out.") }
                        let currentToken = try await self.realtimeToken(owner: owner)
                        if currentToken != previousToken {
                            let data = try JSONSerialization.data(withJSONObject: ["topic": topic, "event": "access_token", "ref": UUID().uuidString, "join_ref": "join", "payload": ["access_token": currentToken]])
                            try await socket.send(.string(String(decoding: data, as: UTF8.self)))
                            previousToken = currentToken
                        }
                        let heartbeat = try JSONSerialization.data(withJSONObject: ["topic": "phoenix", "event": "heartbeat", "ref": UUID().uuidString, "payload": [:]] as [String: Any])
                        try await socket.send(.string(String(decoding: heartbeat, as: UTF8.self)))
                    }
                }
                do { try await group.next(); group.cancelAll(); socket.cancel(with: .goingAway, reason: nil) }
                catch { group.cancelAll(); socket.cancel(with: .goingAway, reason: nil); throw error }
            }
        } onCancel: { socket.cancel(with: .goingAway, reason: nil) }
    }
    private func realtimeToken(owner: UUID) async throws -> String {
        guard session?.user.id == owner else { throw AppError.signedOut }
        let token = try await accessToken()
        guard session?.user.id == owner else { throw AppError.signedOut }
        return token
    }

    private func authRequest(_ path: String, body: [String: String]? = nil, token: String? = nil, method: String = "POST") async throws -> Data {
        guard let url, url.scheme == "https", !key.isEmpty else { throw AppError.message("Sign-in is not configured.") }
        var request = URLRequest(url: URL(string: url.absoluteString + "/auth/v1/" + path)!)
        request.httpMethod = method
        request.setValue(key, forHTTPHeaderField: "apikey")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        if let token { request.setValue("Bearer " + token, forHTTPHeaderField: "Authorization") }
        if let body { request.httpBody = try JSONSerialization.data(withJSONObject: body) }
        return try await send(request)
    }

    private func persist(_ next: Session) throws {
        let saved = next.withExpiry
        try Vault.save(saved); session = saved
    }

    func authenticate(email: String, password: String, create: Bool) async throws -> AuthUser {
        if create && password.count < 12 { throw AppError.message("Use at least 12 characters for your password.") }
        generation += 1
        let version = generation
        if create {
            _ = try await authRequest("signup", body: ["email": email, "password": password])
            verificationEmail = email; verificationPassword = password
            throw AppError.verificationRequired
        }
        let data: Data
        if email.contains("@") {
            verificationEmail = email; verificationPassword = password
            data = try await authRequest("token?grant_type=password", body: ["email": email, "password": password])
        } else {
            data = try await service(appURL, path: "api/identity/login", method: "POST", body: ["identifier": email, "password": password], authenticated: false)
        }
        guard version == generation else { throw AppError.signedOut }
        try persist(Wire.decoder().decode(Session.self, from: data))
        verificationEmail = ""; verificationPassword = ""
        guard let user = session?.user, user.emailConfirmedAt != nil else { throw AppError.verificationRequired }
        guard user.username != nil else { throw AppError.usernameRequired }
        return user
    }

    func sendVerification() async throws {
        _ = try await authRequest("resend", body: ["type": "signup", "email": pendingEmail()])
    }
    func usernameAvailable(_ username: String) async throws -> Bool {
        struct Payload: Encodable { let pUsername: String }
        let data = try await raw(path: "rest/v1/rpc/username_available", method: "POST", body: Wire.encoder().encode(Payload(pUsername: username)))
        return try JSONDecoder().decode(Bool.self, from: data)
    }
    func resetPassword(email: String) async throws {
        _ = try await authRequest("recover", body: ["email": email])
    }
    func chooseUsername(_ username: String) async throws -> AuthUser {
        struct Payload: Encodable, Sendable { let pUsername: String }
        try await write(Payload(pUsername: username), path: "rpc/claim_username")
        _ = try await accessToken(force: true)
        return try await completeAuthentication()
    }
    func completeAuthentication() async throws -> AuthUser {
        if session == nil {
            guard !verificationEmail.isEmpty, !verificationPassword.isEmpty else { throw AppError.message("Email verified? Sign in with your email and password.") }
            return try await authenticate(email: verificationEmail, password: verificationPassword, create: false)
        }
        let version = generation
        let token = try await accessToken()
        let user = try Wire.decoder().decode(AuthUser.self, from: try await authRequest("user", token: token, method: "GET"))
        guard version == generation, let current = session else { throw AppError.signedOut }
        try persist(Session(accessToken: current.accessToken, refreshToken: current.refreshToken, expiresIn: current.expiresIn, expiresAt: current.expiresAt, user: user))
        guard user.emailConfirmedAt != nil else { throw AppError.verificationRequired }
        guard user.username != nil else { throw AppError.usernameRequired }
        return user
    }
    func signOut() async throws {
        try Vault.clear(); generation += 1
        refreshTask?.cancel(); refreshTask = nil; session = nil
        verificationEmail = ""; verificationPassword = ""
    }
    private func accessToken(force: Bool = false) async throws -> String {
        guard let session else { throw AppError.signedOut }
        if !force && (session.expiresAt ?? 0) > Date().timeIntervalSince1970 + 60 { return session.accessToken }
        if let refreshTask { return try await refreshTask.value.accessToken }
        let currentGeneration = generation
        let task = Task<Session, Error> {
            let data = try await self.authRequest("token?grant_type=refresh_token", body: ["refresh_token": session.refreshToken])
            let updated = try Wire.decoder().decode(Session.self, from: data).withExpiry
            guard updated.user.id == session.user.id else { throw AppError.signedOut }
            return updated
        }
        refreshTask = task
        defer { refreshTask = nil }
        do {
            let updated = try await task.value
            guard currentGeneration == generation else { throw AppError.signedOut }
            try persist(updated)
            return updated.accessToken
        } catch AppError.signedOut {
            if currentGeneration == generation { self.session = nil; try? Vault.clear() }
            throw AppError.signedOut
        }
    }

    private func service(_ base: URL?, path: String, method: String, body: [String: String]? = nil, authenticated: Bool = true, expectedOwner: UUID? = nil) async throws -> Data {
        guard let base, base.scheme == "https", base.host != nil else { throw AppError.message("Account service is not configured yet.") }
        var request = URLRequest(url: base.appending(path: path))
        request.httpMethod = method
        if authenticated {
            if let expectedOwner, session?.user.id != expectedOwner { throw AppError.signedOut }
            let token = try await accessToken()
            if let expectedOwner, session?.user.id != expectedOwner { throw AppError.signedOut }
            request.setValue("Bearer " + token, forHTTPHeaderField: "Authorization")
        }
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        if let body { request.httpBody = try JSONSerialization.data(withJSONObject: body) }
        return try await send(request)
    }

    private func send(_ request: URLRequest) async throws -> Data {
        let (data, response) = try await transport.data(for: request)
        guard let response = response as? HTTPURLResponse else { throw AppError.message("Check your connection and retry.") }
        if (200..<300).contains(response.statusCode) { return data }
        let json = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any]
        let code = json?["error_code"] as? String
        if code == "email_not_confirmed" { throw AppError.verificationRequired }
        if request.url?.query == "grant_type=password" || request.url?.path == "/api/identity/login" {
            throw AppError.message(json?["msg"] as? String ?? json?["error_description"] as? String ?? "Email, username, or password is incorrect.")
        }
        if response.statusCode == 401 || ["refresh_token_not_found","refresh_token_already_used","user_not_found"].contains(code ?? "") { throw AppError.signedOut }
        if response.statusCode == 429 { throw AppError.message("Too many attempts. Please wait and retry.") }
        throw AppError.message(json?["msg"] as? String ?? json?["message"] as? String ?? json?["error_description"] as? String ?? json?["error"] as? String ?? "Could not connect. Please retry.")
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
    func watchRecent(profile: UUID, owner: UUID) async throws -> [Expense] {
        let token = try await realtimeToken(owner: owner)
        let data = try await raw(path: "rest/v1/expenses", query: [.init(name: "profile_id", value: "eq.\(profile)"), .init(name: "select", value: "*,categories(id,name,sort_order)"), .init(name: "order", value: "created_at.desc,id.desc"), .init(name: "limit", value: "5")], token: token)
        guard session?.user.id == owner else { throw AppError.signedOut }
        return try Wire.decoder().decode([Expense].self, from: data)
    }

    func write<T: Encodable & Sendable>(_ payload: T, path: String, method: String = "POST", query: [URLQueryItem] = [], upsert: Bool = false, expectedOwner: UUID? = nil) async throws {
        if let expectedOwner, session?.user.id != expectedOwner { throw AppError.signedOut }
        let token = try await accessToken()
        if let expectedOwner, session?.user.id != expectedOwner { throw AppError.signedOut }
        _ = try await raw(path: "rest/v1/" + path, query: query, method: method, token: token, body: Wire.encoder().encode(payload), prefer: upsert ? "resolution=ignore-duplicates,return=minimal" : "return=minimal")
    }

    func exportCSV(table: String) async throws -> String {
        let columns: [String]
        switch table {
        case "expenses": columns = ["id","profile_id","reason","amount","category_id","notes","created_at"]
        case "debts": columns = ["id","profile_id","person_id","direction","amount","remaining_amount","description","created_at","settled_at"]
        case "account_activity": columns = ["id","profile_id","person_id","title","kind","amount","balance_delta","created_at","undone_at"]
        default: throw AppError.message("Unsupported export.")
        }
        func cell(_ value: Any?) -> String {
            let text = value == nil || value is NSNull ? "" : String(describing: value!)
            let first = text.trimmingCharacters(in: .whitespacesAndNewlines.union(.controlCharacters)).first
            let safe = !(value is NSNumber) && first.map { "=+-@".contains($0) } == true ? "'" + text : text
            return "\"" + safe.replacingOccurrences(of: "\"", with: "\"\"") + "\""
        }
        let owner = session?.user.id
        let token = try await accessToken()
        var lines = [columns.map { cell($0) }.joined(separator: ",")]
        var offset = 0
        while true {
            try Task.checkCancellation()
            guard owner == session?.user.id else { throw AppError.signedOut }
            let data = try await raw(path: "rest/v1/" + table, query: [.init(name: "select", value: columns.joined(separator: ",")), .init(name: "order", value: "id.asc"), .init(name: "limit", value: "1000"), .init(name: "offset", value: String(offset))], token: token)
            guard let rows = try JSONSerialization.jsonObject(with: data) as? [[String: Any]] else { throw AppError.message("Could not read export.") }
            lines += rows.map { row in columns.map { cell(row[$0]) }.joined(separator: ",") }
            if rows.count < 1000 { return "\u{FEFF}" + lines.joined(separator: "\r\n") }
            offset += 1000
        }
    }
    func deleteExpensiveData(owner: UUID, confirmation: String) async throws {
        guard session?.user.id == owner else { throw AppError.signedOut }
        _ = try await service(appURL, path: "api/account/delete-data", method: "POST", body: ["confirmation": confirmation], expectedOwner: owner)
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
            if code == "PGRST202" { throw AppError.rejected("The native database update has not been installed yet.") }
            let message = failure?.message ?? failure?.msg ?? failure?.errorDescription ?? "Could not save. Check your connection and retry."
            if (400..<500).contains(response.statusCode) && response.statusCode != 408 { throw AppError.rejected(message) }
            throw AppError.message(message)
        }
        return data
    }
}

private actor RealtimeHealth {
    private var lastMessage = Date()
    func received() { lastMessage = Date() }
    func isAlive() -> Bool { Date().timeIntervalSince(lastMessage) < 70 }
}
