import Foundation
import XCTest
@testable import Plasticine

final class DeviceLaneTests: XCTestCase {
    private func params(_ value: JSONValue) throws -> ActionParams {
        let decoded = try JSONDecoder().decode(ActionParams.self, from: JSONEncoder().encode(value))
        try decoded.validate()
        return decoded
    }

    func test付款页面与卡号一律关死() throws {
        let open = try params(.object(["kind": .string("browser_open"),
                                       "url": .string("https://checkout.stripe.com/pay/abc")]))
        XCTAssertEqual(DeviceLanePolicy.classify(open, inSettingsApp: false), .deny)
        let order = try params(.object(["kind": .string("browser_open"),
                                        "url": .string("https://shop.example.com/checkout")]))
        XCTAssertEqual(DeviceLanePolicy.classify(order, inSettingsApp: false), .deny)
        // 4111 1111 1111 1111 过 Luhn，像银行卡号。
        let card = try params(.object(["kind": .string("input_type"), "text": .string("4111 1111 1111 1111")]))
        XCTAssertEqual(DeviceLanePolicy.classify(card, inSettingsApp: false), .deny)
    }

    func test命令里带付款入口关死() throws {
        let scheme = try params(.object(["kind": .string("run_command"), "cwd": .string("~"),
                                         "command": .string("open 'alipay://pay?x=1'")]))
        XCTAssertEqual(DeviceLanePolicy.classify(scheme, inSettingsApp: false), .deny)
        let link = try params(.object(["kind": .string("run_command"), "cwd": .string("~"),
                                       "command": .string("open https://pay.weixin.qq.com/x")]))
        XCTAssertEqual(DeviceLanePolicy.classify(link, inSettingsApp: false), .deny)
    }

    func test钥匙串与密码库路径要你点() throws {
        for path in ["~/.ssh/id_rsa", "~/Library/Keychains/login.keychain-db",
                     "~/Library/Application Support/Google/Chrome/Default/Login Data"] {
            let read = try params(.object(["kind": .string("file_read"), "path": .string(path)]))
            XCTAssertEqual(DeviceLanePolicy.classify(read, inSettingsApp: false), .confirm,
                           "\(path) 应当要你点一次")
        }
        let normal = try params(.object(["kind": .string("file_read"), "path": .string("~/笔记/今天.md")]))
        XCTAssertEqual(DeviceLanePolicy.classify(normal, inSettingsApp: false), .allow)
    }

    func test读密码或改系统设置的命令要你点() throws {
        for command in ["security find-generic-password -s wifi", "sudo rm -rf /tmp/x",
                        "defaults write com.apple.dock tilesize 48", "tccutil reset All"] {
            let run = try params(.object(["kind": .string("run_command"), "cwd": .string("~"),
                                          "command": .string(command)]))
            XCTAssertEqual(DeviceLanePolicy.classify(run, inSettingsApp: false), .confirm, command)
        }
        let plain = try params(.object(["kind": .string("run_command"), "cwd": .string("~"),
                                        "command": .string("ls -la")]))
        XCTAssertEqual(DeviceLanePolicy.classify(plain, inSettingsApp: false), .allow)
    }

    func test打开系统设置或在其中点击要你点() throws {
        let app = try params(.object(["kind": .string("app_open"), "app": .string("System Settings")]))
        XCTAssertEqual(DeviceLanePolicy.classify(app, inSettingsApp: false), .confirm)
        let keychain = try params(.object(["kind": .string("app_open"),
                                           "app": .string("com.apple.keychainaccess")]))
        XCTAssertEqual(DeviceLanePolicy.classify(keychain, inSettingsApp: false), .confirm)
        let click = try params(.object(["kind": .string("input_click"), "x": .number(10), "y": .number(20)]))
        XCTAssertEqual(DeviceLanePolicy.classify(click, inSettingsApp: true), .confirm)
        XCTAssertEqual(DeviceLanePolicy.classify(click, inSettingsApp: false), .allow)
    }

    func test系统设置应用判别() {
        XCTAssertTrue(DeviceLanePolicy.isSettingsApp("com.apple.systempreferences"))
        XCTAssertTrue(DeviceLanePolicy.isSettingsApp("系统设置"))
        XCTAssertTrue(DeviceLanePolicy.isSettingsApp("Keychain Access"))
        XCTAssertFalse(DeviceLanePolicy.isSettingsApp("com.apple.Safari"))
    }
}
