import CoreGraphics
import Foundation
import XCTest
@testable import Plasticine

// 0.3.0：交通灯并进 Plasticine 顶栏、网页标签垫在主网页下面。纯逻辑：顶栏布局消息、交通灯位置与安全区、
// 拖窗口区、一次点击交给谁、双击标题栏按系统设置、拖放换目标、网页标签同步里的 hitRegions。
final class WindowChromeTests: XCTestCase {
    private let button = CGSize(width: 14, height: 16)

    private func titlebar(_ layout: [String: Any]) -> [String: Any] { ["type": "titlebar", "layout": layout] }

    func test顶栏布局按协议解析_形状不对一律拒() throws {
        let rect: [String: Any] = ["x": 90, "y": 6, "width": 160, "height": 32]
        let layout = try WindowChromeMessage.parse(titlebar(["height": 44, "noDrag": [rect]]))
        XCTAssertEqual(layout.height, 44)
        XCTAssertEqual(layout.noDrag, [WebTabFrame(x: 90, y: 6, width: 160, height: 32)])
        let none: [Any] = []
        XCTAssertEqual(try WindowChromeMessage.parse(titlebar(["height": 0, "noDrag": none])).noDrag, [])
        XCTAssertThrowsError(try WindowChromeMessage.parse(["type": "titlebar"]))
        let eval: [String: Any] = ["type": "eval", "layout": ["height": 1, "noDrag": none] as [String: Any]]
        XCTAssertThrowsError(try WindowChromeMessage.parse(eval))
        XCTAssertThrowsError(try WindowChromeMessage.parse(titlebar(["height": -1, "noDrag": none])))
        XCTAssertThrowsError(try WindowChromeMessage.parse(titlebar(["height": 5_000, "noDrag": none])))
        let tooMany = Array(repeating: rect, count: WindowChromeMessage.maxNoDrag + 1)
        XCTAssertThrowsError(try WindowChromeMessage.parse(titlebar(["height": 44, "noDrag": tooMany])))
        let negative: [String: Any] = ["x": 0, "y": 0, "width": -3, "height": 1]
        XCTAssertThrowsError(try WindowChromeMessage.parse(titlebar(["height": 44, "noDrag": [negative]])))
    }

    func test交通灯竖直居中在顶栏_左边距20_默认安全区78() {
        let placed = TrafficLights.place(buttonSize: button, spacing: 6, titlebarHeight: 44)
        XCTAssertEqual(placed.containerHeight, 44)
        XCTAssertEqual(placed.origins, [CGPoint(x: 20, y: 14), CGPoint(x: 40, y: 14), CGPoint(x: 60, y: 14)])
        XCTAssertEqual(placed.inset, 78)
        // 顶栏高度是奇数时按整点往下取，容器高度跟着取成对称的，按钮不落在半个点上。
        let odd = TrafficLights.place(buttonSize: button, spacing: 6, titlebarHeight: 45)
        XCTAssertEqual(odd.origins.first?.y, 14)
        XCTAssertEqual(odd.containerHeight, 44)
        // 顶栏比按钮还矮（网页报 0）：贴着上沿放，不出负数。
        let flat = TrafficLights.place(buttonSize: button, spacing: 6, titlebarHeight: 0)
        XCTAssertEqual(flat.origins.first?.y, 0)
        XCTAssertEqual(flat.containerHeight, 16)
    }

    func test顶栏高度按页面缩放换成原生点_没报时用设计稿的44() {
        let layout = TitlebarLayout(height: 40, noDrag: [])
        XCTAssertEqual(TrafficLights.titlebarHeight(layout: layout, zoom: 1.25), 50)
        XCTAssertEqual(TrafficLights.titlebarHeight(layout: nil, zoom: 1), 44)
        XCTAssertEqual(TrafficLights.titlebarHeight(layout: nil, zoom: 2), 88)
    }

