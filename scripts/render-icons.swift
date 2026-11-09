// Renders icons/icon.svg to the PNG sizes the manifest uses, plus grayscale
// variants (icon-N-gray.png) shown on non-ADO tabs.
// Usage: swift scripts/render-icons.swift
import AppKit

let svg = NSImage(contentsOfFile: "icons/icon.svg")!

func render(_ size: Int, gray: Bool) -> NSBitmapImageRep {
  let rep = NSBitmapImageRep(
    bitmapDataPlanes: nil, pixelsWide: size, pixelsHigh: size, bitsPerSample: 8,
    samplesPerPixel: 4, hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB,
    bytesPerRow: 0, bitsPerPixel: 0)!
  NSGraphicsContext.saveGraphicsState()
  NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: rep)
  NSGraphicsContext.current!.imageInterpolation = .high
  svg.draw(in: NSRect(x: 0, y: 0, width: size, height: size))
  NSGraphicsContext.restoreGraphicsState()

  if gray {
    let px = rep.bitmapData!
    for i in stride(from: 0, to: rep.bytesPerRow * size, by: 4) {
      let luma = 0.299 * Double(px[i]) + 0.587 * Double(px[i + 1]) + 0.114 * Double(px[i + 2])
      px[i] = UInt8(luma); px[i + 1] = UInt8(luma); px[i + 2] = UInt8(luma)
    }
  }
  return rep
}

for size in [16, 32, 48, 128] {
  for gray in [false, true] {
    try! render(size, gray: gray).representation(using: .png, properties: [:])!
      .write(to: URL(fileURLWithPath: "icons/icon-\(size)\(gray ? "-gray" : "").png"))
  }
}
