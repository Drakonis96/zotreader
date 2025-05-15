import os
from pathlib import Path

# Define la ruta de descargas de PDFs de forma robusta y única
DOWNLOADS_DIR = Path(os.getenv("DOWNLOADS_DIR", Path(__file__).parent / "downloaded_pdfs"))
DOWNLOADS_DIR.mkdir(parents=True, exist_ok=True)
# ...puedes añadir más settings globales aquí si lo necesitas...
