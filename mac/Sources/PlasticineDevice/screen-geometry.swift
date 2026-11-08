import Foundation

package struct ScreenGeometry {
    package let frame: CGRect
    package let width: Int
    package let height: Int

    package init(frame: CGRect, pixelWidth: Int, pixelHeight: Int) {
        self.frame = frame
        let scale = min(1, 1600 / Double(max(1, max(pixelWidth, pixelHeight))))
        width = max(1, Int((Double(pixelWidth) * scale).rounded(.down)))
        height = max(1, Int((Double(pixelHeight) * scale).rounded(.down)))
    }

    package func point(x: Int, y: Int) throws -> CGPoint {
        guard x >= 0, y >= 0, x < width, y < height else {
            throw DeviceFailure.refused("点击坐标超出最近一次截图")
        }
        return CGPoint(
            x: frame.minX + Double(x) * frame.width / Double(width),
            y: frame.minY + Double(y) * frame.height / Double(height)
        )
    }
}
