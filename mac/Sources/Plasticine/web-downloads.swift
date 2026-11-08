import AppKit
import WebKit

@MainActor
final class WebDownloads: NSObject, WKDownloadDelegate {
    private var active: [ObjectIdentifier: WKDownload] = [:]

    func receive(_ download: WKDownload) {
        active[ObjectIdentifier(download)] = download
        download.delegate = self
    }

    func download(
        _ download: WKDownload, decideDestinationUsing response: URLResponse, suggestedFilename: String,
        completionHandler: @escaping (URL?) -> Void
    ) {
        do {
            let directory = try FileManager.default.url(
                for: .downloadsDirectory, in: .userDomainMask, appropriateFor: nil, create: true
            )
            let safe = URL(fileURLWithPath: suggestedFilename).lastPathComponent
            let filename = safe.isEmpty || safe == "." || safe == ".." ? "下载" : safe
            var target = directory.appendingPathComponent(filename)
            if FileManager.default.fileExists(atPath: target.path) {
                let stem = target.deletingPathExtension().lastPathComponent
                let suffix = target.pathExtension
                let unique = stem + "-" + UUID().uuidString.prefix(8)
                target = directory.appendingPathComponent(unique)
                if !suffix.isEmpty { target.appendPathExtension(suffix) }
            }
            completionHandler(target)
        } catch {
            completionHandler(nil)
            NativePrompts.show("无法访问下载目录，请检查文件权限后重试。")
        }
    }

    func downloadDidFinish(_ download: WKDownload) { active[ObjectIdentifier(download)] = nil }

    func download(_ download: WKDownload, didFailWithError error: Error, resumeData: Data?) {
        active[ObjectIdentifier(download)] = nil
        NativePrompts.show("下载未完成，请检查网络和下载目录后重试。")
    }
}
