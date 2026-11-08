import Foundation
import XCTest
@testable import Plasticine

final class SelfUpdateTests: XCTestCase {
    func test带服务包时本机和远程实例都按服务版本读公开清单() throws {
        let bundled = BundledServerManifest(version: "2026.1106.010101",
                                            releaseUrl: "https://cyberhunter.top/download")
        let remote = try ServerAddress.parse("https://instance.example/")
        let manifest = try ReleaseSource.manifestURL(bundled.releaseUrl)
        for server in [LocalServerAddress.url, remote] {
            let source = try SelfUpdateSource.resolve(bundled: bundled, appVersion: "0.7.3", server: server)
            XCTAssertEqual(source, .release(current: bundled.version, manifest: manifest))
        }
    }

    func test无服务包的旧安装保留原节点地址和App版本基准() throws {
        let remote = try ServerAddress.parse("https://instance.example/")
        XCTAssertEqual(try SelfUpdateSource.resolve(bundled: nil, appVersion: "0.7.3", server: remote),
                       .node(current: "0.7.3", server: remote))
    }

    func test带服务包但发布来源无效时失败不降回节点来源() throws {
        let remote = try ServerAddress.parse("https://instance.example/")
        for bundled in [
            BundledServerManifest(version: "bad-version", releaseUrl: "https://cyberhunter.top/download"),
            BundledServerManifest(version: "2026.1106.010101", releaseUrl: "http://cyberhunter.top/download"),
        ] {
            XCTAssertThrowsError(try SelfUpdateSource.resolve(bundled: bundled, appVersion: "0.7.3", server: remote))
        }
    }

    func test版本比较按点分数字() {
        XCTAssertTrue(AppVersion.isNewer("0.2.0", than: "0.1.9"))
        XCTAssertTrue(AppVersion.isNewer("0.1.10", than: "0.1.9"))
        XCTAssertTrue(AppVersion.isNewer("1.0", than: "0.9.9"))
        XCTAssertFalse(AppVersion.isNewer("0.1.0", than: "0.1.0"))
        XCTAssertFalse(AppVersion.isNewer("0.1.0", than: "0.2.0"))
        XCTAssertTrue(AppVersion.isNewer("2026.1106.010101", than: "2026.1105.093012"))
        for invalid in ["", "v9.0", "1..2", "2.0beta", "1.2.3.4.5"] {
            XCTAssertFalse(AppVersion.isNewer(invalid, than: "0.1.0"))
        }
    }

    func test元数据只接受同源HTTPS与合法校验值() throws {
        let server = try ServerAddress.parse("https://203.0.113.10/")
        let ok = try meta(url: "https://203.0.113.10/files/Plasticine-0.2.0.zip")
        XCTAssertEqual(try ok.downloadURL(server: server).absoluteString,
                       "https://203.0.113.10/files/Plasticine-0.2.0.zip")
        XCTAssertThrowsError(try meta(url: "https://evil.example.com/x.zip").downloadURL(server: server))
        XCTAssertThrowsError(try meta(url: "http://203.0.113.10/x.zip").downloadURL(server: server))
        XCTAssertThrowsError(try meta(url: "https://203.0.113.10/x.zip", sha: "zz")
            .downloadURL(server: server))
        XCTAssertThrowsError(try meta(url: "https://user:password@203.0.113.10/x.zip")
            .downloadURL(server: server))
        XCTAssertThrowsError(try meta(url: "https://203.0.113.10/x.zip", version: "1..2")
            .downloadURL(server: server))
    }

