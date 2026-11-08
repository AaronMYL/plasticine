import AppKit

// 交通灯并进 Plasticine 顶栏（0.3.0，设计稿 2026-11-03）。网页第一次经 windowChrome.titlebar 报顶栏布局时，窗口换成
// fullSizeContentView + 透明标题栏 + 隐藏标题，交通灯挪到网页顶栏的竖直中线上；不报的旧网页照旧是系统标题栏。
// 顶栏空白处由原生拖窗口（WKWebView 不认 -webkit-app-region），双击按系统设置缩放或缩小。
@MainActor
final class WindowChrome {
    private unowned let window: NSWindow
    /// 页面缩放（CSS 像素 → 原生点），由主窗口给。
    var zoom: () -> CGFloat = { 1 }
    /// 告诉网页的外观变了（安全区、全屏）。
    var onChange: ((WindowChromeState) -> Void)?
    private(set) var fused = false
    private(set) var layout: TitlebarLayout?
    private var published: WindowChromeState?

    init(window: NSWindow) {
        self.window = window
        // 系统窗口标签页会在标题栏下面再长出一条标签栏，和 Plasticine 自己的标签打架。
        window.tabbingMode = .disallowed
        window.isMovableByWindowBackground = false
    }

    var fullScreen: Bool { window.styleMask.contains(.fullScreen) }

    /// 现在该告诉网页的外观。还没换外观时也按换了之后的算：网页第一次布局就留好安全区，换的时候不跳。
    var state: WindowChromeState {
        WindowChromeState.make(insetPoints: placement().inset, zoom: zoom(), fullScreen: fullScreen)
    }

    var dragZone: DragZone? {
        ChromeGeometry.dragZone(layout: layout, zoom: zoom(), fused: fused, fullScreen: fullScreen)
    }

    func apply(_ layout: TitlebarLayout) {
        self.layout = layout
        if !fused { fuse() }
        placeLights()
        publish()
    }

    /// 主网页换了一份文档（重新载入、换服务器）：旧的顶栏布局作废，等新页面再报；外观不换回去，免得每次刷新都闪。
    func documentChanged() {
        layout = nil
        placeLights()
    }

    /// 进出全屏、缩放、换屏之后：AppKit 会把交通灯摆回原位，再摆一次，并把变化告诉网页。
    func refresh() {
        placeLights()
        publish()
        // 有时 AppKit 在这一轮布局之后才摆标题栏，下一轮再摆一次。
        DispatchQueue.main.async { [weak self] in self?.placeLights() }
    }

    /// 顶栏空白处按下：双击按系统设置，单击拖窗口。
    func titlebarMouseDown(_ event: NSEvent) {
        guard event.clickCount == 2 else {
            window.performDrag(with: event)
            return
        }
        let global = UserDefaults.standard.persistentDomain(forName: UserDefaults.globalDomain) ?? [:]
        let action = TitlebarDoubleClick.action(
            setting: global["AppleActionOnDoubleClick"] as? String,
            legacyMinimize: global["AppleMiniaturizeOnDoubleClick"] as? Bool
        )
        switch action {
        case .zoom: window.zoom(nil)
        case .minimize: window.miniaturize(nil)
        case .none: break
        }
    }

    private func fuse() {
        fused = true
        window.styleMask.insert(.fullSizeContentView)
        window.titlebarAppearsTransparent = true
        window.titleVisibility = .hidden
    }

    private var buttons: [NSButton] {
        let kinds: [NSWindow.ButtonType] = [.closeButton, .miniaturizeButton, .zoomButton]
        return kinds.compactMap { window.standardWindowButton($0) }
    }

    private func placement() -> TrafficLightPlacement {
        let height = TrafficLights.titlebarHeight(layout: layout, zoom: zoom())
        let all = buttons
        guard all.count == 3 else {
            return TrafficLights.place(buttonSize: CGSize(width: 14, height: 16), spacing: TrafficLights.defaultSpacing,
                                       titlebarHeight: height)
        }
        let measured = all[1].frame.minX - all[0].frame.maxX
        let spacing = measured > 0 ? measured : TrafficLights.defaultSpacing
        return TrafficLights.place(buttonSize: all[0].frame.size, spacing: spacing, titlebarHeight: height)
    }

    /// 把交通灯所在的标题栏容器撑到网页顶栏那么高、按钮上下留白相等（Electron 的 trafficLightPosition 也是这么做的）。
    /// 全屏时交通灯归系统管，不动。
    private func placeLights() {
        guard fused, !fullScreen else { return }
        let all = buttons
        guard all.count == 3, let container = all[0].superview?.superview else { return }
        let placed = placement()
        var frame = container.frame
        frame.size.height = placed.containerHeight
        frame.origin.y = window.frame.height - placed.containerHeight
        container.frame = frame
        for (button, origin) in zip(all, placed.origins) { button.setFrameOrigin(origin) }
    }

    private func publish() {
        let next = state
        guard next != published else { return }
        published = next
        onChange?(next)
    }
}
