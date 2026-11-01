package assets

import (
	_ "embed"

	"fyne.io/fyne/v2"
)

//go:embed icon.png
var IconPNG []byte

//go:embed icon.svg
var IconSVG []byte

// AppIcon is the embedded SVGTuber application icon resource (Vector-Node Tri-Bot).
var AppIcon = fyne.NewStaticResource("icon.png", IconPNG)
