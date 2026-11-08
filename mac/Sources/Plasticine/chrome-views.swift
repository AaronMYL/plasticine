import AppKit
import WebKit

// 主窗口内容（0.3.0）：从下到上是网页标签层（WebTabHost）、Plasticine 主网页（透明）、只认拖放的一层（DropRouterView）。
// 一次鼠标事件交给谁由 ChromeHitRouter 定（window-chrome-geometry.swift）：浮层给主网页、顶栏空白拖窗口、网页标签区
// 给网页标签、其余给主网页。点、滚轮、右键、手势都走 hitTest；鼠标移动、拖放 AppKit 不走 hitTest，分别在下面另做。

/// 主网页和网页标签共用的 WKWebView。
final class RoutedWebView: WKWebView {
    /// 窗口坐标里的这一点归不归自己。两层网页上下叠着、各有覆盖全身的跟踪区，鼠标移动两边都收；只让该收的那个收，
    /// 光标和悬停才不打架。
    var accepts: ((NSPoint) -> Bool)?

    // 透明的 WKWebView 默认会被当成「可以拖窗口」的背景；拖窗口由 ChromeContainerView 按网页报的顶栏自己做。
    override var mouseDownCanMoveWindow: Bool { false }

    override func mouseMoved(with event: NSEvent) {
        if let accepts, !accepts(event.locationInWindow) { return }
        super.mouseMoved(with: event)
    }
}

/// 主窗口的内容视图：按 ChromeHitRouter 把鼠标事件分给主网页、网页标签，顶栏空白处自己收下来拖窗口。
final class ChromeContainerView: NSView {
    weak var mainView: NSView?
    weak var tabLayer: NSView?
    /// 容器坐标（左上为原点）里的这一点交给谁。
    var route: ((NSPoint) -> ChromeHitTarget)?
    /// 顶栏空白处按下：拖窗口或双击缩放。
    var onTitlebarMouseDown: ((NSEvent) -> Void)?

    override var isFlipped: Bool { true }
    override var mouseDownCanMoveWindow: Bool { false }
    // 窗口不在前时也能直接拖，和系统标题栏一样。
    override func acceptsFirstMouse(for event: NSEvent?) -> Bool { true }

    override func hitTest(_ point: NSPoint) -> NSView? {
        let local = convert(point, from: superview)
        guard bounds.contains(local), let route, let mainView else { return super.hitTest(point) }
        switch route(local) {
        case .drag:
            return self
        case .tab:
            // 网页标签层只认它的子视图（网页）；落在缝里（四舍五入差一点）就还给主网页。
            return tabLayer?.hitTest(local) ?? mainView.hitTest(local)
        case .main:
            return mainView.hitTest(local)
        }
    }

    override func mouseDown(with event: NSEvent) {
        if let onTitlebarMouseDown { onTitlebarMouseDown(event) } else { super.mouseDown(with: event) }
    }
}

/// 拖放按同一套规则分：AppKit 找拖放目标看的是谁登记了这种类型、谁在上面，不问 hitTest，所以最上面盖一层只认拖放的
/// 透明视图，把每一步转给该收的那个网页；换了目标就先让旧的「离开」再让新的「进入」。
final class DropRouterView: NSView {
    /// 窗口坐标里的这一点该交给哪一块，以及那一块的视图；nil 表示谁都不收（例如顶栏拖窗口区）。
    var target: ((NSPoint) -> (ChromeHitTarget, NSView)?)?
    private var current: (ChromeHitTarget, NSView)?

    override var isFlipped: Bool { true }

    // 不收点击：点击照常由 ChromeContainerView 分。
    override func hitTest(_ point: NSPoint) -> NSView? { nil }

    override func draggingEntered(_ sender: NSDraggingInfo) -> NSDragOperation { retarget(sender) }

    override func draggingUpdated(_ sender: NSDraggingInfo) -> NSDragOperation { retarget(sender) }

    override func draggingExited(_ sender: NSDraggingInfo?) {
        if let view = current?.1, view.responds(to: #selector(NSDraggingDestination.draggingExited(_:))) {
            view.draggingExited(sender)
        }
        current = nil
    }

    override func prepareForDragOperation(_ sender: NSDraggingInfo) -> Bool {
        guard let view = current?.1 else { return false }
        guard view.responds(to: #selector(NSDraggingDestination.prepareForDragOperation(_:))) else { return true }
        return view.prepareForDragOperation(sender)
    }

    override func performDragOperation(_ sender: NSDraggingInfo) -> Bool {
        guard let view = current?.1,
              view.responds(to: #selector(NSDraggingDestination.performDragOperation(_:))) else { return false }
        return view.performDragOperation(sender)
    }

    override func concludeDragOperation(_ sender: NSDraggingInfo?) {
        if let view = current?.1, view.responds(to: #selector(NSDraggingDestination.concludeDragOperation(_:))) {
            view.concludeDragOperation(sender)
        }
        current = nil
    }

    override func draggingEnded(_ sender: NSDraggingInfo) {
        if let view = current?.1, view.responds(to: #selector(NSDraggingDestination.draggingEnded(_:))) {
            view.draggingEnded(sender)
        }
        current = nil
    }

    private func retarget(_ sender: NSDraggingInfo) -> NSDragOperation {
        let next = target?(sender.draggingLocation)
        let step = DropRouting.transition(from: current?.0, to: next?.0)
        if step.exit != nil, let old = current?.1,
           old.responds(to: #selector(NSDraggingDestination.draggingExited(_:))) {
            old.draggingExited(sender)
        }
        // 同一块但视图换了（切了网页标签）也要重新进入。
        let sameView = current?.1 === next?.1
        current = next
        guard let view = next?.1 else { return [] }
        if step.enter != nil || !sameView {
            guard view.responds(to: #selector(NSDraggingDestination.draggingEntered(_:))) else { return [] }
            return view.draggingEntered(sender)
        }
        guard view.responds(to: #selector(NSDraggingDestination.draggingUpdated(_:))) else { return [] }
        return view.draggingUpdated(sender)
    }
}
