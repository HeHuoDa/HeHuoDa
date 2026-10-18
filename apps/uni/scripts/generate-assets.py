"""离线生产资源生成器；Python 3.13 / Pillow 12.0.0 / fonttools 4.61.0 / skia-python 144.0.post2。

icon-sources.json 固定自 @lucide/vue 1.51.0；ISC + Feather MIT 许可见根目录
third-party-notices/lucide-LICENSE.txt。旧端图片只作为构建输入，不进入运行时导入。
"""

import base64
import io
import json
from pathlib import Path

import skia
from PIL import Image, ImageChops, ImageStat
from fontTools.fontBuilder import FontBuilder
from fontTools.pens.cu2quPen import Cu2QuPen
from fontTools.pens.ttGlyphPen import TTGlyphPen
from fontTools.pens.transformPen import TransformPen
from fontTools.svgLib.path import parse_path
from fontTools.pens.basePen import BasePen

ROOT = Path(__file__).resolve().parents[1]
STATIC = ROOT / "src/static"
SOURCES = ROOT.parent / "web/src/assets"
icons = json.loads((ROOT / "scripts/icon-sources.json").read_text(encoding="utf-8"))
theme = (ROOT / "src/styles/theme.css").read_text(encoding="utf-8")


class SkiaPen(BasePen):
    def __init__(self):
        super().__init__(None)
        self.path = skia.Path()

    def _moveTo(self, point):
        self.path.moveTo(*point)

    def _lineTo(self, point):
        self.path.lineTo(*point)

    def _curveToOne(self, a, b, c):
        self.path.cubicTo(*a, *b, *c)

    def _qCurveToOne(self, a, b):
        self.path.quadTo(*a, *b)

    def _closePath(self):
        self.path.close()


def path_for(tag, attrs):
    path = skia.Path()
    if tag == "path":
        pen = SkiaPen()
        parse_path(attrs["d"], pen)
        return pen.path
    if tag == "circle":
        path.addCircle(float(attrs["cx"]), float(attrs["cy"]), float(attrs["r"]))
    elif tag == "line":
        path.moveTo(float(attrs["x1"]), float(attrs["y1"]))
        path.lineTo(float(attrs["x2"]), float(attrs["y2"]))
    elif tag in ("polyline", "polygon"):
        points = [float(v) for v in attrs["points"].replace(",", " ").split()]
        path.moveTo(*points[:2])
        for i in range(2, len(points), 2):
            path.lineTo(*points[i:i + 2])
        if tag == "polygon":
            path.close()
    elif tag == "rect":
        x, y, w, h = [float(attrs.get(k, 0)) for k in ("x", "y", "width", "height")]
        path.addRoundRect(skia.Rect.MakeXYWH(x, y, w, h), float(attrs.get("rx", 0)), float(attrs.get("ry", attrs.get("rx", 0))))
    else:
        raise ValueError(f"不支持的图标节点: {tag}")
    return path


def outline(data):
    result = skia.Path()
    paint = skia.Paint(Style=skia.Paint.kStroke_Style, StrokeWidth=1.5,
                       StrokeCap=skia.Paint.kRound_Cap, StrokeJoin=skia.Paint.kRound_Join)
    for tag, attrs in data["node"]:
        stroke = skia.Path()
        paint.getFillPath(path_for(tag, attrs), stroke)
        # 保留 Skia 描边的非零绕序。PathOps 的 even-odd 转换会误填书本等内孔。
        result.addPath(stroke)
    return result


def glyph_for(path):
    glyph = TTGlyphPen(None)
    pen = TransformPen(Cu2QuPen(glyph, max_err=0.5, reverse_direction=True), (40, 0, 0, -40, 0, 960))
    iterator = skia.Path.RawIter(path)
    for verb, points in iterator:
        values = [(p.x(), p.y()) for p in points]
        if verb == skia.Path.kMove_Verb:
            pen.moveTo(values[0])
        elif verb == skia.Path.kLine_Verb:
            pen.lineTo(values[1])
        elif verb == skia.Path.kQuad_Verb:
            pen.qCurveTo(*values[1:])
        elif verb == skia.Path.kConic_Verb:
            quads = skia.Path.ConvertConicToQuads(*points, iterator.conicWeight(), 3)
            for i in range(1, len(quads), 2):
                pen.qCurveTo((quads[i].x(), quads[i].y()), (quads[i+1].x(), quads[i+1].y()))
        elif verb == skia.Path.kCubic_Verb:
            pen.curveTo(*values[1:])
        elif verb == skia.Path.kClose_Verb:
            pen.closePath()
        else:
            raise ValueError(verb)
    return glyph.glyph()


