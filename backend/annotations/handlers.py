"""
Funciones y endpoints para manejar las anotaciones de PDF.
"""
import os
import json
from pathlib import Path
from fastapi import APIRouter, HTTPException, Body
from pydantic import BaseModel
from typing import Dict, Any, Optional
from fastapi.responses import StreamingResponse
import io
from PyPDF2 import PdfReader, PdfWriter
from reportlab.pdfgen import canvas

# Definir la ruta de almacenamiento de anotaciones
ANNOTATIONS_DIR = Path("backend/annotations")
ANNOTATIONS_DIR.mkdir(parents=True, exist_ok=True)  # Asegura que el directorio exista

router = APIRouter()

class AnnotationData(BaseModel):
    """Modelo para los datos de anotación de un PDF."""
    data: Dict[str, Any]
    filename: str

def get_annotation_path(filename: str) -> Path:
    """Genera el path para el archivo de anotaciones."""
    # Normalizar el nombre de archivo (quitar caracteres problemáticos)
    safe_filename = "".join(c if c.isalnum() or c in ['.', '-', '_'] else '_' for c in filename)
    return ANNOTATIONS_DIR / f"{safe_filename}.json"

@router.post("/annotations/save")
async def save_annotations(annotation_data: AnnotationData):
    """Guarda las anotaciones de un PDF."""
    try:
        file_path = get_annotation_path(annotation_data.filename)
        with open(file_path, 'w', encoding='utf-8') as f:
            json.dump(annotation_data.data, f, ensure_ascii=False, indent=2)
        return {"status": "success", "message": f"Anotaciones guardadas para {annotation_data.filename}"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error al guardar anotaciones: {str(e)}")

@router.get("/annotations/{filename}")
async def get_annotations(filename: str):
    """Obtiene las anotaciones para un PDF específico."""
    file_path = get_annotation_path(filename)
    try:
        if file_path.exists():
            with open(file_path, 'r', encoding='utf-8') as f:
                return json.load(f)
        else:
            # Si no hay anotaciones, devuelve un objeto vacío
            return {}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error al leer anotaciones: {str(e)}")

@router.delete("/annotations/{filename}")
async def delete_annotations(filename: str):
    """Elimina las anotaciones de un PDF específico."""
    file_path = get_annotation_path(filename)
    try:
        if file_path.exists():
            os.remove(file_path)
            return {"status": "success", "message": f"Anotaciones eliminadas para {filename}"}
        else:
            return {"status": "warning", "message": f"No se encontraron anotaciones para {filename}"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error al eliminar anotaciones: {str(e)}")

@router.get("/pdf/annotated/{filename}")
async def get_annotated_pdf(filename: str):
    """Genera y devuelve el PDF con anotaciones embebidas"""
    # Ruta al PDF original descargado
    orig_path = Path("backend/downloaded_pdfs") / filename
    if not orig_path.exists():
        raise HTTPException(status_code=404, detail=f"PDF original no encontrado: {filename}")
    # Cargar anotaciones si existen
    ann_path = get_annotation_path(filename)
    annotations = {}
    if ann_path.exists():
        with open(ann_path, 'r', encoding='utf-8') as f:
            data = json.load(f)
            annotations = data.get('pages', {})
    # Leer PDF original
    reader = PdfReader(str(orig_path))
    writer = PdfWriter()
    # Procesar cada página
    for idx, page in enumerate(reader.pages, start=1):
        # Crear capa de anotaciones
        packet = io.BytesIO()
        # Determinar tamaño de página
        media = page.mediabox
        width = float(media.width)
        height = float(media.height)
        c = canvas.Canvas(packet, pagesize=(width, height))
        # Dibujar objetos vectoriales básicos
        page_ann = annotations.get(str(idx), {}).get('objects', [])
        for obj in page_ann:
            if obj.get('type') == 'rect':
                left = obj.get('left', 0)
                top = obj.get('top', 0)
                w = obj.get('width', 0)
                h = obj.get('height', 0)
                c.setLineWidth(obj.get('strokeWidth', 1))
                # Color por defecto rojo
                c.setStrokeColorRGB(1, 0, 0)
                # PDF origin es esquina inferior izquierda
                c.rect(left, height - top - h, w, h, stroke=1, fill=0)
            # Otras formas pueden implementarse aquí
        c.save()
        packet.seek(0)
        overlay = PdfReader(packet)
        overlay_page = overlay.pages[0]
        page.merge_page(overlay_page)
        writer.add_page(page)
    # Generar salida en memoria
    output = io.BytesIO()
    writer.write(output)
    output.seek(0)
    return StreamingResponse(output, media_type="application/pdf", headers={"Content-Disposition": f"attachment; filename=\"{filename}_annotated.pdf\""})