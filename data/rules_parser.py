from __future__ import annotations

from pathlib import Path
from typing import Dict, List


class RulesParser:
    def __init__(self, pdf_path: Path) -> None:
        self.pdf_path = pdf_path

    def parse(self) -> List[Dict]:
        """
        Parse the Comprehensive Rules PDF into section records.
        This is a minimal placeholder; extend as needed.
        """
        try:
            import pdfplumber  # type: ignore
        except Exception as exc:
            raise RuntimeError("pdfplumber is required for rules parsing") from exc

        sections: List[Dict] = []
        with pdfplumber.open(self.pdf_path) as pdf:
            for page in pdf.pages:
                text = page.extract_text() or ""
                if text.strip():
                    sections.append({"page": page.page_number, "text": text})
        return sections
