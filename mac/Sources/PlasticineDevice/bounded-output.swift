import Foundation

package struct BoundedOutput {
    package let limit: Int
    package private(set) var data = Data()
    private var droppedBytes = false

    package init(limit: Int) {
        self.limit = limit
    }

    package var truncated: Bool { droppedBytes || String(decoding: data, as: UTF8.self).utf8.count > limit }

    package mutating func append(_ chunk: Data) {
        let remaining = max(0, limit - data.count)
        data.append(chunk.prefix(remaining))
        droppedBytes = droppedBytes || chunk.count > remaining
    }

    package var text: String {
        // Replacement characters can expand invalid byte sequences; cap the encoded result as well.
        let decoded = String(decoding: data, as: UTF8.self)
        var bytes = Data(decoded.utf8.prefix(limit))
        while String(data: bytes, encoding: .utf8) == nil {
            bytes.removeLast()
        }
        return String(decoding: bytes, as: UTF8.self)
    }
}
