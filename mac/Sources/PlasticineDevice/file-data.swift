import Foundation

package enum FileData {
    package static func read(_ path: URL, limit: Int = AppConstants.fileBytes) throws -> Data {
        let values = try path.resourceValues(forKeys: [.isRegularFileKey, .fileSizeKey])
        guard values.isRegularFile == true else { throw DeviceFailure.refused("只能读取普通文件") }
        guard (values.fileSize ?? 0) <= limit else { throw DeviceFailure.refused("文件超过 10 MB") }
        let handle = try FileHandle(forReadingFrom: path)
        var data = Data()
        do {
            while data.count <= limit {
                try Task.checkCancellation()
                let chunk = try handle.read(upToCount: min(64 * 1024, limit + 1 - data.count)) ?? Data()
                if chunk.isEmpty { break }
                data.append(chunk)
            }
        } catch {
            try handle.close()
            throw error
        }
        try handle.close()
        guard data.count <= limit else { throw DeviceFailure.refused("文件超过 10 MB") }
        return data
    }
}
