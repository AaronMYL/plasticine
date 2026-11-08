import Foundation
import Darwin

// 文件的列、读、写（第 102 条）：路径先由调用方按授权目录核过（PathPolicy.authorize）。App 的设备动作和助手进程
// （第 14 条）共用这一份；参数从哪来由各自解码（App：ActionParams，见 file-action-params.swift；助手：helper-files.swift）。
package actor FileActions {
    package init() {}

    package func list(_ directory: URL) throws -> JSONValue {
        try Task.checkCancellation()
        return try listEntries(directory)
    }

    package func read(_ path: URL) throws -> JSONValue {
        try Task.checkCancellation()
        let data = try FileData.read(path)
        let text = String(data: data, encoding: .utf8)
        return .object([
            "content": .string(text ?? data.base64EncodedString()),
            "encoding": .string(text == nil ? "base64" : "utf8"), "version": .string(Digest.hex(data))
        ])
    }

    package func write(_ path: URL, content: String, baseVersion: String?) throws -> JSONValue {
        try Task.checkCancellation()
        return try writeChecked(path, content: content, baseVersion: baseVersion)
    }

    private func listEntries(_ directory: URL) throws -> JSONValue {
        let paths = try FileManager.default.contentsOfDirectory(
            at: directory, includingPropertiesForKeys: [.isSymbolicLinkKey, .isDirectoryKey, .fileSizeKey,
                                                      .contentModificationDateKey]
        )
        var entries: [JSONValue] = []
        for path in paths.sorted(by: { $0.lastPathComponent < $1.lastPathComponent }) {
            try Task.checkCancellation()
            let values = try path.resourceValues(
                forKeys: [.isSymbolicLinkKey, .isDirectoryKey, .fileSizeKey, .contentModificationDateKey]
            )
            let type: String
            if values.isSymbolicLink == true { type = "link" }
            else if values.isDirectory == true { type = "dir" }
            else { type = "file" }
            let modified = ISO8601DateFormatter().string(from: values.contentModificationDate ?? .distantPast)
            entries.append(.object([
                "name": .string(path.lastPathComponent), "type": .string(type),
                "size": .number(Double(values.fileSize ?? 0)), "modifiedAt": .string(modified)
            ]))
        }
        return .object(["entries": .array(entries)])
    }

    private func writeChecked(_ path: URL, content: String, baseVersion: String?) throws -> JSONValue {
        if let baseVersion {
            guard FileManager.default.fileExists(atPath: path.path),
                  try Digest.hex(FileData.read(path)) == baseVersion else {
                throw DeviceFailure.refused("文件已被改过")
            }
        } else if FileManager.default.fileExists(atPath: path.path) {
            throw DeviceFailure.refused("文件已被改过")
        }
        let data = Data(content.utf8)
        guard data.count <= AppConstants.fileBytes else { throw DeviceFailure.refused("文件超过 10 MB") }
        try Task.checkCancellation()
        if baseVersion != nil {
            try data.write(to: path, options: .atomic)
        } else {
            // Publish a fully written inode without replacing a file created concurrently.
            let temporary = path.deletingLastPathComponent().appendingPathComponent(".plasticine-" + UUID().uuidString)
            try data.write(to: temporary, options: .withoutOverwriting)
            let linked = temporary.path.withCString { source in
                path.path.withCString { target in Darwin.link(source, target) }
            }
            let reason = errno
            try FileManager.default.removeItem(at: temporary)
            guard linked == 0 else {
                if reason == EEXIST { throw DeviceFailure.refused("文件已被改过") }
                throw DeviceFailure.failed("无法建立新文件，请检查目录写入权限。")
            }
        }
        // 第 102 条：回执版本是写完后重新读磁盘字节算的 SHA-256，不用输入缓冲，确保证明的是磁盘上真实的内容。
        return .object(["version": .string(Digest.hex(try FileData.read(path)))])
    }
}
