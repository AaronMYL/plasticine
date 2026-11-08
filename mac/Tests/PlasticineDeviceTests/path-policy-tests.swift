import Foundation
import XCTest
import Darwin
@testable import PlasticineDevice

final class PathPolicyTests: XCTestCase {
    func test路径按目录边界匹配并展开家目录() throws {
        let policy = PathPolicy(roots: ["~/Documents"], home: "/Users/test")
        XCTAssertEqual(try policy.authorize("~/Documents/a.txt").path, "/Users/test/Documents/a.txt")
        XCTAssertThrowsError(try policy.authorize("~/Documents-old/a.txt"))
        XCTAssertThrowsError(try policy.authorize("~/Documents/../../outside"))
        XCTAssertThrowsError(try policy.authorize("relative.txt"))
        XCTAssertThrowsError(try policy.authorize("~someone/file"))
        XCTAssertThrowsError(try PathPolicy(roots: [], home: "/Users/test").authorize("~/a"))
    }

    func test符号链接和不存在的子路径不能逃出授权目录() throws {
        let base = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        let inside = base.appendingPathComponent("inside")
        let outside = base.appendingPathComponent("outside")
        try FileManager.default.createDirectory(at: inside, withIntermediateDirectories: true)
        try FileManager.default.createDirectory(at: outside, withIntermediateDirectories: true)
        defer { try! FileManager.default.removeItem(at: base) }
        try FileManager.default.createSymbolicLink(
            at: inside.appendingPathComponent("link"), withDestinationURL: outside
        )
        let policy = PathPolicy(roots: [inside.path])
        XCTAssertThrowsError(try policy.authorize(inside.appendingPathComponent("link/new/file").path))
        XCTAssertEqual(try policy.authorize(inside.appendingPathComponent("new").path).lastPathComponent, "new")
        try FileManager.default.createSymbolicLink(
            at: inside.appendingPathComponent("dangling"), withDestinationURL: outside.appendingPathComponent("missing")
        )
        XCTAssertThrowsError(try policy.authorize(inside.appendingPathComponent("dangling/new").path))
        XCTAssertThrowsError(try policy.authorize(inside.appendingPathComponent("link/../outside/file").path))
        let localLink = inside.appendingPathComponent("local-link")
        let localTarget = inside.appendingPathComponent("target")
        try Data().write(to: localTarget)
        try FileManager.default.createSymbolicLink(at: localLink, withDestinationURL: localTarget)
        // macOS 的临时目录在 /var 下，/var 是指向 /private/var 的链接；resolvingSymlinksInPath 会把 /private 去掉，
        // 授权按 realpath 判，所以期望值也用 realpath 算。
        let resolved = realpath(inside.path, nil)!
        defer { free(resolved) }
        XCTAssertEqual(try policy.deletionEntry(localLink.path).path, String(cString: resolved) + "/local-link")
    }
}