    func test在解压目录里定位嵌套的App() throws {
        let base = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        let nested = base.appendingPathComponent("payload/Plasticine.app/Contents")
        try FileManager.default.createDirectory(at: nested, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: base) }
        let found = try SelfUpdateInstaller.locateApp(in: base)
        XCTAssertEqual(found?.lastPathComponent, "Plasticine.app")
    }

    func test解压目录里没有App返回空() throws {
        let base = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: base.appendingPathComponent("payload"),
                                                withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: base) }
        XCTAssertNil(try SelfUpdateInstaller.locateApp(in: base))
    }

    func test只清自更新留下的备份() throws {
        let base = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        let apps = base.appendingPathComponent("Applications")
        let previous = base.appendingPathComponent("上一版")
        let manager = FileManager.default
        for name in ["Plasticine.app", "Plasticine-backup-20261103-231825-37316.app",
                     "Plasticine-backup-20261102-120000-250.app", "Plasticine Notes.app", "Other.app"] {
            try manager.createDirectory(at: apps.appendingPathComponent(name), withIntermediateDirectories: true)
        }
        try manager.createDirectory(at: previous.appendingPathComponent("Plasticine-20261103-231825.app"),
                                    withIntermediateDirectories: true)
        defer { try? manager.removeItem(at: base) }
        let removed = SelfUpdateInstaller.removeLeftoverBackups(besides: apps.appendingPathComponent("Plasticine.app"),
                                                                previous: previous)
        XCTAssertEqual(removed, 3)
        let left = try manager.contentsOfDirectory(atPath: apps.path).sorted()
        XCTAssertEqual(left, ["Other.app", "Plasticine Notes.app", "Plasticine.app"])
        XCTAssertEqual(try manager.contentsOfDirectory(atPath: previous.path), [])
    }

    // 11-05：更新只换 Contents，Plasticine.app 文件夹本身（Dock 认的文件 ID）不变；备份带「只换 Contents」记号。
    func test更新只换Contents文件夹不变() throws {
        let manager = FileManager.default
        let base = manager.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? manager.removeItem(at: base) }
        let current = try makeApp(base.appendingPathComponent("Applications/Plasticine.app"), version: "old")
        let fresh = try makeApp(base.appendingPathComponent("unpacked/Plasticine.app"), version: "new")
        let backups = base.appendingPathComponent("上一版")
        try manager.createDirectory(at: backups, withIntermediateDirectories: true)
        let before = try fileNumber(current)
        var registered: [URL] = []
        try SelfUpdateInstaller.swap(newApp: fresh, current: current, backupFolder: backups) { registered.append($0) }
        XCTAssertEqual(try fileNumber(current), before)
        XCTAssertEqual(try version(current), "new")
        XCTAssertEqual(registered, [current])
        let backup = try XCTUnwrap(try manager.contentsOfDirectory(at: backups, includingPropertiesForKeys: nil).first)
        XCTAssertEqual(try version(backup), "old")
        XCTAssertTrue(manager.fileExists(atPath: backup.appendingPathComponent(DockReattach.marker).path))
        // 带记号的备份不接回。
        XCTAssertFalse(DockReattach.reattach(app: current, previous: backups) { _ in })
    }

    // 旧安装器把整包挪去「上一版」：新版启动时把 Dock 认的旧文件夹接回原路径，里面换成新版。
    func test旧安装器挪走的文件夹接回原路径() throws {
        let manager = FileManager.default
        let base = manager.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? manager.removeItem(at: base) }
        let backups = base.appendingPathComponent("上一版")
        let old = try makeApp(backups.appendingPathComponent("Plasticine-20261105-090000.app"), version: "old")
        let dockTarget = try fileNumber(old)
        let app = try makeApp(base.appendingPathComponent("Applications/Plasticine.app"), version: "new")
        XCTAssertTrue(DockReattach.reattach(app: app, previous: backups) { _ in })
        XCTAssertEqual(try fileNumber(app), dockTarget)
        XCTAssertEqual(try version(app), "new")
        XCTAssertFalse(manager.fileExists(atPath: app.appendingPathComponent("Contents.previous").path))
        XCTAssertEqual(try manager.contentsOfDirectory(atPath: backups.path), [])
    }

    private func makeApp(_ url: URL, version: String) throws -> URL {
        let contents = url.appendingPathComponent("Contents")
        try FileManager.default.createDirectory(at: contents, withIntermediateDirectories: true)
        try Data(version.utf8).write(to: contents.appendingPathComponent("version.txt"))
        return url
    }

    private func version(_ app: URL) throws -> String {
        String(decoding: try Data(contentsOf: app.appendingPathComponent("Contents/version.txt")), as: UTF8.self)
    }

    private func fileNumber(_ url: URL) throws -> Int {
        let attributes = try FileManager.default.attributesOfItem(atPath: url.path)
        return try XCTUnwrap((attributes[.systemFileNumber] as? NSNumber)?.intValue)
    }

    private func meta(url: String, sha: String = String(repeating: "a", count: 64),
                      version: String = "0.2.0") throws -> UpdateMetadata {
        let value = JSONValue.object(["version": .string(version), "sha256": .string(sha), "url": .string(url)])
        return try JSONDecoder().decode(UpdateMetadata.self, from: JSONEncoder().encode(value))
    }
}