paths = {name: outline(data) for name, data in icons.items()}
builder = FontBuilder(960, isTTF=True)
builder.setupGlyphOrder([".notdef", *paths])
builder.setupCharacterMap({0xE001 + i: name for i, name in enumerate(paths)})
builder.setupGlyf({".notdef": TTGlyphPen(None).glyph(), **{name: glyph_for(path) for name, path in paths.items()}})
builder.setupHorizontalMetrics({name: (960, getattr(builder.font["glyf"][name], "xMin", 0)) for name in [".notdef", *paths]})
builder.setupHorizontalHeader(ascent=960, descent=0)
builder.setupNameTable({"familyName": "HeHuoDa Icons", "styleName": "Regular", "uniqueFontIdentifier": "HeHuoDa-Lucide-1.51.0", "fullName": "HeHuoDa Icons", "psName": "HeHuoDaIcons", "version": "Version 1.0"})
builder.setupOS2(sTypoAscender=960, sTypoDescender=0, usWinAscent=960, usWinDescent=0)
builder.setupPost()
builder.setupMaxp()
builder.font["head"].created = builder.font["head"].modified = 2082844800
font = io.BytesIO()
builder.font.recalcTimestamp = False
builder.font.save(font)
# 将每个字体字形与原始 SVG 节点的直接描边栅格比对，防止空心变实心等转换错误。
typeface = skia.Typeface.MakeFromData(skia.Data.MakeWithCopy(font.getvalue()))
for index, (name, data) in enumerate(icons.items()):
    reference, actual = skia.Surface(96, 96), skia.Surface(96, 96)
    for surface in (reference, actual):
        surface.getCanvas().clear(skia.ColorTRANSPARENT)
    reference.getCanvas().scale(4, 4)
    stroke_paint = skia.Paint(Color=skia.ColorBLACK, AntiAlias=True, Style=skia.Paint.kStroke_Style,
                              StrokeWidth=1.5, StrokeCap=skia.Paint.kRound_Cap, StrokeJoin=skia.Paint.kRound_Join)
    for tag, attrs in data["node"]:
        reference.getCanvas().drawPath(path_for(tag, attrs), stroke_paint)
    actual.getCanvas().drawString(chr(0xE001 + index), 0, 96, skia.Font(typeface, 96), skia.Paint(Color=skia.ColorBLACK, AntiAlias=True))
    images = [Image.open(io.BytesIO(s.makeImageSnapshot().encodeToData().bytes())).getchannel("A") for s in (reference, actual)]
    difference = ImageStat.Stat(ImageChops.difference(*images)).mean[0]
    assert difference < 8, f"{name} 字体与原描边不一致: {difference}"
css = ROOT / "src/styles/base.css"
source = css.read_text(encoding="utf-8")
start, end = "/* BEGIN GENERATED ICON FONT */", "/* END GENERATED ICON FONT */"
if start in source:
    source = source[:source.index(start)] + source[source.index(end) + len(end):].lstrip("\n")
font_css = f'{start}\n/* Lucide 1.51.0, stroke 1.5; generate-assets.py; ISC/MIT. */\n@font-face {{\n  font-family: "HeHuoDa Icons";\n  src: url("data:font/ttf;base64,{base64.b64encode(font.getvalue()).decode()}") format("truetype");\n  font-weight: normal;\n  font-style: normal;\n}}\n{end}\n'
css.write_text(font_css + source, encoding="utf-8")

for name in ("home", "users", "user"):
    for tone in ("muted", "brand"):
        color = theme.split(f"--hhr-color-{tone}: ")[1].split(";")[0]
        surface = skia.Surface(96, 96)
        canvas = surface.getCanvas()
        canvas.clear(skia.ColorTRANSPARENT)
        canvas.scale(4, 4)
        canvas.drawPath(paths[name], skia.Paint(Color=skia.ColorSetARGB(255, *bytes.fromhex(color[1:])), AntiAlias=True))
        target = STATIC / f"icons/{name}-{tone}.png"
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(surface.makeImageSnapshot().encodeToData().bytes())

for source in sorted((SOURCES / "colleges").glob("*.webp")):
    target = STATIC / "colleges" / f"{source.stem}.png"
    target.parent.mkdir(parents=True, exist_ok=True)
    image = Image.open(source).convert("RGBA")
    # 原图不超过 128px 时原尺寸保留，大图等比收敛，满足 40px 显示约 3x 密度。
    image.thumbnail((128, 128), Image.Resampling.LANCZOS)
    image.save(target, optimize=True)

logo = Image.open(SOURCES / "hehuoda-logo.png").convert("RGBA")
logo.thumbnail((160, 160), Image.Resampling.LANCZOS)
logo.save(STATIC / "hehuoda-logo.png", optimize=True)
license_target = STATIC / "licenses/lucide-LICENSE.txt"
license_target.parent.mkdir(parents=True, exist_ok=True)
license_target.write_bytes((ROOT.parents[1] / "third-party-notices/lucide-LICENSE.txt").read_bytes())
print(json.dumps({"fontBytes": len(font.getvalue()), "staticBytes": sum(p.stat().st_size for p in STATIC.rglob("*") if p.is_file())}))
