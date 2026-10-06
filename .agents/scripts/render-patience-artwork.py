from pathlib import Path
import fitz

source = Path("attached_assets/Patience_Sold_Seperately_Cream_1791294495304.pdf")
out = Path(".agents/outputs/patience-artwork")
out.mkdir(parents=True, exist_ok=True)
doc = fitz.open(source)
print(f"Pages: {len(doc)}")
for index, page in enumerate(doc):
    print(f"Page {index + 1}: {page.rect}, embedded images: {len(page.get_images(full=True))}")
    page.get_pixmap(matrix=fitz.Matrix(2, 2), alpha=False).save(str(out / f"page-{index + 1}.png"))
    page.get_pixmap(matrix=fitz.Matrix(3, 3), alpha=True).save(str(out / f"artwork-{index + 1}.png"))
    for image_index, image in enumerate(page.get_images(full=True)):
        extracted = doc.extract_image(image[0])
        path = out / f"embedded-{index + 1}-{image_index + 1}.{extracted['ext']}"
        path.write_bytes(extracted["image"])
        print(f"Extracted: {path}, {extracted['width']}x{extracted['height']}, mask: {image[1]}")
