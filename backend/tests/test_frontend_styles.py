import re
from pathlib import Path


STYLES = (Path(__file__).parents[2] / "frontend" / "src" / "styles.css").read_text(encoding="utf-8")


def test_result_image_is_bounded_by_the_visible_stage():
    assert re.search(r"\.selected-image-wrap\s*\{[^}]*position:\s*absolute;[^}]*inset:\s*24px;", STYLES, re.S)
    assert re.search(
        r"\.viewport-fit-image\s*\{[^}]*width:\s*100%;[^}]*height:\s*100%;"
        r"[^}]*max-width:\s*100%;[^}]*max-height:\s*100%;[^}]*object-fit:\s*contain;",
        STYLES,
        re.S,
    )
    assert re.search(r"@media\s*\(max-width:\s*760px\)[\s\S]*\.selected-image-wrap\s*\{[^}]*inset:\s*14px;", STYLES)
