import os
from fastapi import APIRouter, HTTPException
from backend.settings import DOWNLOADS_DIR
from typing import List

router = APIRouter(prefix="/markdown")

@router.post("/generate-md-for-pdf")
def generate_md_for_pdf(pdf_filename: str) -> dict:
    """
    Convierte un PDF local a markdown (.txt) usando MarkItDown y guarda el resultado junto al PDF.
    """
    pdf_path = DOWNLOADS_DIR / pdf_filename
    if not pdf_path.is_file():
        raise HTTPException(status_code=404, detail=f"PDF not found: {pdf_filename}")
    txt_path = pdf_path.with_suffix('.txt')
    try:
        from markitdown import MarkItDown
        md = MarkItDown(enable_plugins=False)
        result = md.convert(str(pdf_path))
        with open(txt_path, 'w', encoding='utf-8') as f:
            f.write(result.text_content)
        return {"status": "success", "txt_file": txt_path.name}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error converting PDF to markdown: {e}")

@router.post("/generate-md-for-all-pdfs")
def generate_md_for_all_pdfs() -> dict:
    """
    Convierte todos los PDFs en la carpeta de descargas a markdown (.txt) si no existe el .txt.
    """
    from markitdown import MarkItDown
    md = MarkItDown(enable_plugins=False)
    converted = []
    errors = []
    for pdf_file in DOWNLOADS_DIR.glob("*.pdf"):
        txt_file = pdf_file.with_suffix('.txt')
        if not txt_file.exists():
            try:
                result = md.convert(str(pdf_file))
                with open(txt_file, 'w', encoding='utf-8') as f:
                    f.write(result.text_content)
                converted.append(txt_file.name)
            except Exception as e:
                errors.append({"pdf": pdf_file.name, "error": str(e)})
    return {"converted": converted, "errors": errors}
