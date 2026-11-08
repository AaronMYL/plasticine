import CoreGraphics
import Foundation

// 窗口外观（0.3.0，设计稿 2026-11-03「需要原生配合」）：交通灯并进 Plasticine 自己的顶栏，网页标签垫在主网页下面。
// 和 agent/shared/api/mac-bridge.ts 的 WindowChrome / TitlebarLayout / WebTabsSync.hitRegions 对照。这里只放不碰
// AppKit 的纯逻辑：解析网页报来的顶栏布局、交通灯摆在哪、安全区多宽、一次点击该交给谁、双击标题栏按系统设置做什么、
// 拖放换目标，方便 XCTest。坐标一律左上为原点（容器视图是 flipped），CSS 像素乘页面缩放得原生点。

struct TitlebarLayout: Decodable, Equatable {
    let height: Double
    let noDrag: [WebTabFrame]
}

enum WindowChromeError: Error, Equatable {
    case malformed(String)
}

enum WindowChromeMessage {
    // 和 mac-bridge.ts TitlebarLayoutSchema 的 noDrag maxItems 一致。
    static let maxNoDrag = 200
    // 顶栏不会比这更高（CSS 像素）：再高是网页算错了，不拿它把交通灯挪到窗口中间去。
    static let maxHeight = 400.0

    private struct Envelope: Decodable {
        let type: String
        let layout: TitlebarLayout?
    }

    /// 网页经 `plasticineChrome` 发来的一条消息（目前只有 titlebar）；形状不对一律拒，不猜。
    static func parse(_ body: Any) throws -> TitlebarLayout {
        guard JSONSerialization.isValidJSONObject(body) else { throw WindowChromeError.malformed("不是对象") }
        let envelope: Envelope
        do {
            envelope = try JSONDecoder().decode(Envelope.self, from: JSONSerialization.data(withJSONObject: body))
        } catch { throw WindowChromeError.malformed("字段不对") }
        guard envelope.type == "titlebar", let layout = envelope.layout else {
            throw WindowChromeError.malformed("不认识的消息")
        }
        guard layout.height.isFinite, layout.height >= 0, layout.height <= maxHeight else {
            throw WindowChromeError.malformed("顶栏高度不对")
        }
        guard layout.noDrag.count <= maxNoDrag, layout.noDrag.allSatisfy(ChromeGeometry.wellFormed) else {
            throw WindowChromeError.malformed("不可拖动的矩形不对")
        }
        return layout
    }
}

/// 告诉网页的窗口外观（mac-bridge.ts WindowChrome）：顶栏最左边要让出多宽（CSS 像素），是否全屏。
struct WindowChromeState: Equatable {
    let trafficLightInset: Double
    let fullScreen: Bool

    // 和 mac-bridge.ts WindowChromeSchema 的 trafficLightInset maximum 一致。
    static let maxInset = 200.0

    static func make(insetPoints: CGFloat, zoom: CGFloat, fullScreen: Bool) -> WindowChromeState {
        // 全屏时交通灯藏进菜单栏那一条里，顶栏不用让。
        if fullScreen { return WindowChromeState(trafficLightInset: 0, fullScreen: true) }
        let scale = zoom > 0 ? zoom : 1
        let css = (Double(insetPoints) / Double(scale)).rounded()
        return WindowChromeState(trafficLightInset: min(max(css, 0), maxInset), fullScreen: false)
    }

    var json: [String: Any] { ["trafficLightInset": trafficLightInset, "fullScreen": fullScreen] }
}

struct TrafficLightPlacement: Equatable {
    /// 标题栏容器（交通灯所在那一条）的高度；按钮上下留白相等，所以容器是不是 flipped 都一样。
    let containerHeight: CGFloat
    /// 关闭、缩小、放大三个按钮的原点（在它们父视图的坐标里）。
    let origins: [CGPoint]
    /// 从窗口左边到最后一个按钮右边再加一点间隙：网页顶栏要让出的宽度（原生点）。
    let inset: CGFloat
}

enum TrafficLights {
    // 设计稿：交通灯左边距 20 左右，竖直中线对齐网页顶栏中线。
    static let leading: CGFloat = 20
    // 按钮 14 宽、间隔 6 时安全区正好是 mac-bridge.ts 的 TRAFFIC_LIGHT_INSET_DEFAULT（78）。
    static let trailingGap: CGFloat = 4
    // 系统量不出按钮间隔时用的默认值（macOS 14 起标题栏按钮间隔 6 点）。
    static let defaultSpacing: CGFloat = 6
    // mac-bridge.ts 的 TITLEBAR_HEIGHT：网页还没报顶栏时按这个高度摆交通灯。
    static let defaultTitlebarCSS = 44.0

