import Foundation
import Darwin

package struct PathPolicy {
    package let roots: [String]
    package var home: String

    package init(roots: [String], home: String = FileManager.default.homeDirectoryForCurrentUser.path) {
        self.roots = roots
        self.home = home
    }

    private func expand(_ raw: String) throws -> String {
        let expanded: String
        if raw == "~" { expanded = home }
        else if raw.hasPrefix("~/") { expanded = home + raw.dropFirst() }
        else { expanded = raw }
        guard expanded.hasPrefix("/"), !expanded.contains("\0") else {
            throw DeviceFailure.refused("路径必须是绝对路径或以 ~/ 开头")
        }
        return expanded
    }

    package func normalize(_ raw: String) throws -> URL {
        let expanded = try expand(raw)
        // Resolve each component before '..', including dangling links and nonexistent write targets.
        var remaining = expanded.split(separator: "/").map(String.init)
        var resolved = URL(fileURLWithPath: "/", isDirectory: true)
        var followed = 0
        while !remaining.isEmpty {
            let part = remaining.removeFirst()
            if part == "." { continue }
            if part == ".." {
                resolved.deleteLastPathComponent()
                continue
            }
            let candidate = resolved.appendingPathComponent(part)
            var metadata = stat()
            let found = candidate.path.withCString { lstat($0, &metadata) }
            if found != 0 {
                guard errno == ENOENT else { throw DeviceFailure.refused("无法核对路径，请检查目录访问权限") }
                resolved = candidate
                continue
            }
            if metadata.st_mode & mode_t(S_IFMT) == mode_t(S_IFLNK) {
                followed += 1
                guard followed <= 40 else { throw DeviceFailure.refused("路径包含循环符号链接") }
                let destination = try FileManager.default.destinationOfSymbolicLink(atPath: candidate.path)
                if destination.hasPrefix("/") { resolved = URL(fileURLWithPath: "/", isDirectory: true) }
                remaining = destination.split(separator: "/").map(String.init) + remaining
            } else {
                resolved = candidate
            }
        }
        return resolved
    }

    package func authorize(_ raw: String) throws -> URL {
        let target = try normalize(raw)
        for root in roots {
            let allowed = try normalize(root).path
            if allowed == "/" || target.path == allowed || target.path.hasPrefix(allowed + "/") {
                return target
            }
        }
        throw DeviceFailure.refused("不在授权目录内")
    }

    package func deletionEntry(_ raw: String) throws -> URL {
        let target = try authorize(raw)
        let expanded = try expand(raw) as NSString
        let name = expanded.lastPathComponent
        if name == "." || name == ".." || name.isEmpty { return target }
        // Authorize the resolved target, but move the link itself to Trash, not the file it points at.
        return try normalize(expanded.deletingLastPathComponent).appendingPathComponent(name)
    }
}
