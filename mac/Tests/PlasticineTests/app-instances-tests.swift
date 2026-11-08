import Foundation
import XCTest
@testable import Plasticine

// 第 5 条：新版启动时找出要结束的旧实例。

final class AppInstancesTests: XCTestCase {
    private let bundle = "com.plasticine.app"

    func test只结束同一bundle里比自己先启动的其他实例() {
        let now = Date()
        let running = [
            RunningInstance(pid: 100, bundleID: bundle, launched: now),
            RunningInstance(pid: 90, bundleID: bundle, launched: now.addingTimeInterval(-3600)),
            RunningInstance(pid: 80, bundleID: bundle, launched: nil),
            RunningInstance(pid: 110, bundleID: bundle, launched: now.addingTimeInterval(5)),
            RunningInstance(pid: 70, bundleID: "com.other.app", launched: now.addingTimeInterval(-60)),
        ]
        XCTAssertEqual(SingleInstance.stale(running, bundleID: bundle, ownPID: 100, ownLaunch: now), [90, 80])
    }

    func test只有自己时什么都不结束() {
        let mine = RunningInstance(pid: 42, bundleID: bundle, launched: Date())
        XCTAssertEqual(SingleInstance.stale([mine], bundleID: bundle, ownPID: 42, ownLaunch: Date()), [])
    }

    func test子进程号逐行读_跳过读不懂的和1以下的() {
        XCTAssertEqual(SingleInstance.parsePIDs("123\n 456 \nabc\n\n1\n0\n"), [123, 456])
        XCTAssertEqual(SingleInstance.parsePIDs(""), [])
    }
}
