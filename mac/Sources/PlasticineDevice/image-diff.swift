import CoreGraphics
import Foundation

// 第 102 条「点击后再截一张」：点击 / 输入后设备自己比对前后两张截图判断画面有没有变化（changed），
// 原图不进回执。这里是可单测的纯比较；从 CGImage 取 RGBA 字节的部分不依赖屏幕，放在下面的扩展里。
package struct Bitmap: Equatable {
    package let width: Int
    package let height: Int
    /// RGBA8，长度 width * height * 4。
    package var pixels: [UInt8]

    package init(width: Int, height: Int, pixels: [UInt8]) {
        self.width = width
        self.height = height
        self.pixels = pixels
    }
}

package enum ImageDiff {
    // 单个通道差到这个值才算这个像素变了（压过 JPEG / 抗锯齿的轻微抖动，《讨论/手脚》）。
    package static let channelThreshold = 24
    // 变化像素超过这个比例才算画面变了（约千分之二，挡住光标残影这类极小变化）。
    package static let changedFraction = 0.002

    /// 两张同尺寸截图画面是否变化；尺寸不同无法比较，返回 nil（交回执由服务端判定）。
    package static func changed(_ before: Bitmap, _ after: Bitmap) -> Bool? {
        guard before.width == after.width, before.height == after.height,
              before.pixels.count == after.pixels.count, !before.pixels.isEmpty else {
            return nil
        }
        var changedPixels = 0
        let total = before.pixels.count / 4
        var index = 0
        while index < before.pixels.count {
            let dr = abs(Int(before.pixels[index]) - Int(after.pixels[index]))
            let dg = abs(Int(before.pixels[index + 1]) - Int(after.pixels[index + 1]))
            let db = abs(Int(before.pixels[index + 2]) - Int(after.pixels[index + 2]))
            if max(dr, max(dg, db)) >= channelThreshold { changedPixels += 1 }
            index += 4
        }
        return Double(changedPixels) >= Double(total) * changedFraction && changedPixels > 0
    }
}

extension Bitmap {
    /// 把 CGImage 画进固定的 RGBA8 缓冲区取出字节；失败返回 nil（比较会退回「未知」）。
    package static func from(_ image: CGImage) -> Bitmap? {
        let width = image.width
        let height = image.height
        guard width > 0, height > 0 else { return nil }
        var pixels = [UInt8](repeating: 0, count: width * height * 4)
        let space = CGColorSpaceCreateDeviceRGB()
        let info = CGImageAlphaInfo.premultipliedLast.rawValue
        let drawn = pixels.withUnsafeMutableBytes { buffer -> Bool in
            guard let context = CGContext(data: buffer.baseAddress, width: width, height: height,
                                          bitsPerComponent: 8, bytesPerRow: width * 4, space: space,
                                          bitmapInfo: info) else {
                return false
            }
            context.draw(image, in: CGRect(x: 0, y: 0, width: width, height: height))
            return true
        }
        return drawn ? Bitmap(width: width, height: height, pixels: pixels) : nil
    }
}
