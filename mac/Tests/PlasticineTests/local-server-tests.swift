import Foundation
import XCTest
@testable import Plasticine

final class LocalServerTests: XCTestCase {
    func test第一次启动的模式() {
        XCTAssertEqual(ServerMode.initial(hasBundledServer: true, hasPriorInstall: false), .thisMac)
        XCTAssertEqual(ServerMode.initial(hasBundledServer: true, hasPriorInstall: true), .remote)
        XCTAssertEqual(ServerMode.initial(hasBundledServer: false, hasPriorInstall: false), .remote)
        XCTAssertEqual(ServerMode.initial(hasBundledServer: false, hasPriorInstall: true), .remote)
    }

    func test本机地址是127点0点0点1的8790() {
        XCTAssertEqual(LocalServerAddress.url.absoluteString, "http://127.0.0.1:8790/")
        let page = URL(string: "http://127.0.0.1:8790/#/today")!
        XCTAssertTrue(ServerAddress.sameOrigin(page, LocalServerAddress.url))
        XCTAssertFalse(ServerAddress.sameOrigin(URL(string: "http://127.0.0.1:8791/")!, LocalServerAddress.url))
    }

    func test崩溃重启按1到30秒退避_稳定一分钟后归零() {
        var backoff = RestartBackoff()
        let delays = (0..<8).map { _ in backoff.next(ranFor: 1) }
        XCTAssertEqual(delays, [1, 2, 4, 8, 16, 30, 30, 30])
        XCTAssertEqual(backoff.next(ranFor: 61), 1)
        XCTAssertEqual(backoff.next(ranFor: 1), 2)
    }

    func test服务进程的环境只带安装包设置和几样系统变量() {
        let environment = LocalServerEnvironment.make(
            serverDirectory: URL(fileURLWithPath: "/Applications/Plasticine.app/Contents/Resources/server"),
            stateDirectory: URL(fileURLWithPath: "/Users/a/Library/Application Support/Plasticine/server"),
            port: 8790, base: ["HOME": "/Users/a", "SECRET_TOKEN": "x", "LANG": "zh_CN.UTF-8"]
        )
        XCTAssertEqual(environment["PLASTICINE_STATE"], "/Users/a/Library/Application Support/Plasticine/server")
        XCTAssertEqual(environment["PLASTICINE_CLIENT_DIR"],
                       "/Applications/Plasticine.app/Contents/Resources/server/client/dist")
        XCTAssertEqual(environment["PLASTICINE_PORT"], "8790")
        XCTAssertEqual(environment["PLASTICINE_PLAIN_HTTP"], "1")
        XCTAssertEqual(environment["PLASTICINE_STOP_ON_STDIN_EOF"], "1")
        XCTAssertEqual(environment["PLASTICINE_DRY_RUN"], "0")
        XCTAssertNil(environment["PLASTICINE_SELF_CODE"])
        XCTAssertEqual(environment["HOME"], "/Users/a")
        XCTAssertNil(environment["SECRET_TOKEN"])
    }

    func test读App带的服务包清单() throws {
        let json = #"{"schema":1,"name":"plasticine-server","version":"2026.1105.093012","#
            + #""releaseUrl":"https://cyberhunter.top/download","excluded":[]}"#
        let manifest = try JSONDecoder().decode(BundledServerManifest.self, from: Data(json.utf8))
        XCTAssertEqual(manifest.version, "2026.1105.093012")
        XCTAssertTrue(AppVersion.isNewer("2026.1106.000000", than: manifest.version))
        XCTAssertFalse(AppVersion.isNewer("2026.0105.000000", than: manifest.version))
    }

