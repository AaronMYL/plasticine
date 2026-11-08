import Foundation

// 从 Safari 搬一次 Cookie（2026-11-04 第 3 批，他定；只在他点「导入」时在本机做）。Safari 的 Cookie 在
// ~/Library/Containers/com.apple.Safari/Data/Library/Cookies/Cookies.binarycookies，要 Plasticine 有「完全磁盘访问」才读得到：
// 读不到就如实说，网页界面给一个打开系统设置的按钮。Safari 的密码在系统「密码」App / iCloud 钥匙串里，第三方 App
// 读不到，所以 Safari 只导 Cookie。
// binarycookies 的格式（Apple 没公开，按通行的读法）：文件头 "cook"、页数和每页大小（大端）；每页 0x00000100、
// 条数、各条偏移（小端）；每条：大小、标志（1 secure、4 HttpOnly）、域名 / 名字 / 路径 / 值的偏移，偏移 40 起
// 是过期时间（小端 double，从 2001-01-01 起的秒数）。读不懂的页和条目跳过并计数。
// 注意：这台机器没有 Xcode，这份第 3 批写的时候没能编译，等 GitHub macOS 机器上跑 swift build / swift test 和真 App。

enum SafariCookies {
    static var file: URL {
        FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent("Library/Containers/com.apple.Safari/Data/Library/Cookies/Cookies.binarycookies")
    }

    /// 能不能读到：读不到多半是没给完全磁盘访问。
    static var readable: Bool {
        (try? FileHandle(forReadingFrom: file).close()) != nil
    }

    static var installed: Bool {
        FileManager.default.fileExists(atPath: "/Applications/Safari.app")
    }

    static func read() throws -> (cookies: [ChromeCookie], skipped: Int) {
        let data: Data
        do {
            data = try Data(contentsOf: file)
        } catch {
            throw DeviceFailure.refused("读不到 Safari 的 Cookie：要在系统设置里给 Plasticine「完全磁盘访问」。")
        }
        return try parse(data, now: Date())
    }

    static func parse(_ data: Data, now: Date) throws -> (cookies: [ChromeCookie], skipped: Int) {
        let bytes = [UInt8](data)
        guard bytes.count >= 8, Array(bytes[0..<4]) == Array("cook".utf8) else {
            throw DeviceFailure.failed("Safari 的 Cookie 文件格式和预想的不一样，没能读。")
        }
        let pages = Int(big(bytes, 4))
        var sizes: [Int] = []
        for index in 0..<pages {
            guard 8 + index * 4 + 4 <= bytes.count else { break }
            sizes.append(Int(big(bytes, 8 + index * 4)))
        }
        var offset = 8 + pages * 4
        var found: [ChromeCookie] = []
        var skipped = 0
        for size in sizes {
            guard offset + size <= bytes.count else { break }
            let page = Array(bytes[offset..<(offset + size)])
            offset += size
            guard page.count >= 8 else { continue }
            let count = Int(little(page, 4))
            for index in 0..<count {
                guard 8 + index * 4 + 4 <= page.count else { break }
                let start = Int(little(page, 8 + index * 4))
                if let cookie = record(page, start), cookie.expires.map({ $0 > now }) ?? true {
                    found.append(cookie)
                } else {
                    skipped += 1
                }
            }
        }
        return (found, skipped)
    }

    private static func record(_ page: [UInt8], _ start: Int) -> ChromeCookie? {
        guard start + 48 <= page.count else { return nil }
        let size = Int(little(page, start))
        guard size >= 48, start + size <= page.count else { return nil }
        let flags = little(page, start + 8)
        let text = { (field: Int) -> String? in
            let at = start + Int(little(page, start + field))
            guard at < start + size, let end = page[at..<(start + size)].firstIndex(of: 0) else { return nil }
            return String(bytes: page[at..<end], encoding: .utf8)
        }
        guard let domain = text(16), let name = text(20), let path = text(24), let value = text(28) else { return nil }
        let seconds = littleDouble(page, start + 40)
        let expires = seconds > 0 ? Date(timeIntervalSinceReferenceDate: seconds) : nil
        return ChromeCookie(domain: domain, name: name, value: value, path: path, expires: expires,
                            secure: flags & 1 != 0, httpOnly: flags & 4 != 0, sameSite: -1)
    }

    private static func big(_ bytes: [UInt8], _ at: Int) -> UInt32 {
        bytes[at..<(at + 4)].reduce(0) { ($0 << 8) | UInt32($1) }
    }

    private static func little(_ bytes: [UInt8], _ at: Int) -> UInt32 {
        bytes[at..<(at + 4)].reversed().reduce(0) { ($0 << 8) | UInt32($1) }
    }

    private static func littleDouble(_ bytes: [UInt8], _ at: Int) -> Double {
        let raw = bytes[at..<(at + 8)].reversed().reduce(UInt64(0)) { ($0 << 8) | UInt64($1) }
        return Double(bitPattern: raw)
    }
}
