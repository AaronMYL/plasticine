import Foundation

enum FileAttachments {
    static func read(_ urls: [URL]) throws -> JSONValue {
        guard urls.count <= 5 else { throw DeviceFailure.failed("一次最多附加 5 个文件，请分批拖入。") }
        var files: [JSONValue] = []
        for url in urls {
            let access = url.startAccessingSecurityScopedResource()
            defer { if access { url.stopAccessingSecurityScopedResource() } }
            let data = try FileData.read(url)
            files.append(.object([
                "name": .string(url.lastPathComponent), "type": .string(mime(url.pathExtension)),
                "base64": .string(data.base64EncodedString())
            ]))
        }
        return .array(files)
    }

    private static func mime(_ extensionName: String) -> String {
        let types = [
            "txt": "text/plain", "md": "text/markdown", "csv": "text/csv", "json": "application/json",
            "html": "text/html", "pdf": "application/pdf", "png": "image/png", "jpg": "image/jpeg",
            "jpeg": "image/jpeg", "gif": "image/gif", "webp": "image/webp", "heic": "image/heic",
            "mp3": "audio/mpeg", "m4a": "audio/mp4", "wav": "audio/wav", "mp4": "video/mp4",
            "zip": "application/zip", "svg": "image/svg+xml"
        ]
        return types[extensionName.lowercased()] ?? "application/octet-stream"
    }
}
