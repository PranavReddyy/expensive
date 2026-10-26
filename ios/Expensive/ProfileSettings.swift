import SwiftUI

struct ManageProfilesView: View {
    @Environment(AppStore.self) private var store
    @State private var selected: UUID?
    @State private var confirmation = ""
    @State private var busy = false
    @State private var error: String?
    @State private var confirmDelete = false
    private var profile: Profile? { store.profiles.first { $0.id == selected } }
    var body: some View {
        Form {
            Section("profile") {
                Picker("profile", selection: $selected) {
                    Text("choose profile").tag(Optional<UUID>.none)
                    ForEach(store.profiles) { Text($0.name).tag(Optional($0.id)) }
                }.disabled(busy)
            }
            if let profile {
                Section {
                    Text("Permanently deletes this profile, its balance, expenses, schedules, settled Tabs and linked transfer history. Other profiles’ balances stay unchanged. Export first and resolve pending expenses on every device.")
                        .font(Theme.font(12)).foregroundStyle(.secondary)
                    TextField("type \(profile.name) to confirm", text: $confirmation)
                        .textInputAutocapitalization(.never).autocorrectionDisabled().disabled(busy)
                    Button("delete profile permanently", role: .destructive) { confirmDelete = true }
                        .disabled(busy || confirmation != profile.name)
                }
            }
            if busy { LoadingState(title: "updating profile") }
            if let error { Text(error).font(Theme.font(12)).foregroundStyle(.red) }
        }
        .navigationTitle("profiles")
        .onChange(of: selected) { confirmation = ""; error = nil }
        .confirmationDialog("Permanently delete this profile? This cannot be undone.", isPresented: $confirmDelete, titleVisibility: .visible) {
            Button("delete profile", role: .destructive) {
                guard let profile, !busy else { return }
                busy = true; error = nil
                Task {
                    defer { busy = false }
                    do { try await store.deleteProfile(profile, confirmation: confirmation); selected = nil; confirmation = "" }
                    catch { self.error = error.localizedDescription }
                }
            }
        }
    }
}
