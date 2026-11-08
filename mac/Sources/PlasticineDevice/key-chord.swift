import Foundation

// 助手进程的 key 方法（第 14 条）：「cmd+shift+4」「return」「escape」这样的写法解成一个虚拟键码加修饰键。
// 键码按 Apple 的 ANSI 键位（Events.h 的 kVK_*）；只认这里列出的名字，认不出就拒，不猜。
package enum KeyModifier: String, CaseIterable, Equatable {
    case command
    case shift
    case option
    case control
    case function
}

package struct KeyChord: Equatable {
    package let keyCode: UInt16
    package let modifiers: [KeyModifier]

    package init(keyCode: UInt16, modifiers: [KeyModifier]) {
        self.keyCode = keyCode
        self.modifiers = modifiers
    }

    private static let modifierNames: [String: KeyModifier] = [
        "cmd": .command, "command": .command, "⌘": .command,
        "shift": .shift, "⇧": .shift,
        "opt": .option, "option": .option, "alt": .option, "⌥": .option,
        "ctrl": .control, "control": .control, "⌃": .control,
        "fn": .function
    ]

    private static let namedKeys: [String: UInt16] = [
        "return": 36, "enter": 36, "tab": 48, "space": 49, "delete": 51, "backspace": 51, "escape": 53, "esc": 53,
        "forwarddelete": 117, "home": 115, "end": 119, "pageup": 116, "pagedown": 121,
        "left": 123, "right": 124, "down": 125, "up": 126,
        "f1": 122, "f2": 120, "f3": 99, "f4": 118, "f5": 96, "f6": 97, "f7": 98, "f8": 100,
        "f9": 101, "f10": 109, "f11": 103, "f12": 111
    ]

    private static let characterKeys: [Character: UInt16] = [
        "a": 0, "s": 1, "d": 2, "f": 3, "h": 4, "g": 5, "z": 6, "x": 7, "c": 8, "v": 9, "b": 11, "q": 12,
        "w": 13, "e": 14, "r": 15, "y": 16, "t": 17, "1": 18, "2": 19, "3": 20, "4": 21, "6": 22, "5": 23,
        "=": 24, "9": 25, "7": 26, "-": 27, "8": 28, "0": 29, "]": 30, "o": 31, "u": 32, "[": 33, "i": 34,
        "p": 35, "l": 37, "j": 38, "'": 39, "k": 40, ";": 41, "\\": 42, ",": 43, "/": 44, "n": 45, "m": 46,
        ".": 47, "`": 50
    ]

    /// 「cmd+shift+4」：最后一段是键，前面都是修饰键；大小写不分，空白忽略。
    package static func parse(_ text: String) throws -> KeyChord {
        let parts = text.lowercased().split(separator: "+", omittingEmptySubsequences: false)
            .map { $0.trimmingCharacters(in: .whitespaces) }
        guard let last = parts.last, !last.isEmpty, parts.dropLast().allSatisfy({ !$0.isEmpty }) else {
            throw DeviceFailure.refused("按键写法不对：写成 cmd+shift+4、return 这样")
        }
        var modifiers: [KeyModifier] = []
        for name in parts.dropLast() {
            guard let modifier = modifierNames[name] else {
                throw DeviceFailure.refused("认不出修饰键「\(name)」：只认 cmd、shift、option、control、fn")
            }
            if !modifiers.contains(modifier) { modifiers.append(modifier) }
        }
        if let code = namedKeys[last] { return KeyChord(keyCode: code, modifiers: modifiers) }
        if last.count == 1, let character = last.first, let code = characterKeys[character] {
            return KeyChord(keyCode: code, modifiers: modifiers)
        }
        throw DeviceFailure.refused("认不出按键「\(last)」：字母、数字、标点，或 return、tab、escape、方向键、f1–f12")
    }
}
