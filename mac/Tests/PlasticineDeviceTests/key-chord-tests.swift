import XCTest
@testable import PlasticineDevice

final class KeyChordTests: XCTestCase {
    func test组合键拆成键码和修饰键() throws {
        XCTAssertEqual(try KeyChord.parse("cmd+shift+4"), KeyChord(keyCode: 21, modifiers: [.command, .shift]))
        XCTAssertEqual(try KeyChord.parse(" Return "), KeyChord(keyCode: 36, modifiers: []))
        XCTAssertEqual(try KeyChord.parse("ctrl+alt+Left"), KeyChord(keyCode: 123, modifiers: [.control, .option]))
        XCTAssertEqual(try KeyChord.parse("⌘+c"), KeyChord(keyCode: 8, modifiers: [.command]))
        XCTAssertEqual(try KeyChord.parse("cmd+cmd+f12"), KeyChord(keyCode: 111, modifiers: [.command]))
    }

    func test认不出的写法拒绝不猜() {
        for text in ["", "cmd+", "+a", "hyper+a", "cmd+中", "f13", "cmd++"] {
            XCTAssertThrowsError(try KeyChord.parse(text), text)
        }
    }
}