    func test发布清单只认HTTPS和合法校验值() throws {
        let manifestURL = try ReleaseSource.manifestURL("https://cyberhunter.top/download")
        XCTAssertEqual(manifestURL.absoluteString, "https://cyberhunter.top/download/manifest.json")
        XCTAssertThrowsError(try ReleaseSource.manifestURL("http://cyberhunter.top/download"))
        let json = #"{"schema":1,"commit":"\#(String(repeating: "c", count: 40))","version":"2026.1106.000000","#
            + #""assets":{"server":{"name":"s","url":"s","sha256":"#
            + #""\#(String(repeating: "a", count: 64))","size":1},"mac":{"name":"Plasticine-mac.zip","#
            + #""url":"Plasticine-mac.zip","sha256":"\#(String(repeating: "b", count: 64))","size":42}}}"#
        let release = try ReleaseSource.decodeManifest(Data(json.utf8))
        let asset = try XCTUnwrap(release.assets.mac)
        XCTAssertEqual(try ReleaseSource.assetURL(asset, manifest: manifestURL).absoluteString,
                       "https://cyberhunter.top/download/Plasticine-mac.zip")
        let insecure = ReleaseAsset(name: "x", url: "http://evil.example/x.zip", sha256: asset.sha256, size: 1)
        XCTAssertThrowsError(try ReleaseSource.assetURL(insecure, manifest: manifestURL))
        let badSum = ReleaseAsset(name: "x", url: "x.zip", sha256: "zz", size: 1)
        XCTAssertThrowsError(try ReleaseSource.assetURL(badSum, manifest: manifestURL))
        let credentials = ReleaseAsset(name: "x", url: "https://user:password@example.com/x.zip",
                                       sha256: asset.sha256, size: 1)
        XCTAssertThrowsError(try ReleaseSource.assetURL(credentials, manifest: manifestURL))
        for invalid in [json.replacingOccurrences(of: #""schema":1"#, with: #""schema":2"#),
                        json.replacingOccurrences(of: String(repeating: "c", count: 40), with: "main"),
                        json.replacingOccurrences(of: "2026.1106.000000", with: "0.7.3")] {
            XCTAssertThrowsError(try ReleaseSource.decodeManifest(Data(invalid.utf8)))
        }
    }

    func test一步回退换回上一版_再回退又回来() throws {
        let manager = FileManager.default
        let base = manager.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? manager.removeItem(at: base) }
        let current = base.appendingPathComponent("Applications/Plasticine.app")
        let previous = base.appendingPathComponent("上一版")
        try writeApp(current, marker: "新版")
        try writeApp(previous.appendingPathComponent("Plasticine-20261105-120000.app"), marker: "旧版")
        try SelfUpdateInstaller.rollback(current: current, backupFolder: previous, register: { _ in })
        XCTAssertEqual(try marker(current), "旧版")
        let backup = try XCTUnwrap(SelfUpdateInstaller.latestBackup(in: previous))
        XCTAssertEqual(try marker(backup), "新版")
        try SelfUpdateInstaller.rollback(current: current, backupFolder: previous, register: { _ in })
        XCTAssertEqual(try marker(current), "新版")
    }

    func test没有上一版时回退报错() throws {
        let base = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: base) }
        let current = base.appendingPathComponent("Plasticine.app")
        try writeApp(current, marker: "新版")
        let empty = base.appendingPathComponent("上一版")
        try FileManager.default.createDirectory(at: empty, withIntermediateDirectories: true)
        XCTAssertThrowsError(try SelfUpdateInstaller.rollback(current: current, backupFolder: empty,
                                                              register: { _ in }))
        XCTAssertEqual(try marker(current), "新版")
    }

    func test这台Mac模式启动后留着上一版() throws {
        let manager = FileManager.default
        let base = manager.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? manager.removeItem(at: base) }
        let apps = base.appendingPathComponent("Applications")
        let previous = base.appendingPathComponent("上一版")
        try manager.createDirectory(at: apps.appendingPathComponent("Plasticine.app"),
                                    withIntermediateDirectories: true)
        try writeApp(previous.appendingPathComponent("Plasticine-20261105-120000.app"), marker: "旧版")
        SelfUpdateInstaller.removeLeftoverBackups(besides: apps.appendingPathComponent("Plasticine.app"),
                                                  previous: previous, keepPrevious: true)
        XCTAssertNotNil(SelfUpdateInstaller.latestBackup(in: previous))
    }

    private func writeApp(_ app: URL, marker: String) throws {
        let contents = app.appendingPathComponent("Contents")
        try FileManager.default.createDirectory(at: contents, withIntermediateDirectories: true)
        try Data(marker.utf8).write(to: contents.appendingPathComponent("marker"))
    }

    private func marker(_ app: URL) throws -> String {
        String(decoding: try Data(contentsOf: app.appendingPathComponent("Contents/marker")), as: UTF8.self)
    }
}
