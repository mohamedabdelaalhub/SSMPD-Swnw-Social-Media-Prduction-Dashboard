import sys, json
from PIL import Image, ImageDraw
Image.MAX_IMAGE_PIXELS = None
def build(S, cell=150, cols=14):
    idx = json.load(open(S + '/index.json'))['parts']
    rows = (len(idx) + cols - 1) // cols
    sh = Image.new('RGB', (cols * cell, rows * (cell + 16)), (232, 232, 232)); d = ImageDraw.Draw(sh)
    for k, p in enumerate(idx):
        im = Image.open(f"{S}/png/{p['id']}.png").convert('RGBA'); im.thumbnail((cell - 6, cell - 6))
        x = (k % cols) * cell; y = (k // cols) * (cell + 16)
        bg = Image.new('RGBA', im.size, (255, 255, 255, 255)); bg.alpha_composite(im); sh.paste(bg.convert('RGB'), (x + 3, y + 3))
        d.text((x + 3, y + cell - 1), p['id'], fill=(0, 0, 0))
    sh.save(S + '/index.jpg', quality=80); return sh.size
if __name__ == '__main__':
    for S in sys.argv[1:]: print(S.split('/')[-1], build(S))
