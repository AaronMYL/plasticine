import CoreGraphics
import Foundation

package struct Bitmap: Equatable {
    package let width: Int
    package let height: Int
    package var pixels: [UInt8]

    package init(width: Int, height: Int, pixels: [UInt8]) {
        self.width = width
        self.height = height
        self.pixels = pixels
    }
}

package enum ImageDiff {
    package static let channelThreshold = 24
    package static let changedFraction = 0.002

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