    func test告诉网页的安全区按CSS像素_全屏归零_有上限() {
        XCTAssertEqual(WindowChromeState.make(insetPoints: 78, zoom: 1, fullScreen: false),
                       WindowChromeState(trafficLightInset: 78, fullScreen: false))
        XCTAssertEqual(WindowChromeState.make(insetPoints: 78, zoom: 1.25, fullScreen: false).trafficLightInset, 62)
        XCTAssertEqual(WindowChromeState.make(insetPoints: 78, zoom: 1, fullScreen: true),
                       WindowChromeState(trafficLightInset: 0, fullScreen: true))
        XCTAssertEqual(WindowChromeState.make(insetPoints: 900, zoom: 1, fullScreen: false).trafficLightInset, 200)
        XCTAssertEqual(WindowChromeState.make(insetPoints: 78, zoom: 0, fullScreen: false).trafficLightInset, 78)
        let json = WindowChromeState(trafficLightInset: 78, fullScreen: false).json
        XCTAssertEqual(json["trafficLightInset"] as? Double, 78)
        XCTAssertEqual(json["fullScreen"] as? Bool, false)
    }

    func test拖窗口区_只在换成无标题栏外观且报了顶栏之后_全屏不拖() {
        let layout = TitlebarLayout(height: 44, noDrag: [WebTabFrame(x: 90, y: 6, width: 160, height: 32)])
        let zone = ChromeGeometry.dragZone(layout: layout, zoom: 1.5, fused: true, fullScreen: false)
        XCTAssertEqual(zone, DragZone(height: 66, noDrag: [CGRect(x: 135, y: 9, width: 240, height: 48)]))
        XCTAssertNil(ChromeGeometry.dragZone(layout: layout, zoom: 1, fused: false, fullScreen: false))
        XCTAssertNil(ChromeGeometry.dragZone(layout: layout, zoom: 1, fused: true, fullScreen: true))
        XCTAssertNil(ChromeGeometry.dragZone(layout: nil, zoom: 1, fused: true, fullScreen: false))
        XCTAssertNil(ChromeGeometry.dragZone(layout: layout, zoom: 0, fused: true, fullScreen: false))
    }

    func test浮层矩形按缩放换成原生点_不合法的丢掉() {
        let rects = ChromeGeometry.scaled([
            WebTabFrame(x: 900, y: 300, width: 400, height: 500),
            WebTabFrame(x: 0, y: 0, width: 0, height: 10),
            WebTabFrame(x: .nan, y: 0, width: 10, height: 10),
        ], zoom: 2)
        XCTAssertEqual(rects, [CGRect(x: 1800, y: 600, width: 800, height: 1000)])
        XCTAssertEqual(ChromeGeometry.scaled([WebTabFrame(x: 1, y: 1, width: 1, height: 1)], zoom: 0), [])
    }

    func test一次点击交给谁_浮层优先_顶栏空白拖窗口_网页标签区给网页() {
        let zone = DragZone(height: 44, noDrag: [CGRect(x: 90, y: 6, width: 160, height: 32)])
        let tab = CGRect(x: 240, y: 44, width: 960, height: 756)
        let dialog = CGRect(x: 800, y: 300, width: 380, height: 480)
        let route = { (point: CGPoint) in
            ChromeHitRouter.route(point, drag: zone, tab: tab, hitRegions: [dialog])
        }
        XCTAssertEqual(route(CGPoint(x: 500, y: 20)), .drag)
        XCTAssertEqual(route(CGPoint(x: 100, y: 20)), .main, "标签、按钮不拖")
        XCTAssertEqual(route(CGPoint(x: 600, y: 400)), .tab)
        XCTAssertEqual(route(CGPoint(x: 900, y: 400)), .main, "对话框盖在网页上")
        XCTAssertEqual(route(CGPoint(x: 100, y: 400)), .main, "侧栏")
        XCTAssertEqual(route(CGPoint(x: 240, y: 44)), .tab, "左上角那一点算网页标签")
        XCTAssertEqual(route(CGPoint(x: 1200, y: 400)), .main, "右边界外不算")
        // 浮层伸进顶栏（拖对话框拖到最上面）：浮层优先于拖窗口。
        let high = CGRect(x: 400, y: 0, width: 200, height: 200)
        XCTAssertEqual(ChromeHitRouter.route(CGPoint(x: 500, y: 20), drag: zone, tab: tab, hitRegions: [high]), .main)
        // 没有在前的网页标签、没报顶栏：全给主网页。
        XCTAssertEqual(ChromeHitRouter.route(CGPoint(x: 600, y: 10), drag: nil, tab: nil, hitRegions: []), .main)
    }

