import io

import pillow_heif
from PIL import Image, ImageOps, UnidentifiedImageError

from .config import ALLOWED_FORMATS, MAX_IMAGE_SIDE
from .errors import BadRequest

pillow_heif.register_heif_opener()


def prepare_image(data: bytes) -> bytes:
    """Validate an image, then return it as a JPEG (max MAX_IMAGE_SIDE px). All in memory.

    The format is checked from the file's real bytes, not the filename or the
    content type the client claims.
    """
    try:
        img = Image.open(io.BytesIO(data))
        if img.format not in ALLOWED_FORMATS:
            raise BadRequest(
                "UNSUPPORTED_FORMAT",
                f"Unsupported image type ({img.format}). Use jpg, png, webp, or heic.",
            )
        img = ImageOps.exif_transpose(img)  # phone photos store rotation in EXIF
        if img.mode in ("RGBA", "LA", "P"):
            rgba = img.convert("RGBA")  # flatten transparency onto white
            img = Image.new("RGB", rgba.size, "white")
            img.paste(rgba, mask=rgba.getchannel("A"))
        else:
            img = img.convert("RGB")
        img.thumbnail((MAX_IMAGE_SIDE, MAX_IMAGE_SIDE))  # only shrinks, keeps aspect ratio
        out = io.BytesIO()
        img.save(out, "JPEG", quality=90)
        return out.getvalue()
    except BadRequest:
        raise
    except (UnidentifiedImageError, Image.DecompressionBombError, OSError, ValueError) as e:
        raise BadRequest("BAD_IMAGE", "Could not read that file as an image.") from e
