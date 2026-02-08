# CLEAR25 App Icons

## Source Icon
- `icon.svg` - Vector source file (1024x1024)

## Required Sizes for iOS

Export the SVG to PNG at these sizes:

| Size | Filename | Usage |
|------|----------|-------|
| 1024x1024 | `icon-1024.png` | App Store |
| 180x180 | `icon-180.png` | iPhone @3x |
| 167x167 | `icon-167.png` | iPad Pro @2x |
| 152x152 | `icon-152.png` | iPad @2x |
| 120x120 | `icon-120.png` | iPhone @2x |
| 87x87 | `icon-87.png` | Settings @3x |
| 80x80 | `icon-80.png` | Spotlight @2x |
| 76x76 | `icon-76.png` | iPad @1x |
| 60x60 | `icon-60.png` | iPhone @1x |
| 58x58 | `icon-58.png` | Settings @2x |
| 40x40 | `icon-40.png` | Spotlight @1x |
| 29x29 | `icon-29.png` | Settings @1x |
| 20x20 | `icon-20.png` | Notification @1x |

## Quick Export with Inkscape (command line)

```bash
# Install Inkscape, then run:
for size in 1024 180 167 152 120 87 80 76 60 58 40 29 20; do
  inkscape icon.svg --export-type=png --export-filename=icon-$size.png -w $size -h $size
done
```

## Quick Export with ImageMagick

```bash
# From 1024 source PNG:
for size in 180 167 152 120 87 80 76 60 58 40 29 20; do
  convert icon-1024.png -resize ${size}x${size} icon-$size.png
done
```

## Online Tools
- [AppIcon.co](https://appicon.co) - Upload 1024x1024, get all sizes
- [MakeAppIcon](https://makeappicon.com) - Same, email delivery

## Design Notes
- No transparency (iOS will show black background)
- No rounded corners (iOS applies them automatically)
- Keep important content away from edges (safe zone ~80%)
