import Foundation

struct JournalEntry: Codable {
    let id: String
    let actionClass: String
    let startedAt: String
    var report: ActionReport?
    var uploaded: Bool
}

// One atomic file per action. Never replay an action whose effect may already have happened.
final class ActionJournal {
    private let directory: URL
    private var entries: [String: JournalEntry] = [:]

    init(server: URL, nodeID: String, base: URL? = nil) throws {
        let support = try base ?? FileManager.default.url(
            for: .applicationSupportDirectory, in: .userDomainMask, appropriateFor: nil, create: true
        )
        let scope = Digest.hex(Data((server.absoluteString + "\n" + nodeID).utf8))
        directory = support.appendingPathComponent("Plasticine/actions").appendingPathComponent(scope)
        try FileManager.default.createDirectory(
            at: directory, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700]
        )
        for file in try FileManager.default.contentsOfDirectory(at: directory, includingPropertiesForKeys: nil) {
            guard file.pathExtension == "json" else { continue }
            let entry = try JSONDecoder().decode(JournalEntry.self, from: Data(contentsOf: file))
            entries[entry.id] = entry
        }
        for var entry in Array(entries.values) where entry.report == nil {
            entry.report = .failed("上次执行中断，结果待核实；为避免重复操作，未再次执行。")
            try save(entry)
        }
    }

    func lookup(_ id: String) -> ActionReport? { entries[id]?.report }
    var pending: [JournalEntry] { entries.values.filter { !$0.uploaded && $0.report != nil } }

    func begin(_ action: RemoteAction, actionClass: String) throws {
        let entry = JournalEntry(
            id: action.id, actionClass: actionClass, startedAt: ISO8601DateFormatter().string(from: Date()),
            report: nil, uploaded: false
        )
        try save(entry)
    }

    func finish(_ id: String, report: ActionReport) throws {
        guard var entry = entries[id] else { throw DeviceFailure.failed("动作记录缺失，请重启设备服务核对。") }
        entry.report = report
        entry.uploaded = false
        try save(entry)
    }

    func markUploaded(_ id: String) throws {
        guard var entry = entries[id] else { throw DeviceFailure.failed("回执记录缺失，请重启设备服务核对。") }
        entry.uploaded = true
        try save(entry)
    }

    func usedThisHour(_ actionClass: String, now: Date = Date()) -> Int {
        let formatter = ISO8601DateFormatter()
        return entries.values.filter {
            $0.actionClass == actionClass
                && (formatter.date(from: $0.startedAt) ?? .distantPast) > now.addingTimeInterval(-3600)
        }.count
    }

    private func save(_ entry: JournalEntry) throws {
        let file = directory.appendingPathComponent(Digest.hex(Data(entry.id.utf8)) + ".json")
        try JSONEncoder().encode(entry).write(to: file, options: .atomic)
        try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: file.path)
        entries[entry.id] = entry
    }
}
