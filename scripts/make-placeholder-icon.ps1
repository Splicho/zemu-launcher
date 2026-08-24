$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Drawing

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
$iconsDir = Join-Path $repoRoot "src-tauri\icons"
if (-not (Test-Path $iconsDir)) {
  New-Item -ItemType Directory -Path $iconsDir -Force | Out-Null
}

$size = 1024
$bmp = New-Object System.Drawing.Bitmap($size, $size)
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.SmoothingMode = 'AntiAlias'

$startColor = [System.Drawing.Color]::FromArgb(255, 15, 23, 42)
$endColor = [System.Drawing.Color]::FromArgb(255, 99, 102, 241)
$brush = New-Object System.Drawing.Drawing2D.LinearGradientBrush(
  ([System.Drawing.Point]::new(0, 0)),
  ([System.Drawing.Point]::new($size, $size)),
  $startColor,
  $endColor
)
$g.FillRectangle($brush, 0, 0, $size, $size)

$font = New-Object System.Drawing.Font('Arial Black', 480, [System.Drawing.FontStyle]::Bold)
$sf = New-Object System.Drawing.StringFormat
$sf.Alignment = 'Center'
$sf.LineAlignment = 'Center'
$g.DrawString('Z', $font, [System.Drawing.Brushes]::White, (New-Object System.Drawing.RectangleF(0, 0, $size, $size)), $sf)

$pngPath = Join-Path $iconsDir "icon.png"
$bmp.Save($pngPath, [System.Drawing.Imaging.ImageFormat]::Png)
Write-Host "Wrote $pngPath"

$g.Dispose()
$bmp.Dispose()
