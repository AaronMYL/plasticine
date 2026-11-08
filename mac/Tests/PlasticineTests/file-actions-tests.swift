import Foundation
import XCTest
@testable import Plasticine

final class FileActionsTests: XCTestCase {
    func test文件写入比较版本且新建不覆盖旧文件() async throws {
        let base = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: base, withIntermediateDirectories: true)
        defer { try! FileManager.default.removeItem(at: base) }
        let path = base.appendingPathComponent("笔记.txt")
        let files = FileActions()
        let first = try params(path: path.path, content: "第一版", version: nil)
        _ = try await files.execute(first, roots: [base.path])
        XCTAssertEqual(try String(contentsOf: path, encoding: .utf8), "第一版")
        do {
            _ = try await files.execute(first, roots: [base.path])
            XCTFail("已有文件不能按新文件覆盖")
        } catch DeviceFailure.refused(let message) {
            XCTAssertEqual(message, "文件已被改过")
        }
        let version = Digest.hex(Data("第一版".utf8))
        let second = try params(path: path.path, content: "第二版", version: version)
        _ = try await files.execute(second, roots: [base.path])
        XCTAssertEqual(try String(contentsOf: path, encoding: .utf8), "第二版")
        do {
            _ = try await files.execute(second, roots: [base.path])
            XCTFail("过期版本不能覆盖")
        } catch DeviceFailure.refused(let message) {
            XCTAssertEqual(message, "文件已被改过")
        }
    }

    func test文件快照不接受目录或超过大小上限的文件() throws {
        let base = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: base, withIntermediateDirectories: true)
        defer { try! FileManager.default.removeItem(at: base) }
        let file = base.appendingPathComponent("bytes")
        try Data([0, 1, 2, 3, 4]).write(to: file)
        XCTAssertThrowsError(try FileData.read(file, limit: 4))
        XCTAssertThrowsError(try FileData.read(base))
        XCTAssertEqual(try FileData.read(file, limit: 5), Data([0, 1, 2, 3, 4]))
    }

    private func params(path: String, content: String, version: String?) throws -> ActionParams {
        let value = JSONValue.object([
            "kind": .string("file_write"), "path": .string(path), "content": .string(content),
            "baseVersion": version.map(JSONValue.string) ?? .null
        ])
        let params = try JSONDecoder().decode(ActionParams.self, from: JSONEncoder().encode(value))
        try params.validate()
        return params
    }
}
