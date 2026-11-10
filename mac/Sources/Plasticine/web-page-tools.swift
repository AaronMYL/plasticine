import AppKit
import WebKit

// 网页工具（2026-11-04 第 2 批「浏览器」，协议见 agent/shared/api/web-page-tools.ts 和 web-page-tool-protocol.swift）：
// 网页工具条 ⋯ 菜单、圈一块、标签悬停预览要原生网页标签做的几样。都在主线程上跑，结果经 plasticineTabs 的回执回去；
// null 回 NSNull（网页侧收到 null）。
// 注意：这台机器没有 Xcode，这份第 2 批写的时候没能编译，等 GitHub macOS 机器上跑 swift build / swift test 和真 App。

@MainActor
extension WebTabs {
    func perform(_ id: String, _ tool: WebPageTool) async throws -> Any {
        guard let tab = self.tab(id) else { throw DeviceFailure.failed("这个网页标签已经关了。") }
        let view = tab.view
        switch tool {
        case .extractImages:
            return try await WebExtract.run(view, ["kind": "extract_images"])
        case .extractMarks(let points, let focus, let color):
            var command: [String: Any] = ["kind": "extract_marks",
                "points": points.map { ["quote": $0.quote, "context": $0.context] }]
            if let focus { command["focus"] = focus }
            if let color { command["color"] = color }
            return try await WebExtract.run(view, command)
        case .find(let query, let backwards):
            let configuration = WKFindConfiguration()
            configuration.backwards = backwards
            configuration.caseSensitive = false
            configuration.wraps = true
            let result: WKFindResult = await withCheckedContinuation { continuation in
                view.find(query, configuration: configuration) { continuation.resume(returning: $0) }
            }
            return ["found": result.matchFound]
        case .findClear:
            // 查找的高亮是一段选区：收起查找条时清掉。
            try await WebPageScript.run(view, "window.getSelection()?.removeAllRanges(); return true;")
            return true
        case .zoom(let factor):
            view.pageZoom = CGFloat(factor)
            return true
        case .capture(let fullPage):
            return fullPage ? try await WebPageImage.fullPage(view) : try await WebPageImage.visible(view, width: nil)
        case .print:
            guard let window = owner?.window else { throw DeviceFailure.failed("窗口还没准备好，稍后再试。") }
            let operation = view.printOperation(with: NSPrintInfo.shared)
            // WKWebView 的打印要先给打印视图一个大小，不然打出来是空白页。
            operation.view?.frame = view.bounds
            operation.runModal(for: window, delegate: nil, didRun: nil, contextInfo: nil)
            return true
        case .circle:
            return try await WebCircle.run(view)
        case .circleCancel:
            try await WebPageScript.run(view, WebCircle.cancelSource)
            return true
        case .thumbnail:
            // 截不到（页面还没画出来、标签藏着截出空白）就回 null：网页侧不放缩略图。
            do {
                return try await WebPageImage.visible(view, width: WebPageTool.thumbnailWidth)
            } catch {
                return NSNull()
            }
        case .downloads:
            let directory = try FileManager.default.url(
                for: .downloadsDirectory, in: .userDomainMask, appropriateFor: nil, create: true
            )
            _ = NSWorkspace.shared.open(directory)
            return true
        case .perceive:
            // 原样回脚本那段 JSON 字符串，网页侧按 PagePerceptionSchema 校验（ask-this-page.tsx）。
            return try await PageOperate.text(view, ["op": "perceive"])
        }
    }
}

enum WebPageImage {
    /// 可见部分（给了宽度就按这个宽缩放，缩略图用）。
    @MainActor
    static func visible(_ view: WKWebView, width: Double?) async throws -> [String: Any] {
        let configuration = WKSnapshotConfiguration()
        if let width { configuration.snapshotWidth = NSNumber(value: width) }
        let image: NSImage = try await withCheckedThrowingContinuation { continuation in
            view.takeSnapshot(with: configuration) { image, error in
                if let image { continuation.resume(returning: image) } else {
                    continuation.resume(throwing: error ?? DeviceFailure.failed("截图没成，页面可能还在载入。"))
                }
            }
        }
        return try encode(image)
    }

    /// 整页：WebKit 把整页画成一页 PDF，再画成一张长图（长边超过上限按比例缩小）。
    @MainActor
    static func fullPage(_ view: WKWebView) async throws -> [String: Any] {
        let data: Data = try await withCheckedThrowingContinuation { continuation in
            view.createPDF(configuration: WKPDFConfiguration()) { continuation.resume(with: $0) }
        }
        guard let page = NSPDFImageRep(data: data) else { throw DeviceFailure.failed("整页截图没画出来。") }
        page.currentPage = 0
        let size = WebPageTool.fullPageSize(width: page.bounds.width, height: page.bounds.height)
        guard size.width > 0 else { throw DeviceFailure.failed("这一页是空的，截不了整页。") }
        let image = NSImage(size: size, flipped: false) { rect in page.draw(in: rect) }
        return try encode(image)
    }

    static func encode(_ image: NSImage) throws -> [String: Any] {
        guard let tiff = image.tiffRepresentation, let bitmap = NSBitmapImageRep(data: tiff),
              let data = bitmap.representation(using: .jpeg, properties: [.compressionFactor: 0.85]) else {
            throw DeviceFailure.failed("截图没能存成图片。")
        }
        guard data.count <= WebPageTool.imageMaxBytes else {
            throw DeviceFailure.failed("截图超过 10 MB，换成可见部分再试。")
        }
        return ["type": "image/jpeg", "base64": data.base64EncodedString()]
    }
}

/// 在网页标签的独立脚本世界里跑一小段（函数体，可以 await 和 return）。
enum WebPageScript {
    @MainActor
    static func run(_ view: WKWebView, _ body: String) async throws {
        let _: Any = try await withCheckedThrowingContinuation { continuation in
            view.callAsyncJavaScript(body, arguments: [:], in: nil, in: .defaultClient) { result in
                continuation.resume(with: result)
            }
        }
    }
}

enum WebCircle {
    static let cancelSource = """
        if (typeof window.__plasticineCircleCancel === 'function') window.__plasticineCircleCancel();
        return true;
        """

    private struct Picked: Decodable {
        let text: String
        let url: String
        let title: String
    }

    /// 圈一块：在网页标签的独立脚本世界里跑 CirclePageScript，等用户圈完（Esc、取消回 NSNull）。
    @MainActor
    static func run(_ view: WKWebView) async throws -> Any {
        let value: Any = try await withCheckedThrowingContinuation { continuation in
            view.callAsyncJavaScript(CirclePageScript.source, arguments: [:], in: nil, in: .defaultClient) { result in
                continuation.resume(with: result)
            }
        }
        guard let text = value as? String, let data = text.data(using: .utf8) else { return NSNull() }
        let picked: Picked
        do { picked = try JSONDecoder().decode(Picked.self, from: data) } catch {
            throw DeviceFailure.failed("圈的这一块没读出来，请再圈一次。")
        }
        return ["text": WebPageTool.clipCircleText(picked.text), "url": String(picked.url.prefix(4_096)),
                "title": String(picked.title.prefix(1_000))]
    }
}

@MainActor
enum WebExtract {
    static func run(_ view: WKWebView, _ command: [String: Any]) async throws -> Any {
        try await withCheckedThrowingContinuation { continuation in
            view.callAsyncJavaScript("return window.__plasticineExtract(command);", arguments: ["command": command],
                                     in: nil, in: WebTranslate.world) { result in
                continuation.resume(with: result)
            }
        }
    }
}
