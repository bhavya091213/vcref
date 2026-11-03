"""vcref: read, write and verify .vcref voice reference bundles (format spec: SPEC.md)."""
from .bundle import MAGIC, VERSION, Bundle, Clip, VcrefError, pack, set_cadence

__all__ = ["Bundle", "Clip", "VcrefError", "pack", "set_cadence", "MAGIC", "VERSION"]
__version__ = "0.2.0"
