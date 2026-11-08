# 和网页共用新泥团旋纹，生成 Windows 原生多尺寸图标；不依赖额外图片库。
param(
  [Parameter(Mandatory = $true)][string]$Source,
  [Parameter(Mandatory = $true)][string]$Destination
)
$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Drawing
$Image = [System.Drawing.Image]::FromFile($Source)
$Sizes = @(16, 24, 32, 48, 64, 128, 256)
$Payloads = New-Object 'System.Collections.Generic.List[byte[]]'
try {
  foreach ($Size in $Sizes) {
    $Bitmap = New-Object System.Drawing.Bitmap($Size, $Size)
    $Graphics = [System.Drawing.Graphics]::FromImage($Bitmap)
    $Png = New-Object System.IO.MemoryStream
    try {
      $Graphics.Clear([System.Drawing.Color]::Transparent)
      $Graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
      $Graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
      $Graphics.DrawImage($Image, 0, 0, $Size, $Size)
      $Bitmap.Save($Png, [System.Drawing.Imaging.ImageFormat]::Png)
      $Payloads.Add($Png.ToArray())
    } finally { $Png.Dispose(); $Graphics.Dispose(); $Bitmap.Dispose() }
  }
} finally { $Image.Dispose() }
$File = [System.IO.File]::Create($Destination)
$Writer = New-Object System.IO.BinaryWriter($File)
try {
  $Writer.Write([UInt16]0)
  $Writer.Write([UInt16]1)
  $Writer.Write([UInt16]$Sizes.Count)
  $Offset = 6 + 16 * $Sizes.Count
  for ($Index = 0; $Index -lt $Sizes.Count; $Index++) {
    $Dimension = if ($Sizes[$Index] -eq 256) { 0 } else { $Sizes[$Index] }
    $Writer.Write([byte]$Dimension)
    $Writer.Write([byte]$Dimension)
    $Writer.Write([byte]0)
    $Writer.Write([byte]0)
    $Writer.Write([UInt16]1)
    $Writer.Write([UInt16]32)
    $Writer.Write([UInt32]$Payloads[$Index].Length)
    $Writer.Write([UInt32]$Offset)
    $Offset += $Payloads[$Index].Length
  }
  foreach ($Payload in $Payloads) { $Writer.Write([byte[]]$Payload) }
} finally { $Writer.Dispose(); $File.Dispose() }
