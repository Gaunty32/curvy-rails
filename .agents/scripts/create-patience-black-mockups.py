"""Composite the exact PDF artwork onto generated blank garments."""
from pathlib import Path
from PIL import Image, ImageChops, ImageDraw, ImageOps

assets = Path("artifacts/curvy-rails-prototype/public/assets")
artwork = Image.open(".agents/outputs/patience-artwork/artwork-1.png").convert("RGBA")
artwork = artwork.crop(artwork.getchannel("A").getbbox())
artwork.save(assets / "patience-sold-separately-cream-artwork.png", optimize=True)


def create(source, destination, print_width, print_y, clear_label=False):
    photo = Image.open(source).convert("RGB")
    width, height = photo.size
    scale = width / 1024
    if clear_label:
        # Remove the generated blank garment's invented label, not the artwork.
        draw = ImageDraw.Draw(photo)
        draw.rectangle(
            tuple(round(v * scale) for v in (497, 153, 524, 179)),
            fill=(221, 221, 219),
        )
    pw = round(print_width * scale)
    ph = round(pw * artwork.height / artwork.width)
    x, y = round((width - pw) / 2), round(print_y * height / 1024)
    print_image = artwork.resize((pw, ph), Image.Resampling.LANCZOS)
    # Subtle fabric lighting through the ink, while preserving exact artwork.
    fabric = ImageOps.grayscale(photo.crop((x, y, x + pw, y + ph)))
    shade = fabric.point(lambda value: min(255, 224 + round(value * 0.5))).convert("RGB")
    ink = ImageChops.multiply(print_image.convert("RGB"), shade)
    photo.paste(ink, (x, y), print_image.getchannel("A"))
    photo.save(assets / destination, "WEBP", quality=94, method=6)
    print(f"{destination}: {photo.size}, print region {(x, y, pw, ph)}")


create(
    "attached_assets/generated_images/patience-black-flat-blank.png",
    "patience-sold-separately-black.webp",
    330, 252, clear_label=True,
)
create(
    "attached_assets/generated_images/patience-black-model-blank.png",
    "patience-sold-separately-black-model.webp",
    286, 334,
)
