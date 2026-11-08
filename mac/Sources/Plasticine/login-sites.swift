import AppKit
import Foundation
import WebKit

// 这台 Mac 上 Plasticine 浏览器里登录着的网站、导入、退出（2026-11-04 第 3 批，协议见 agent/shared/api/mac-logins.ts）。
// 登录状态就是网页标签共用的那份持久数据存储里的 Cookie（WebTabs.dataStore）：在 Plasticine 的浏览器里登录一次就记住，
// 只在这台 Mac 上，不进服务器。「登录着」按 Cookie 认：同一个网站（可注册域名）有长期 Cookie，且名字像登录态（session、
// token、auth、sid……），或者是导入过的。导入的日子记在本机 UserDefaults（只记网站名和日子，不记 Cookie 的值）。
// 网页界面只拿到网站名、域名和日子。第 6 条（他 2026-11-05 定：全部不用钥匙串）：网站只记登录状态、不存密码，
// 协议里的 password 字段留着给旧网页对得上，一律回 false；以前存进钥匙串的密码不删，只是不再读写。
// 注意：这台机器没有 Xcode，这份第 3 批写的时候没能编译，等 GitHub macOS 机器上跑 swift build / swift test 和真 App。

@MainActor
final class LoginSites {
    private let store: WKWebsiteDataStore
    private static let importedKey = "plasticine.loginSites"
    private static let sessionName = try! NSRegularExpression(
        pattern: "sess|sid|token|auth|login|logged|user|uid|account|_t$|ct0|csrf|remember", options: [.caseInsensitive])
    /// 两级的公共后缀（这几个常见的中文、英文站点够用）：域名的主干往前多取一级。
    private static let twoLevelSuffixes: Set<String> = ["com.cn", "net.cn", "org.cn", "gov.cn", "edu.cn", "co.uk",
                                                        "co.jp", "com.hk", "com.tw", "com.au"]
    private static let sitesMax = 500

    init(store: WKWebsiteDataStore) {
        self.store = store
    }

    /// 一个域名属于哪个网站：去掉开头的点，取可注册域名（最后两级，两级公共后缀取三级）。
    nonisolated static func site(of host: String) -> String {
        let labels = host.lowercased().trimmingCharacters(in: CharacterSet(charactersIn: ".")).split(separator: ".")
        guard labels.count > 2 else { return labels.joined(separator: ".") }
        let lastTwo = labels.suffix(2).joined(separator: ".")
        return twoLevelSuffixes.contains(lastTwo) ? labels.suffix(3).joined(separator: ".") : lastTwo
    }

    private var imported: [String: String] {
        get { UserDefaults.standard.dictionary(forKey: LoginSites.importedKey) as? [String: String] ?? [:] }
        set { UserDefaults.standard.set(newValue, forKey: LoginSites.importedKey) }
    }

    func cookies() async -> [HTTPCookie] {
        await withCheckedContinuation { continuation in
            store.httpCookieStore.getAllCookies { continuation.resume(returning: $0) }
        }
    }

    /// 登录着的网站，按最近导入的在前、其余按名字。
    func list() async -> [[String: Any]] {
        let records = imported
        var sites = Set<String>()
        for cookie in await cookies() where cookie.expiresDate != nil {
            let name = cookie.name as NSString
            let looksLikeLogin = LoginSites.sessionName.firstMatch(in: cookie.name, range: NSRange(location: 0,
                                                                                                    length: name.length))
            if looksLikeLogin != nil || records[LoginSites.site(of: cookie.domain)] != nil {
                sites.insert(LoginSites.site(of: cookie.domain))
            }
        }
        let ordered = sites.sorted { left, right in
            let leftDay = records[left] ?? ""
            let rightDay = records[right] ?? ""
            return leftDay == rightDay ? left < right : leftDay > rightDay
        }
        return ordered.prefix(LoginSites.sitesMax).map { site in
            ["host": site, "name": LoginSites.displayName(site), "password": false,
             "since": records[site] ?? NSNull()] as [String: Any]
        }
    }

    /// 网站的名字：域名主干，首字母大写（github.com → Github）。
    nonisolated static func displayName(_ site: String) -> String {
        let stem = site.split(separator: ".").first.map(String.init) ?? site
        return String(stem.prefix(1)).uppercased() + stem.dropFirst()
    }

    /// 把搬来的 Cookie 放进 Plasticine 的浏览器，记下这些网站导入的日子；回放进去的条数和网站数。
    func adopt(_ cookies: [ChromeCookie]) async -> (cookies: Int, sites: Int) {
        let now = ISO8601DateFormatter().string(from: Date())
        var records = imported
        var sites = Set<String>()
        var count = 0
        for item in cookies {
            guard let cookie = ChromeImport.httpCookie(item) else { continue }
            await store.httpCookieStore.setCookie(cookie)
            count += 1
            sites.insert(LoginSites.site(of: item.domain))
        }
        for site in sites { records[site] = now }
        imported = records
        return (count, sites.count)
    }

    /// 退出一个网站：删掉它（含子域名）的 Cookie，忘掉导入记录。
    func forget(_ site: String) async {
        for cookie in await cookies() where LoginSites.site(of: cookie.domain) == site {
            await store.httpCookieStore.deleteCookie(cookie)
        }
        var records = imported
        records[site] = nil
        imported = records
    }
}

@MainActor
enum LoginImporter {
    static func sources() -> [[String: Any]] {
        let chrome: [String: Any] = ["id": "chrome", "available": ChromeProfile.available, "profile": "默认个人资料",
                                     "sites": ChromeImport.siteCount() ?? NSNull(), "needs": NSNull(),
                                     "passwords": false]
        let readable = SafariCookies.readable
        let safari: [String: Any] = ["id": "safari", "available": SafariCookies.installed, "profile": NSNull(),
                                     "sites": NSNull(), "needs": readable ? NSNull() as Any : "full_disk_access" as Any,
                                     "passwords": false]
        return [chrome, safari]
    }

    /// 导入一次登录状态（只导 Cookie，不导密码）；没导成也回一份结果，problem 写一句原因
    /// （他没允许读「Chrome Safe Storage」、没给完全磁盘访问……）。
    static func run(from source: String, sites: LoginSites) async -> [String: Any] {
        do {
            let read: (cookies: [ChromeCookie], skipped: Int)
            if source == "chrome" {
                read = try ChromeImport.cookies(key: try ChromeCrypto.storageKey())
            } else {
                read = try SafariCookies.read()
            }
            let adopted = await sites.adopt(read.cookies)
            return ["sites": adopted.sites, "cookies": adopted.cookies, "passwords": 0, "skipped": read.skipped,
                    "problem": NSNull()]
        } catch {
            // 原因只回给他看，不写日志（里面没有 Cookie 和密码，但这是他的本机隐私操作）。
            return ["sites": 0, "cookies": 0, "passwords": 0, "skipped": 0,
                    "problem": String(error.localizedDescription.prefix(300))]
        }
    }

    static func openFullDiskAccess() {
        let address = "x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles"
        if let url = URL(string: address) { NSWorkspace.shared.open(url) }
    }
}