    func test双击标题栏按系统设置() {
        XCTAssertEqual(TitlebarDoubleClick.action(setting: "Maximize", legacyMinimize: nil), .zoom)
        XCTAssertEqual(TitlebarDoubleClick.action(setting: "Fill", legacyMinimize: nil), .zoom)
        XCTAssertEqual(TitlebarDoubleClick.action(setting: "Minimize", legacyMinimize: nil), .minimize)
        XCTAssertEqual(TitlebarDoubleClick.action(setting: "None", legacyMinimize: nil), .none)
        XCTAssertEqual(TitlebarDoubleClick.action(setting: nil, legacyMinimize: true), .minimize)
        XCTAssertEqual(TitlebarDoubleClick.action(setting: nil, legacyMinimize: nil), .zoom)
        XCTAssertEqual(TitlebarDoubleClick.action(setting: "Something new", legacyMinimize: nil), .zoom)
    }

    func test拖放换目标时先离开旧的再进入新的() {
        XCTAssertEqual(DropRouting.transition(from: nil, to: .tab), DropTransition(exit: nil, enter: .tab))
        XCTAssertEqual(DropRouting.transition(from: .tab, to: .tab), DropTransition(exit: nil, enter: nil))
        XCTAssertEqual(DropRouting.transition(from: .tab, to: .main), DropTransition(exit: .tab, enter: .main))
        XCTAssertEqual(DropRouting.transition(from: .main, to: nil), DropTransition(exit: .main, enter: nil))
    }

    func test网页标签同步带hitRegions_旧网页不带也收() throws {
        let payload: [String: Any] = [
            "tabs": [["tabId": "web:1", "url": "https://example.com/"]], "active": "web:1",
            "frame": ["x": 240, "y": 44, "width": 960, "height": 756],
            "hitRegions": [["x": 800, "y": 300, "width": 380, "height": 480]],
        ]
        let body: [String: Any] = ["type": "sync", "state": payload]
        guard case .sync(let state) = try WebTabMessage.parse(body) else { return XCTFail("应当是同步消息") }
        XCTAssertEqual(state.hitRegions, [WebTabFrame(x: 800, y: 300, width: 380, height: 480)])
        let legacyState: [String: Any] = ["tabs": [] as [Any], "active": NSNull(), "frame": NSNull()]
        let legacy: [String: Any] = ["type": "sync", "state": legacyState]
        guard case .sync(let old) = try WebTabMessage.parse(legacy) else { return XCTFail("应当是同步消息") }
        XCTAssertNil(old.hitRegions)
        let rect: [String: Any] = ["x": 0, "y": 0, "width": 1, "height": 1]
        let tooMany = Array(repeating: rect, count: WebTabMessage.maxHitRegions + 1)
        var crowded = legacyState
        crowded["hitRegions"] = tooMany
        XCTAssertThrowsError(try WebTabMessage.parse(["type": "sync", "state": crowded] as [String: Any]))
    }

    func test带hitRegions的网页才把网页标签垫到下面() {
        let modern = WebTabsSync(tabs: [], active: nil, frame: nil, hitRegions: [])
        let legacy = WebTabsSync(tabs: [], active: nil, frame: nil)
        XCTAssertEqual(WebTabLayering.of(modern), .underMain)
        XCTAssertEqual(WebTabLayering.of(legacy), .overMain)
    }
}