    static func place(buttonSize: CGSize, spacing: CGFloat, titlebarHeight: CGFloat,
                      count: Int = 3) -> TrafficLightPlacement {
        let margin = max(0, ((titlebarHeight - buttonSize.height) / 2).rounded(.down))
        let step = buttonSize.width + spacing
        let origins = (0..<count).map { index in
            CGPoint(x: leading + CGFloat(index) * step, y: margin)
        }
        let inset = leading + CGFloat(count) * buttonSize.width + CGFloat(max(count - 1, 0)) * spacing + trailingGap
        return TrafficLightPlacement(containerHeight: buttonSize.height + 2 * margin, origins: origins, inset: inset)
    }

    static func titlebarHeight(layout: TitlebarLayout?, zoom: CGFloat) -> CGFloat {
        CGFloat(layout?.height ?? defaultTitlebarCSS) * zoom
    }
}

struct DragZone: Equatable {
    /// 顶栏高度（原生点）：它以内、不落在 noDrag 里的地方拖窗口。
    let height: CGFloat
    let noDrag: [CGRect]
}

enum ChromeGeometry {
    static func wellFormed(_ frame: WebTabFrame) -> Bool {
        [frame.x, frame.y, frame.width, frame.height].allSatisfy(\.isFinite) && frame.width >= 0 && frame.height >= 0
    }

    /// 网页报来的 CSS 像素矩形换成原生点；空的、不合法的丢掉。
    static func scaled(_ frames: [WebTabFrame], zoom: CGFloat) -> [CGRect] {
        guard zoom > 0 else { return [] }
        return frames.compactMap { frame in
            guard wellFormed(frame), frame.width > 0, frame.height > 0 else { return nil }
            return CGRect(x: frame.x * zoom, y: frame.y * zoom, width: frame.width * zoom, height: frame.height * zoom)
        }
    }

    /// 只有窗口换成了无标题栏外观、网页报过顶栏、不在全屏时才有拖窗口区；否则系统标题栏自己管拖动。
    static func dragZone(layout: TitlebarLayout?, zoom: CGFloat, fused: Bool, fullScreen: Bool) -> DragZone? {
        guard fused, !fullScreen, let layout, zoom > 0 else { return nil }
        return DragZone(height: CGFloat(layout.height) * zoom, noDrag: scaled(layout.noDrag, zoom: zoom))
    }
}

enum ChromeHitTarget: Equatable {
    case main
    case tab
    case drag
}

enum ChromeHitRouter {
    /// 一次鼠标事件（点、滚轮、右键、拖放）交给谁。依次：网页报来的浮层（对话框、圆球、菜单、弹层）给主网页；
    /// 顶栏空白处拖窗口；网页标签那一块给网页标签；其余给主网页。
    static func route(_ point: CGPoint, drag: DragZone?, tab: CGRect?, hitRegions: [CGRect]) -> ChromeHitTarget {
        if hitRegions.contains(where: { $0.contains(point) }) { return .main }
        if let drag, point.y >= 0, point.y < drag.height, !drag.noDrag.contains(where: { $0.contains(point) }) {
            return .drag
        }
        if let tab, tab.contains(point) { return .tab }
        return .main
    }
}

enum TitlebarDoubleClick: Equatable {
    case zoom
    case minimize
    case none

    /// 系统设置「连按窗口标题栏以」：全局域 AppleActionOnDoubleClick（Maximize / Minimize / None，较新系统还有
    /// Fill）；老系统只有 AppleMiniaturizeOnDoubleClick。没设过时系统默认是缩放。Fill 没有公开接口，按缩放做。
    static func action(setting: String?, legacyMinimize: Bool?) -> TitlebarDoubleClick {
        switch setting {
        case "Minimize": return .minimize
        case "None": return .none
        case nil: return legacyMinimize == true ? .minimize : .zoom
        default: return .zoom
        }
    }
}

struct DropTransition: Equatable {
    let exit: ChromeHitTarget?
    let enter: ChromeHitTarget?
}

enum DropRouting {
    /// 拖着东西从一块挪到另一块：先让旧的那个网页收到「离开」，再让新的收到「进入」。
    static func transition(from previous: ChromeHitTarget?, to next: ChromeHitTarget?) -> DropTransition {
        if previous == next { return DropTransition(exit: nil, enter: nil) }
        return DropTransition(exit: previous, enter: next)
    }
}

enum WebTabLayering: Equatable {
    /// 0.3.0 起：网页标签垫在主网页下面，主网页透明，对话框等浮层盖在网页上。
    case underMain
    /// 旧网页界面（同步里没有 hitRegions，网页那一块还画着底色）：照 0.2.x 叠在主网页上面，不然网页被盖住看不见。
    case overMain

    static func of(_ sync: WebTabsSync) -> WebTabLayering { sync.hitRegions == nil ? .overMain : .underMain }
}
