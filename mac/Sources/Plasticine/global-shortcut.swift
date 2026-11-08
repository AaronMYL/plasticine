import AppKit
import Carbon

struct Shortcut: Codable {
    let keyCode: UInt32
    let modifiers: UInt32
    let label: String

    static let standard = Shortcut(keyCode: UInt32(kVK_Space), modifiers: UInt32(optionKey), label: "⌥Space")

    static func from(_ event: NSEvent) -> Shortcut? {
        let flags = event.modifierFlags.intersection(.deviceIndependentFlagsMask)
        guard !flags.intersection([.command, .option, .control]).isEmpty else { return nil }
        var carbon: UInt32 = 0
        var label = ""
        if flags.contains(.control) {
            carbon |= UInt32(controlKey)
            label += "⌃"
        }
        if flags.contains(.option) {
            carbon |= UInt32(optionKey)
            label += "⌥"
        }
        if flags.contains(.shift) {
            carbon |= UInt32(shiftKey)
            label += "⇧"
        }
        if flags.contains(.command) {
            carbon |= UInt32(cmdKey)
            label += "⌘"
        }
        let key = event.keyCode == UInt16(kVK_Space) ? "Space" : (event.charactersIgnoringModifiers ?? "").uppercased()
        guard !key.isEmpty else { return nil }
        return Shortcut(keyCode: UInt32(event.keyCode), modifiers: carbon, label: label + key)
    }
}

@MainActor
final class GlobalShortcut {
    private var hotKey: EventHotKeyRef?
    private var handler: EventHandlerRef?
    var onPress: (() -> Void)?

    func register(_ shortcut: Shortcut) throws {
        if handler == nil {
            var type = EventTypeSpec(eventClass: OSType(kEventClassKeyboard), eventKind: UInt32(kEventHotKeyPressed))
            let context = Unmanaged.passUnretained(self).toOpaque()
            let status = InstallEventHandler(GetApplicationEventTarget(), { _, _, context in
                guard let context else { return OSStatus(eventNotHandledErr) }
                let owner = Unmanaged<GlobalShortcut>.fromOpaque(context).takeUnretainedValue()
                Task { @MainActor in owner.onPress?() }
                return noErr
            }, 1, &type, context, &handler)
            guard status == noErr else { throw DeviceFailure.failed("全局快捷键初始化失败，请重新打开 App。") }
        }
        if let hotKey {
            UnregisterEventHotKey(hotKey)
            self.hotKey = nil
        }
        let identity = EventHotKeyID(signature: 0x504C5354, id: 1)
        let status = RegisterEventHotKey(
            shortcut.keyCode, shortcut.modifiers, identity, GetApplicationEventTarget(), 0, &hotKey
        )
        guard status == noErr else { throw DeviceFailure.failed("快捷键已被占用，请在设置中选择别的组合。") }
    }

    func close() {
        if let hotKey {
            UnregisterEventHotKey(hotKey)
            self.hotKey = nil
        }
        if let handler {
            RemoveEventHandler(handler)
            self.handler = nil
        }
    }
}

final class ShortcutField: NSTextField {
    var onRecord: ((Shortcut) -> Void)?

    override func performKeyEquivalent(with event: NSEvent) -> Bool {
        guard currentEditor() != nil, let shortcut = Shortcut.from(event) else {
            return super.performKeyEquivalent(with: event)
        }
        onRecord?(shortcut)
        return true
    }

    override func keyDown(with event: NSEvent) {
        if let shortcut = Shortcut.from(event) { onRecord?(shortcut) }
        else { super.keyDown(with: event) }
    }
}
