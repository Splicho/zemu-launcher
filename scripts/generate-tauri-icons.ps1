param(
  [Parameter(Position = 0)]
  [string]$InputPath = "icon.png",

  [Parameter(Position = 1)]
  [string]$OutputDir = "src-tauri/icons",

  [Parameter(Position = 2)]
  [string]$UiIconPath = "assets/icon/app-icon.ico"
)

$ErrorActionPreference = "Stop"

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
Set-Location $repoRoot

if (-not (Test-Path $InputPath)) {
  Write-Host "Source icon '$InputPath' not found — skipping icon generation."
  exit 0
}

$resolvedInput = Resolve-Path $InputPath
$resolvedOutputDir = Resolve-Path $OutputDir -ErrorAction SilentlyContinue
if (-not $resolvedOutputDir) {
  $null = New-Item -ItemType Directory -Path $OutputDir -Force
  $resolvedOutputDir = Resolve-Path $OutputDir
}

$temporarySquaredPath = Join-Path $resolvedOutputDir "icon.source.square.png"

Add-Type -AssemblyName System.Drawing

$image = [System.Drawing.Image]::FromFile($resolvedInput.Path)
try {
  $size = [Math]::Max($image.Width, $image.Height)
  $bitmap = New-Object System.Drawing.Bitmap($size, $size, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  try {
    $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
    try {
      $graphics.Clear([System.Drawing.Color]::Transparent)
      $x = [int](($size - $image.Width) / 2)
      $y = [int](($size - $image.Height) / 2)
      $graphics.DrawImage($image, $x, $y, $image.Width, $image.Height)
      $bitmap.Save($temporarySquaredPath, [System.Drawing.Imaging.ImageFormat]::Png)
    } finally {
      $graphics.Dispose()
    }
  } finally {
    $bitmap.Dispose()
  }
} finally {
  $image.Dispose()
}

Write-Host "Generated square source icon: $temporarySquaredPath"
pnpm tauri icon "$temporarySquaredPath" --output "$($resolvedOutputDir.Path)"
$exitCode = $LASTEXITCODE

if ($exitCode -eq 0) {
  $generatedIcoPath = Join-Path $resolvedOutputDir.Path "icon.ico"
  if (Test-Path $generatedIcoPath) {
    $uiIconDirectory = Split-Path $UiIconPath -Parent
    if (-not [string]::IsNullOrWhiteSpace($uiIconDirectory) -and -not (Test-Path $uiIconDirectory)) {
      $null = New-Item -ItemType Directory -Path $UiIconDirectory -Force
    }
    Copy-Item $generatedIcoPath $UiIconPath -Force
    Write-Host "Synced UI icon: $UiIconPath"
  }
}

if (Test-Path $temporarySquaredPath) {
  Remove-Item $temporarySquaredPath -Force
}

exit $exitCode
