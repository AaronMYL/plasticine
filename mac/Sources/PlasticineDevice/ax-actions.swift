import AppKit
import ApplicationServices

@MainActor
package final class AXActions {
    private var snapshots: [pid_t: (version: String, elements: [AXUIElement])] = [:]
    private static let elementsMax = 400
    private static let depthMax = 40
    private static let textMax = 200
    private static let textRoles: Set<String> = [
        "AXStaticText", "AXTextField", "AXTextArea", "AXComboBox", "AXSearchField", "AXHeading"
    ]

    package init() {}

    package func apps() throws -> JSONValue {
        let running = NSWorkspace.shared.runningApplications.filter { $0.activationPolicy == .regular }
        return .object(["apps": .array(running.map { app in
            .object(["pid": .number(Double(app.processIdentifier)), "name": .string(app.localizedName ?? ""),
                     "bundleId": .string(app.bundleIdentifier ?? ""), "active": .bool(app.isActive),
                     "hidden": .bool(app.isHidden)])
        })])
    }

    package func windows() throws -> JSONValue {
        try Self.requireAccessibility()
        var rows: [JSONValue] = []
        for app in NSWorkspace.shared.runningApplications where app.activationPolicy == .regular {
            let pid = app.processIdentifier
            for (index, window) in Self.windowElements(pid).enumerated() {
                let frame = Self.frame(window) ?? .zero
                rows.append(.object([
                    "id": .string("\(pid):\(index)"), "pid": .number(Double(pid)),
                    "app": .string(app.localizedName ?? ""), "title": .string(Self.text(window, kAXTitleAttribute)),
                    "minimized": .bool(Self.bool(window, kAXMinimizedAttribute)),
                    "x": .number(frame.minX), "y": .number(frame.minY),
                    "width": .number(frame.width), "height": .number(frame.height)
                ]))
            }
        }
        return .object(["windows": .array(rows)])
    }

    package func windowAct(_ id: String, op: String, x: Int?, y: Int?, width: Int?, height: Int?) throws -> JSONValue {
        try Self.requireAccessibility()
        let window = try Self.window(id)
        switch op {
        case "raise":
            AXUIElementPerformAction(window, kAXRaiseAction as CFString)
            if let pid = Int32(id.split(separator: ":").first ?? "") {
                NSRunningApplication(processIdentifier: pid)?.activate(options: [])
            }
        case "minimize": try Self.set(window, kAXMinimizedAttribute, kCFBooleanTrue)
        case "restore": try Self.set(window, kAXMinimizedAttribute, kCFBooleanFalse)
        case "close":
            guard let button = Self.attribute(window, kAXCloseButtonAttribute) else {
                throw DeviceFailure.failed("这个窗口没有关闭按钮。")
            }
            AXUIElementPerformAction(button as! AXUIElement, kAXPressAction as CFString)
        case "move":
            guard let x, let y else { throw HelperError(.invalidParams, "挪窗口要给 x 和 y") }
            var point = CGPoint(x: x, y: y)
            guard let value = AXValueCreate(.cgPoint, &point) else { throw DeviceFailure.failed("挪不了这个窗口。") }
            try Self.set(window, kAXPositionAttribute, value)
        case "resize":
            guard let width, let height else { throw HelperError(.invalidParams, "改大小要给 width 和 height") }
            var size = CGSize(width: width, height: height)
            guard let value = AXValueCreate(.cgSize, &size) else { throw DeviceFailure.failed("改不了这个窗口的大小。") }
            try Self.set(window, kAXSizeAttribute, value)
        default:
            throw HelperError(.invalidParams, "op 只能是 raise、minimize、restore、close、move、resize")
        }
        return .object(["window": .string(id)])
    }

    package func perceive(_ app: String) throws -> JSONValue {
        try Self.requireAccessibility()
        let running = try Self.application(app)
        let pid = running.processIdentifier
        let root = AXUIElementCreateApplication(pid)
        AXUIElementSetMessagingTimeout(root, 3)
        let windows = Self.windowElements(pid)
        let focused = Self.attribute(root, kAXFocusedWindowAttribute).map { $0 as! AXUIElement }
        let main = focused ?? windows.first
        guard let main else { throw DeviceFailure.failed("「\(running.localizedName ?? app)」没有开着的窗口。") }
        var elements: [AXUIElement] = []
        var rows: [JSONValue] = []
        var truncated = false
        var stack: [(AXUIElement, Int)] = [(main, 0)]
        while let next = stack.popLast() {
            let (element, depth) = next
            if elements.count >= Self.elementsMax {
                truncated = true
                break
            }
            let role = Self.text(element, kAXRoleAttribute)
            let actions = Self.actions(element)
            let title = Self.label(element)
            let value = Self.value(element)
            if !actions.isEmpty || (Self.textRoles.contains(role) && (!title.isEmpty || value != nil)) {
                elements.append(element)
                let frame = Self.frame(element) ?? .zero
                rows.append(.object([
                    "n": .number(Double(elements.count)), "role": .string(role), "title": .string(title),
                    "value": value.map(JSONValue.string) ?? .null,
                    "enabled": .bool(Self.attribute(element, kAXEnabledAttribute) as? Bool ?? true),
                    "focused": .bool(Self.bool(element, kAXFocusedAttribute)),
                    "actions": .array(actions.map(JSONValue.string)),
                    "x": .number(frame.minX), "y": .number(frame.minY),
                    "width": .number(frame.width), "height": .number(frame.height)
                ]))
            }
            if depth < Self.depthMax {
                for child in Self.children(element).reversed() {
                    stack.append((child, depth + 1))
                }
            }
        }
        let version = String(UUID().uuidString.prefix(8)).lowercased()
        snapshots[pid] = (version, elements)
        return .object([
            "app": .string(running.localizedName ?? app), "pid": .number(Double(pid)), "version": .string(version),
            "window": .string(Self.text(main, kAXTitleAttribute)), "elements": .array(rows),
            "truncated": .bool(truncated)
        ])
    }

    package func act(_ app: String, version: String, n: Int, op: String, text: String?) throws -> JSONValue {
        try Self.requireAccessibility()
        let pid = try Self.application(app).processIdentifier
        guard let snapshot = snapshots[pid], snapshot.version == version else { throw DeviceFailure.pageStale }
        guard n >= 1, n <= snapshot.elements.count else { throw DeviceFailure.pageStale }
        let element = snapshot.elements[n - 1]
        let action: String?
        switch op {
        case "press": action = kAXPressAction
        case "increment": action = kAXIncrementAction
        case "decrement": action = kAXDecrementAction
        case "menu": action = kAXShowMenuAction
        case "confirm": action = kAXConfirmAction
        case "cancel": action = kAXCancelAction
        case "show": action = "AXScrollToVisible"
        case "focus":
            try Self.set(element, kAXFocusedAttribute, kCFBooleanTrue)
            action = nil
        case "set":
            guard let text else { throw HelperError(.invalidParams, "set 要给 text") }
            try Self.set(element, kAXValueAttribute, text as CFString)
            action = nil
        default:
            throw HelperError(.invalidParams, "op 只能是 press、focus、set、increment、decrement、menu、confirm、cancel、show")
        }
        if let action {
            let result = AXUIElementPerformAction(element, action as CFString)
            guard result == .success else {
                if result == .invalidUIElement { throw DeviceFailure.pageStale }
                throw DeviceFailure.failed("这个元素不认「\(op)」（\(result.rawValue)）：换一个编号或别的做法。")
            }
        }
        snapshots[pid] = nil
        return .object(["done": .bool(true), "value": Self.value(element).map(JSONValue.string) ?? .null])
    }

    package func menu(_ app: String, press path: String?) throws -> JSONValue {
        try Self.requireAccessibility()
        let root = AXUIElementCreateApplication(try Self.application(app).processIdentifier)
        guard let bar = Self.attribute(root, kAXMenuBarAttribute) else {
            throw DeviceFailure.failed("这个应用没有菜单栏。")
        }
        let barElement = bar as! AXUIElement
        if let path {
            let names = path.components(separatedBy: ">").map { $0.trimmingCharacters(in: .whitespaces) }
            var current = barElement
            for (index, name) in names.enumerated() {
                let items = Self.menuItems(current)
                guard let item = items.first(where: { Self.text($0, kAXTitleAttribute) == name }) else {
                    throw DeviceFailure.failed("菜单里没有「\(name)」：先不带 path 列出来看看。")
                }
                if index == names.count - 1 {
                    guard AXUIElementPerformAction(item, kAXPressAction as CFString) == .success else {
                        throw DeviceFailure.failed("「\(path)」点不了（可能是灰的）。")
                    }
                } else {
                    current = item
                }
            }
            return .object(["items": .array([]), "pressed": .string(path)])
        }
        var rows: [JSONValue] = []
        func walk(_ element: AXUIElement, prefix: String, depth: Int) {
            for item in Self.menuItems(element) {
                let title = Self.text(item, kAXTitleAttribute)
                if title.isEmpty { continue }
                let full = prefix.isEmpty ? title : "\(prefix) > \(title)"
                let submenu = Self.menuItems(item)
                if submenu.isEmpty || depth >= 3 {
                    rows.append(.object(["path": .string(full),
                                         "enabled": .bool(Self.attribute(item, kAXEnabledAttribute) as? Bool ?? true)]))
                } else {
                    walk(item, prefix: full, depth: depth + 1)
                }
                if rows.count >= Self.elementsMax { return }
            }
        }
        walk(barElement, prefix: "", depth: 0)
        return .object(["items": .array(rows), "pressed": .null])
    }

    package static func windowInfo(_ id: String) throws -> (pid: pid_t, title: String, frame: CGRect) {
        let window = try window(id)
        let pid = pid_t(id.split(separator: ":").first ?? "") ?? 0
        return (pid, text(window, kAXTitleAttribute), frame(window) ?? .zero)
    }

    private static func requireAccessibility() throws {
        guard SystemAccess.accessibility else {
            SystemAccess.requestAccessibility()
            throw DeviceFailure.refused("需要辅助功能权限")
        }
    }

    private static func application(_ name: String) throws -> NSRunningApplication {
        let apps = NSWorkspace.shared.runningApplications.filter { $0.activationPolicy != .prohibited }
        if let pid = pid_t(name), let app = NSRunningApplication(processIdentifier: pid) { return app }
        let lower = name.lowercased()
        if let app = apps.first(where: { $0.bundleIdentifier?.lowercased() == lower
            || $0.localizedName?.lowercased() == lower }) { return app }
        if let app = apps.first(where: { $0.localizedName?.lowercased().contains(lower) == true }) { return app }
        throw DeviceFailure.failed("「\(name)」没有在运行：先用 open_in_app 或 app_open 打开它。")
    }

    private static func window(_ id: String) throws -> AXUIElement {
        let parts = id.split(separator: ":")
        guard parts.count == 2, let pid = pid_t(parts[0]), let index = Int(parts[1]) else {
            throw HelperError(.invalidParams, "窗口 id 是 window_list 回的「进程号:序号」")
        }
        let windows = windowElements(pid)
        guard index >= 0, index < windows.count else { throw DeviceFailure.failed("这个窗口不在了：重新 window_list。") }
        return windows[index]
    }

    private static func windowElements(_ pid: pid_t) -> [AXUIElement] {
        let app = AXUIElementCreateApplication(pid)
        AXUIElementSetMessagingTimeout(app, 2)
        return (attribute(app, kAXWindowsAttribute) as? [AXUIElement]) ?? []
    }

    private static func attribute(_ element: AXUIElement, _ name: String) -> AnyObject? {
        var value: AnyObject?
        return AXUIElementCopyAttributeValue(element, name as CFString, &value) == .success ? value : nil
    }

    private static func set(_ element: AXUIElement, _ name: String, _ value: AnyObject) throws {
        let result = AXUIElementSetAttributeValue(element, name as CFString, value)
        guard result == .success else {
            throw DeviceFailure.failed("改不了（\(name)，\(result.rawValue)）：这个元素可能不让改。")
        }
    }

    private static func text(_ element: AXUIElement, _ name: String) -> String {
        String((attribute(element, name) as? String ?? "").prefix(textMax))
    }

    private static func bool(_ element: AXUIElement, _ name: String) -> Bool {
        attribute(element, name) as? Bool ?? false
    }

    private static func label(_ element: AXUIElement) -> String {
        for name in [kAXTitleAttribute, kAXDescriptionAttribute, kAXHelpAttribute, "AXPlaceholderValue"] {
            let value = text(element, name)
            if !value.isEmpty { return value }
        }
        return ""
    }

    private static func value(_ element: AXUIElement) -> String? {
        guard let raw = attribute(element, kAXValueAttribute) else { return nil }
        if let string = raw as? String { return String(string.prefix(textMax)) }
        if let number = raw as? NSNumber { return number.stringValue }
        return nil
    }

    private static func actions(_ element: AXUIElement) -> [String] {
        var names: CFArray?
        guard AXUIElementCopyActionNames(element, &names) == .success, let list = names as? [String] else { return [] }
        return list.filter { !$0.hasPrefix("AXScroll") || $0 == "AXScrollToVisible" }
    }

    private static func children(_ element: AXUIElement) -> [AXUIElement] {
        (attribute(element, kAXChildrenAttribute) as? [AXUIElement]) ?? []
    }

    private static func menuItems(_ element: AXUIElement) -> [AXUIElement] {
        children(element).flatMap { child -> [AXUIElement] in
            let role = text(child, kAXRoleAttribute)
            return role == "AXMenu" ? children(child) : [child]
        }
    }

    private static func frame(_ element: AXUIElement) -> CGRect? {
        guard let position = attribute(element, kAXPositionAttribute), let size = attribute(element, kAXSizeAttribute),
              CFGetTypeID(position) == AXValueGetTypeID(), CFGetTypeID(size) == AXValueGetTypeID() else { return nil }
        var point = CGPoint.zero
        var extent = CGSize.zero
        AXValueGetValue(position as! AXValue, .cgPoint, &point)
        AXValueGetValue(size as! AXValue, .cgSize, &extent)
        return CGRect(origin: point, size: extent)
    }
}
