import AppKit
import Foundation

// App 和菜单栏都从网页正在使用的泥团旋纹 SVG 出图，不再另画字母 P。
// 这里只解析这份仓库资产用到的 M/L/C/Z、rect 和 translate/scale，资产改成别的语法会明确使构建失败。
guard CommandLine.arguments.count == 4 else {
    fputs("用法：swift make-icon.swift icon.svg Plasticine.iconset Resources\n", stderr)
    exit(1)
}
struct IconFailure: Error {}
final class IconSource: NSObject, XMLParserDelegate {
    var background: [String: String] = [:]
    var transform = ""
    var paths: [[String: String]] = []
    func parser(_ parser: XMLParser, didStartElement name: String, namespaceURI: String?,
                qualifiedName: String?, attributes: [String: String]) {
        if name == "rect" { background = attributes }
        if name == "g" { transform = attributes["transform"] ?? "" }
        if name == "path" { paths.append(attributes) }
    }
}
func tokens(_ source: String, pattern: String) throws -> [String] {
    let regex = try NSRegularExpression(pattern: pattern)
    return regex.matches(in: source, range: NSRange(source.startIndex..., in: source)).compactMap {
        Range($0.range, in: source).map { String(source[$0]) }
    }
}
func path(_ source: String) throws -> CGPath {
    let parts = try tokens(source, pattern: "[A-Za-z]|-?(?:[0-9]*\\.)?[0-9]+")
    let path = CGMutablePath()
    var index = 0
    func number() throws -> CGFloat {
        guard index < parts.count, let value = Double(parts[index]) else { throw IconFailure() }
        index += 1
        return CGFloat(value)
    }
    func point() throws -> CGPoint { CGPoint(x: try number(), y: try number()) }
    while index < parts.count {
        let command = parts[index]
        index += 1
        switch command {
        case "M": path.move(to: try point())
        case "L": path.addLine(to: try point())
        case "C":
            let first = try point(), second = try point(), end = try point()
            path.addCurve(to: end, control1: first, control2: second)
        case "Z", "z": path.closeSubpath()
        default: throw IconFailure()
        }
    }
    return path
}
func color(_ hex: String?) throws -> CGColor {
    guard let hex, hex.hasPrefix("#"), hex.count == 7, let value = UInt32(hex.dropFirst(), radix: 16) else {
        throw IconFailure()
    }
    return NSColor(srgbRed: CGFloat((value >> 16) & 255) / 255, green: CGFloat((value >> 8) & 255) / 255,
                   blue: CGFloat(value & 255) / 255, alpha: 1).cgColor
}
let source = IconSource()
let parser = XMLParser(data: try Data(contentsOf: URL(fileURLWithPath: CommandLine.arguments[1])))
parser.delegate = source
guard parser.parse(), source.paths.count == 2, let blobData = source.paths[0]["d"],
      let swirlData = source.paths[1]["d"], let radius = Double(source.background["rx"] ?? ""),
      let stroke = Double(source.paths[1]["stroke-width"] ?? "") else { throw IconFailure() }
let transform = try tokens(source.transform, pattern: "-?(?:[0-9]*\\.)?[0-9]+").compactMap(Double.init)
guard transform.count == 3, source.transform.hasPrefix("translate("), source.transform.contains("scale(") else {
    throw IconFailure()
}
let blob = try path(blobData), swirl = try path(swirlData)
let background = try color(source.background["fill"]), clay = try color(source.paths[0]["fill"])
let white = try color(source.paths[1]["stroke"])
let directory = URL(fileURLWithPath: CommandLine.arguments[2], isDirectory: true)
let resources = URL(fileURLWithPath: CommandLine.arguments[3], isDirectory: true)
try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
try FileManager.default.createDirectory(at: resources, withIntermediateDirectories: true)

func draw(pixels: Int, template: Bool, destination: URL) throws {
    guard let bitmap = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: pixels, pixelsHigh: pixels,
        bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB,
        bytesPerRow: 0, bitsPerPixel: 0), let graphics = NSGraphicsContext(bitmapImageRep: bitmap) else {
        throw IconFailure()
    }
    let context = graphics.cgContext
    let side = CGFloat(pixels)
    context.clear(CGRect(x: 0, y: 0, width: side, height: side))
    context.translateBy(x: 0, y: side)
    context.scaleBy(x: 1, y: -1)
    if template {
        context.scaleBy(x: side / 100, y: side / 100)
        context.setFillColor(NSColor.black.cgColor)
    } else {
        // macOS 图标外轮廓留系统标准呼吸空间，里面的背景、泥团和旋纹沿用 SVG 原比例。
        context.translateBy(x: side * 0.08, y: side * 0.08)
        context.scaleBy(x: side * 0.84 / 100, y: side * 0.84 / 100)
        context.setFillColor(background)
        context.addPath(CGPath(roundedRect: CGRect(x: 0, y: 0, width: 100, height: 100),
                               cornerWidth: radius, cornerHeight: radius, transform: nil))
        context.fillPath()
        context.translateBy(x: transform[0], y: transform[1])
        context.scaleBy(x: transform[2], y: transform[2])
        context.setFillColor(clay)
    }
    context.addPath(blob)
    context.fillPath()
    context.addPath(swirl)
    context.setLineCap(.round)
    context.setLineJoin(.round)
    // 小尺寸菜单模板的线宽和页面左上 16px 标记一致（1.5 / 16），旋纹用透明镂空适应深浅菜单栏。
    context.setLineWidth(template ? 9.375 : stroke)
    if template { context.setBlendMode(.clear) } else { context.setStrokeColor(white) }
    context.strokePath()
    guard let png = bitmap.representation(using: .png, properties: [:]) else { throw IconFailure() }
    try png.write(to: destination)
}
for size in [16, 32, 128, 256, 512] {
    try draw(pixels: size, template: false, destination: directory.appendingPathComponent("icon_\(size)x\(size).png"))
    try draw(pixels: size * 2, template: false,
             destination: directory.appendingPathComponent("icon_\(size)x\(size)@2x.png"))
}
try draw(pixels: 18, template: true, destination: resources.appendingPathComponent("MenuIconTemplate.png"))
try draw(pixels: 36, template: true, destination: resources.appendingPathComponent("MenuIconTemplate@2x.png"))
