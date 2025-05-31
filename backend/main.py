from dotenv import load_dotenv
load_dotenv()

import os
import json
from fastapi import FastAPI, HTTPException, UploadFile, File, Form, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import Response, FileResponse # Modified import: Added FileResponse
from operator import itemgetter
from pyzotero import zotero
import hashlib
import requests
import time
import zipfile
import io
from pathlib import Path
import glob # Added
from pydantic import BaseModel # Added for response model

# Import the google api router directly
from backend.apis.google_api import router as google_router
from backend.apis.openai_api import router as openai_router
from backend.apis.openrouter_api import router as openrouter_router
from annotations.handlers import router as annotations_router  # Fix import for Docker context
from backend.apis.markdown_api import router as markdown_router, generate_md_for_pdf
from backend.settings import DOWNLOADS_DIR
from backend.db import get_collections, get_subcollections, get_items, search_items, get_connection

API_KEY = os.getenv("ZOTERO_API_KEY")
USER_ID = os.getenv("ZOTERO_USER_ID")
if not (API_KEY and USER_ID):
    raise RuntimeError("Faltan ZOTERO_API_KEY o ZOTERO_USER_ID en variables de entorno")

# instancia para tu biblioteca personal
user_zot = zotero.Zotero(USER_ID, "user", API_KEY)

# Cache setup
CACHE_DIR = Path("backend/cache")
LIBRARIES_CACHE_FILE = CACHE_DIR / "libraries.json"
CACHE_DIR.mkdir(parents=True, exist_ok=True) # Ensure cache directory exists

# Global variable to hold cached libraries
cached_libraries = []

def group_client(group_id: str):
    return zotero.Zotero(group_id, "group", API_KEY)

# --- Cache Functions ---

# Library Cache
def load_libraries_cache():
    global cached_libraries
    if LIBRARIES_CACHE_FILE.exists():
        try:
            with open(LIBRARIES_CACHE_FILE, 'r') as f:
                cached_libraries = json.load(f)
            print("Librerías cargadas desde caché.")
            return True
        except json.JSONDecodeError:
            print("Error al decodificar caché de librerías.")
            return False
    print("Archivo de caché de librerías no encontrado.")
    return False

def save_libraries_cache():
    global cached_libraries
    try:
        with open(LIBRARIES_CACHE_FILE, 'w') as f:
            json.dump(cached_libraries, f, indent=4)
        print("Caché de librerías guardado.")
    except IOError as e:
        print(f"Error al guardar caché de librerías: {e}")

def fetch_libraries_from_zotero():
    global cached_libraries
    print("Recuperando librerías desde la API de Zotero...")
    try:
        libs = [{"id": USER_ID, "type": "user", "name": "Mi biblioteca"}]
        groups = user_zot.groups() # Pyzotero.groups() :contentReference[oaicite:0]{index=0}
        for g in groups:
            libs.append({"id": g["id"], "type": "group", "name": g["data"]["name"]}) # Adjusted to access name correctly
        cached_libraries = libs
        save_libraries_cache()
        print("Librerías recuperadas y cacheadas.")
    except Exception as e:
        print(f"Error al recuperar librerías de Zotero: {e}")
        # Decide if you want to clear cache or keep old one on error
        # cached_libraries = [] # Option: clear cache on error

# Item Cache
def get_items_cache_path(lib_type: str, lib_id: str, collection_key: str = None) -> Path:
    """Generates the path for the item cache file."""
    if collection_key:
        return CACHE_DIR / f"items_{lib_type}_{lib_id}_collection_{collection_key}.json"
    else:
        return CACHE_DIR / f"items_{lib_type}_{lib_id}.json"

def load_items_cache(lib_type: str, lib_id: str, collection_key: str = None):
    """Loads items from the cache file if it exists."""
    cache_file = get_items_cache_path(lib_type, lib_id, collection_key)
    if cache_file.exists():
        try:
            with open(cache_file, 'r') as f:
                print(f"Cargando ítems desde caché: {cache_file}")
                return json.load(f)
        except json.JSONDecodeError:
            print(f"Error al decodificar caché de ítems: {cache_file}")
            return None # Indicate cache read failure
    print(f"Archivo de caché de ítems no encontrado: {cache_file}")
    return None

def save_items_cache(lib_type: str, lib_id: str, items_data, collection_key: str = None):
    """Saves items data to the cache file."""
    cache_file = get_items_cache_path(lib_type, lib_id, collection_key)
    try:
        with open(cache_file, 'w') as f:
            json.dump(items_data, f, indent=4)
        print(f"Caché de ítems guardado: {cache_file}")
    except IOError as e:
        print(f"Error al guardar caché de ítems {cache_file}: {e}")

def format_item(it, zot):
    """Helper function to format a single Zotero item, ensuring hasAttachment is accurate."""
    data = it.get('data', {})
    tags = data.get('tags', [])
    item_key = it.get('key')
    has_attachment = False # Default to false

    # Use Pyzotero's children() method to check for actual attachments
    # This is the most reliable way when fetching lists initially.
    if item_key:
        try:
            # print(f"Checking children for item: {item_key}") # Optional: uncomment for debugging
            children = zot.children(item_key)
            # print(f"Children found for {item_key}: {len(children)}") # Optional: uncomment for debugging
            for child in children:
                child_data = child.get('data', {})
                if child_data.get('itemType') == 'attachment':
                    # print(f"Attachment found for {item_key}") # Optional: uncomment for debugging
                    has_attachment = True
                    break # Found one, no need to check further
        except Exception as e:
            # Log the error but continue; assume no attachment if children check fails
            print(f"Error fetching/checking children for item {item_key}: {e}")
            # Keep has_attachment as False
    else:
        print("Warning: Item found without a key during formatting.")

    return {
        "key": item_key,
        "title": data.get("title", ""),
        "itemType": data.get("itemType", ""),
        "creators": format_creators(data.get("creators", [])),
        "date": data.get("date", ""),
        "tags": [t.get('tag') for t in tags],
        "hasAttachment": has_attachment, # Use the accurately determined value
        "abstractNote": data.get("abstractNote", ""),
        "url": data.get("url", "")
    }

def fetch_and_cache_items(lib_type: str, lib_id: str, collection_key: str = None):
    """Fetches items from Zotero, formats them, saves to cache, and returns them."""
    zot = user_zot if lib_type == "user" else group_client(lib_id)
    print(f"Recuperando ítems desde Zotero para {lib_type}/{lib_id}" + (f"/collection/{collection_key}" if collection_key else ""))
    try:
        if collection_key:
            items_data = zot.everything(zot.collection_items(collection_key, itemType="-attachment || annotation"))
        else:
            items_data = zot.everything(zot.top(itemType="-attachment || annotation"))

        # Format items - Pass zot instance to format_item
        result = [format_item(it, zot) for it in items_data]

        save_items_cache(lib_type, lib_id, result, collection_key)
        return result
    except Exception as e:
        print(f"Error fetching items for {lib_type}/{lib_id}" + (f"/collection/{collection_key}" if collection_key else "") + f": {e}")
        # Decide how to handle errors, maybe raise HTTPException?
        raise HTTPException(status_code=500, detail=f"Error al recuperar ítems: {e}")

# --- End Cache Functions ---

app = FastAPI(title="zotAIro API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # ajuste rápido
    allow_methods=["*"],
    allow_headers=["*"],
)

# Include the Google API router with the /api prefix
app.include_router(google_router, prefix="/api") # Added prefix="/api"
app.include_router(openai_router, prefix="/api")
app.include_router(openrouter_router, prefix="/api")
app.include_router(annotations_router, prefix="/api")  # Añadir el router de anotaciones
app.include_router(markdown_router, prefix="/api")

# --- Application Startup Logic ---
@app.on_event("startup")
def startup_event():
    if not load_libraries_cache():
        fetch_libraries_from_zotero()
    # Sincronizar SQLite antes de que el frontend haga peticiones
    print("Sincronizando base de datos SQLite al iniciar el backend...")
    sync_sqlite_from_zotero()
# --- End Startup Logic ---


# --- New Configuration Endpoint ---

class ApiConfig(BaseModel):
    google_api_key: str | None = None
    openai_api_key: str | None = None
    deepseek_api_key: str | None = None
    openrouter_api_key: str | None = None  # Añadido

@app.get("/api/config", response_model=ApiConfig)
def get_api_config():
    """Returns API keys found in environment variables."""
    return ApiConfig(
        google_api_key=os.getenv("GOOGLE_API_KEY"),
        openai_api_key=os.getenv("OPENAI_API_KEY"),
        deepseek_api_key=os.getenv("DEEPSEEK_API_KEY"),
        openrouter_api_key=os.getenv("OPENROUTER_API_KEY")  # Añadido
    )

# --- End New Configuration Endpoint ---


# Helper function to format creators
def format_creators(creators_list):
    if not creators_list:
        return ""
    names = []
    for creator in creators_list:
        # Prioritize lastName if available
        last_name = creator.get('lastName')
        first_name = creator.get('firstName')
        if last_name:
            name = last_name
            if first_name:
                name += f", {first_name}"
        elif first_name: # Handle case where only firstName exists
            name = first_name
        else: # Handle case where neither exists (e.g., institutional author in 'name')
            name = creator.get('name', '')
        names.append(name)
    return "; ".join(names) # Use semicolon for multiple creators

@app.get("/api/libraries")
def libraries():
    """Devuelve Mi biblioteca + grupos a los que tengas acceso (desde caché)"""
    global cached_libraries
    if not cached_libraries: # Fallback if cache is empty for some reason
         fetch_libraries_from_zotero()
    return cached_libraries

def sync_sqlite_from_zotero():
    """
    Sincroniza todas las colecciones e ítems de Zotero a la base de datos SQLite.
    Borra primero las tablas y repuebla todo.
    """
    from backend.db import get_connection, insert_collection, insert_item, insert_item_collection, get_all_items
    conn = get_connection()
    cur = conn.cursor()
    # Limpiar tablas
    cur.execute('DELETE FROM collections')
    cur.execute('DELETE FROM items')
    cur.execute('DELETE FROM item_collections')
    conn.commit()
    # Sincronizar usuario y grupos
    libs = [{"id": USER_ID, "type": "user", "name": "Mi biblioteca"}]
    try:
        groups = user_zot.groups()
        for g in groups:
            libs.append({"id": g["id"], "type": "group", "name": g["data"]["name"]})
    except Exception as e:
        print(f"Error obteniendo grupos: {e}")
    for lib in libs:
        lib_type = lib["type"]
        lib_id = lib["id"]
        zot = user_zot if lib_type == "user" else group_client(lib_id)
        # Colecciones
        try:
            cols = zot.everything(zot.collections())
            for col in cols:
                data = col["data"]
                insert_collection(
                    id=col["key"],
                    name=data["name"],
                    parent_id=data["parentCollection"] if data.get("parentCollection") else None,
                    library_type=lib_type,
                    library_id=lib_id
                )
        except Exception as e:
            print(f"Error sincronizando colecciones para {lib_type}/{lib_id}: {e}")
        # Ítems principales (sin attachments ni anotaciones)
        try:
            items = zot.everything(zot.top(itemType="-attachment || annotation"))
            for it in items:
                data = it.get("data", {})
                insert_item(
                    id=it["key"],
                    title=data.get("title", ""),
                    library_type=lib_type,
                    library_id=lib_id,
                    metadata=json.dumps(data)
                )
                col_keys = data.get("collections", [])
                for col_id in col_keys:
                    insert_item_collection(
                        item_id=it["key"],
                        collection_id=col_id,
                        library_type=lib_type,
                        library_id=lib_id
                    )
        except Exception as e:
            print(f"Error sincronizando ítems para {lib_type}/{lib_id}: {e}")
        # Attachments independientes
        try:
            attachments = zot.everything(zot.items(itemType="attachment"))
            # Obtener todos los parentItem existentes en la tabla items
            cur.execute('SELECT id FROM items WHERE library_type=? AND library_id=?', (lib_type, lib_id))
            existing_items = set(row[0] for row in cur.fetchall())
            for att in attachments:
                data = att.get("data", {})
                parent = data.get("parentItem")
                # Si no tiene parentItem o el parent no existe en items, es attachment independiente
                if not parent or parent not in existing_items:
                    insert_item(
                        id=att["key"],
                        title=data.get("title", data.get("filename", "(Attachment)")),
                        library_type=lib_type,
                        library_id=lib_id,
                        metadata=json.dumps(data)
                    )
                    # Asociar a colecciones si corresponde
                    col_keys = data.get("collections", [])
                    for col_id in col_keys:
                        insert_item_collection(
                            item_id=att["key"],
                            collection_id=col_id,
                            library_type=lib_type,
                            library_id=lib_id
                        )
        except Exception as e:
            print(f"Error sincronizando attachments independientes para {lib_type}/{lib_id}: {e}")
    conn.close()
    print("Sincronización SQLite completada.")

@app.post("/api/refresh-libraries") # Using POST for action
def refresh_libraries():
    """Fuerza la actualización de la caché de librerías, elimina caché de ítems y sincroniza SQLite."""
    global cached_libraries
    fetch_libraries_from_zotero() # Fetches and saves library cache

    # Clear item caches
    print("Eliminando caché de ítems...")
    deleted_count = 0
    try:
        cache_pattern = str(CACHE_DIR / "items_*.json")
        for f in glob.glob(cache_pattern):
             # Security check: ensure we only delete files starting with 'items_' inside the cache dir
            if Path(f).name.startswith("items_"):
                try:
                    os.remove(f)
                    deleted_count += 1
                    print(f"Eliminado: {f}")
                except OSError as e:
                    print(f"Error eliminando archivo de caché {f}: {e}")
    except Exception as e:
        print(f"Error buscando archivos de caché de ítems: {e}")

    # Sincronizar SQLite
    print("Sincronizando base de datos SQLite...")
    sync_sqlite_from_zotero()

    return {"message": f"Caché de librerías actualizada. {deleted_count} cachés de ítems eliminados. SQLite sincronizado."}


@app.get("/api/libraries/{lib_type}/{lib_id}/items")
def items(lib_type: str, lib_id: str):
    """Devuelve los ítems principales de una biblioteca (desde caché si es posible)."""
    cached_items = load_items_cache(lib_type, lib_id)
    if cached_items is not None:
        return cached_items
    else:
        # Fetch from Zotero, cache, and return
        return fetch_and_cache_items(lib_type, lib_id)

@app.get("/api/libraries/{lib_type}/{lib_id}/items/{item_key}")
def item_detail(lib_type: str, lib_id: str, item_key: str):
    zot = user_zot if lib_type == "user" else group_client(lib_id)
    try:
        item = zot.item(item_key)
        data = item[0]['data'] if isinstance(item, list) else item['data']
        # Obtener tags y adjuntos
        tags = data.get('tags', [])
        children = zot.children(item_key)
        
        # Filtrar adjuntos - primero identificamos todos los attachments
        attachments = [child for child in children if child.get('data', {}).get('itemType') == 'attachment']
        
        # Si hay más de un adjunto, filtrar para mantener solo PDFs
        if len(attachments) > 1:
            pdf_attachments = [
                att for att in attachments
                if att.get('data', {}).get('contentType') == 'application/pdf'
            ]
            # Si encontramos PDFs, usamos solo esos, de lo contrario mantenemos todos los adjuntos
            if pdf_attachments:
                total_attachments = len(attachments)
                attachments = pdf_attachments
                pdf_count = len(attachments)
                print(f"Item {item_key}: Filtered to {pdf_count} PDF attachments from {total_attachments} total attachments")
        return {
            "key": data.get("key"),
            "title": data.get("title", ""),
            "itemType": data.get("itemType", ""),
            "creators": format_creators(data.get("creators", [])),
            "date": data.get("date", ""),
            "tags": [t.get('tag') for t in tags],
            "attachments": [
                {
                    "key": att['key'],
                    "title": att['data'].get('title', ''),
                    "filename": att['data'].get('filename', ''),
                    "contentType": att['data'].get('contentType', '')
                } for att in attachments
            ],
            "abstractNote": data.get("abstractNote", ""),
            "url": data.get("url", "")
        }
    except Exception:
        raise HTTPException(404, "Elemento no encontrado")

@app.get("/api/libraries/{lib_type}/{lib_id}/collections")
def collections(lib_type: str, lib_id: str):
    zot = user_zot if lib_type == "user" else group_client(lib_id)
    try:
        cols = zot.collections()
        # Estructura esperada por el frontend: key, data, meta
        sorted_cols = sorted(cols, key=lambda x: x['data']['name'].lower())
        return [
            {
                "key": col["key"],
                "data": col["data"],
                "meta": col.get("meta", {})
            } for col in sorted_cols
        ]
    except Exception as e:
        print(f"Error fetching collections for {lib_type}/{lib_id}: {e}")
        raise HTTPException(status_code=500, detail="Error al recuperar colecciones")

@app.get("/api/libraries/{lib_type}/{lib_id}/collections/{collection_key}/subcollections")
def subcollections(lib_type: str, lib_id: str, collection_key: str):
    zot = user_zot if lib_type == "user" else group_client(lib_id)
    try:
        sub_cols = zot.collections_sub(collection_key)
        sorted_sub_cols = sorted(sub_cols, key=lambda x: x['data']['name'].lower())
        return [
            {
                "key": col["key"],
                "data": col["data"],
                "meta": col.get("meta", {})
            } for col in sorted_sub_cols
        ]
    except Exception as e:
        print(f"Error fetching subcollections for {lib_type}/{lib_id}/{collection_key}: {e}")
        raise HTTPException(status_code=500, detail="Error al recuperar subcolecciones")

@app.get("/api/libraries/{lib_type}/{lib_id}/collections/{collection_key}/items")
def collection_items(lib_type: str, lib_id: str, collection_key: str):
    """Devuelve los ítems de una colección específica (desde caché si es posible)."""
    cached_items = load_items_cache(lib_type, lib_id, collection_key)
    if cached_items is not None:
        return cached_items
    else:
        # Fetch from Zotero, cache, and return
        return fetch_and_cache_items(lib_type, lib_id, collection_key)

@app.get("/api/libraries/{lib_type}/{lib_id}/attachments/{attachment_key}/file")
async def get_attachment_file(lib_type: str, lib_id: str, attachment_key: str, background_tasks: BackgroundTasks): # Changed to async def
    webdav_url = os.getenv("WEBDAV_URL")
    webdav_user = os.getenv("WEBDAV_USER")
    webdav_pass = os.getenv("WEBDAV_PASS")
    zot = user_zot if lib_type == "user" else group_client(lib_id)

    # 1. Get attachment metadata first to determine filename and content type
    try:
        item = zot.item(attachment_key) # This might block, consider async library if performance is critical
        if not item or 'data' not in item or not item['data'].get('filename'):
            print(f"Metadata for attachment {attachment_key} not found or missing filename.")
            raise HTTPException(404, "Metadatos del adjunto no encontrados o incompletos.")

        filename = item['data']['filename']
        content_type = item['data'].get('contentType', 'application/octet-stream')
        local_path = DOWNLOADS_DIR / filename
        print(f"Checking for local file: {local_path}")

    except Exception as e:
        print(f"Error fetching Zotero metadata for {attachment_key}: {e}")
        # Check if it's a pyzotero specific error for not found?
        if "404" in str(e): # Basic check
            raise HTTPException(404, f"Adjunto {attachment_key} no encontrado en Zotero: {e}")
        else:
            raise HTTPException(500, f"Error al obtener metadatos del adjunto desde Zotero: {e}")

    # 2. Check if file exists locally
    if local_path.exists():
        print(f"Serving existing local file: {local_path}")
        # Trigger Markdown generation in background if .txt does not exist
        txt_path = local_path.with_suffix('.txt')
        if not txt_path.exists():
            background_tasks.add_task(generate_md_for_pdf, local_path.name)
        return FileResponse(path=local_path, media_type=content_type, filename=filename)

    # 3. File not found locally, proceed to download
    print(f"Local file not found. Attempting download for: {filename}")

    # --- Try WebDAV first if configured ---
    if webdav_url and webdav_user and webdav_pass:
        print(f"Attempting download from WebDAV for {attachment_key}")
        file_url = f"{webdav_url}/zotero/{attachment_key}.zip"
        try:
            # Use httpx for async requests
            import httpx
            async with httpx.AsyncClient(auth=(webdav_user, webdav_pass), timeout=30.0) as client: # Increased timeout
                response = await client.get(file_url)
                response.raise_for_status() # Raise HTTPError for bad responses

            if response.status_code == 200:
                try:
                    with zipfile.ZipFile(io.BytesIO(response.content)) as zf:
                        # Find the correct file within the zip (matching the expected filename)
                        target_entry = None
                        for name in zf.namelist():
                             # Normalize names for comparison if needed, or check if filename is exactly in namelist
                             # Simple check: if the expected filename is directly in the zip
                             if name == filename:
                                 target_entry = name
                                 break
                             # Add more robust matching if needed (e.g., case-insensitive, ignoring paths)

                        if target_entry:
                            file_data = zf.read(target_entry)
                            # Save file locally (ensure directory exists)
                            DOWNLOADS_DIR.mkdir(parents=True, exist_ok=True)
                            try:
                                with open(local_path, 'wb') as f:
                                    f.write(file_data)
                                print(f"File downloaded from WebDAV and saved locally: {local_path}")
                                # Trigger Markdown generation in background if .txt does not exist
                                txt_path = local_path.with_suffix('.txt')
                                if not txt_path.exists():
                                    background_tasks.add_task(generate_md_for_pdf, local_path.name)
                                # Serve the newly saved local file
                                return FileResponse(path=local_path, media_type=content_type, filename=filename)
                            except IOError as e:
                                print(f"Error saving file locally {local_path} after WebDAV download: {e}")
                                raise HTTPException(status_code=500, detail=f"Error al guardar el archivo localmente tras descarga WebDAV: {e}")
                        else:
                             print(f"File '{filename}' not found inside ZIP for attachment {attachment_key}")
                             # Decide: Fallback to Zotero Storage or raise error?
                             # For now, let's try Zotero Storage if WebDAV zip didn't contain the expected file.
                             print("Falling back to Zotero Storage download.")
                             # The code will naturally fall through to the Zotero Storage section below

                except zipfile.BadZipFile:
                    print(f"Error: Bad ZIP file for attachment {attachment_key} from {file_url}")
                    # Fallback to Zotero Storage? Or raise error? Let's try Zotero Storage.
                    print("Falling back to Zotero Storage download due to bad ZIP.")
                    # Fall through
                except Exception as e:
                    print(f"Error processing ZIP for attachment {attachment_key}: {e}")
                    # Fallback to Zotero Storage? Or raise error? Let's try Zotero Storage.
                    print(f"Falling back to Zotero Storage download due to ZIP processing error: {e}")
                    # Fall through

            # If status code was not 200 (and didn't raise for status for some reason)
            # or if the specific file wasn't found in the zip, we might fall through here.
            # Let's add explicit print if WebDAV download failed before Zotero attempt.
            print(f"WebDAV download attempt failed or did not yield the file '{filename}'. Status: {response.status_code if 'response' in locals() else 'N/A'}")


        except httpx.RequestError as e:
            print(f"Error accessing WebDAV for attachment {attachment_key}: {e}")
            # Fallback to Zotero Storage if WebDAV connection fails
            print("Falling back to Zotero Storage download due to WebDAV connection error.")
            # Fall through
        except httpx.HTTPStatusError as e:
             print(f"HTTP error accessing WebDAV for attachment {attachment_key}: {e.response.status_code} - {e.response.text}")
             if e.response.status_code == 404:
                 print(f"Attachment zip {attachment_key}.zip not found on WebDAV.")
             # Fallback to Zotero Storage if WebDAV request fails
             print("Falling back to Zotero Storage download due to WebDAV HTTP error.")
             # Fall through


    # --- Fallback to Zotero Storage ---
    # This section is reached if:
    # 1. WebDAV is not configured.
    # 2. WebDAV download failed (connection error, HTTP error, bad zip, file not in zip).
    print(f"Attempting download from Zotero Storage for: {filename}")
    try:
        # Download file content from Zotero (this might block)
        # Consider using an async Zotero library if this becomes a bottleneck
        file_content = zot.file(attachment_key) # This gets the raw content
        if not file_content:
            print(f"Could not download file content for {filename} ({attachment_key}) from Zotero.")
            raise HTTPException(404, "No se pudo descargar el contenido del adjunto desde Zotero.")

        # Save file locally (ensure directory exists)
        DOWNLOADS_DIR.mkdir(parents=True, exist_ok=True)
        try:
            with open(local_path, 'wb') as f:
                f.write(file_content)
            print(f"File downloaded from Zotero Storage and saved locally: {local_path}")
            # Trigger Markdown generation in background if .txt does not exist
            txt_path = local_path.with_suffix('.txt')
            if not txt_path.exists():
                background_tasks.add_task(generate_md_for_pdf, local_path.name)
            # Serve the newly saved local file
            return FileResponse(path=local_path, media_type=content_type, filename=filename)
        except IOError as e:
            print(f"Error saving file locally {local_path} after Zotero download: {e}")
            raise HTTPException(status_code=500, detail=f"Error al guardar el archivo localmente tras descarga Zotero: {e}")

    except Exception as e:
        # Catch potential exceptions from pyzotero or file operations
        print(f"Error fetching/processing attachment {attachment_key} from Zotero Storage: {e}")
        if "404" in str(e): # Basic check
            raise HTTPException(404, f"Adjunto {attachment_key} no encontrado en Zotero Storage: {e}")
        else:
            raise HTTPException(500, f"Error al obtener el adjunto desde Zotero Storage: {e}")

    # If all methods failed (e.g., WebDAV failed AND Zotero Storage failed)
    print(f"All methods failed to retrieve attachment {attachment_key} ({filename})")
    raise HTTPException(status_code=404, detail="No se pudo obtener el adjunto por ningún método.")


# --- Endpoints para notas y anotaciones ---

@app.get("/api/libraries/{lib_type}/{lib_id}/items/{item_key}/notes")
def get_notes_and_annotations(lib_type: str, lib_id: str, item_key: str):
    zot = user_zot if lib_type == "user" else group_client(lib_id)
    children = zot.children(item_key)
    notes = [c for c in children if c['data']['itemType'] == 'note']
    annotations = [c for c in children if c['data']['itemType'] == 'annotation']
    return {
        "notes": notes,
        "annotations": annotations
    }

# --- New Endpoint to Clear Downloads ---
@app.post("/api/clear-downloads")
def clear_downloads():
    """Deletes all files in the downloads directory."""
    deleted_count = 0
    errors = []
    print(f"Intentando borrar archivos en: {DOWNLOADS_DIR}")
    if not DOWNLOADS_DIR.exists() or not DOWNLOADS_DIR.is_dir():
        print("El directorio de descargas no existe.")
        return {"message": "El directorio de descargas no existe.", "deleted_count": 0}

    try:
        for item in DOWNLOADS_DIR.iterdir():
            if item.is_file():
                try:
                    item.unlink() # Delete the file
                    deleted_count += 1
                    print(f"Eliminado: {item.name}")
                except OSError as e:
                    error_msg = f"Error eliminando archivo {item.name}: {e}"
                    print(error_msg)
                    errors.append(error_msg)
    except Exception as e:
        error_msg = f"Error inesperado al iterar el directorio de descargas: {e}"
        print(error_msg)
        raise HTTPException(status_code=500, detail=error_msg)

    if errors:
        return {
            "message": f"Proceso completado con errores. {deleted_count} archivos eliminados.",
            "deleted_count": deleted_count,
            "errors": errors
        }
    else:
        return {"message": f"Todos los archivos ({deleted_count}) en el directorio de descargas han sido eliminados.", "deleted_count": deleted_count}

# --- End New Endpoint ---

@app.get("/api/sqlite/libraries/{lib_type}/{lib_id}/collections")
def sqlite_collections(lib_type: str, lib_id: str):
    """Devuelve todas las colecciones (y subcolecciones) desde SQLite."""
    rows = get_collections(lib_type, lib_id)
    # Devuelve como lista de dicts
    return [
        {"id": row[0], "name": row[1], "parent_id": row[2]} for row in rows
    ]

@app.get("/api/sqlite/libraries/{lib_type}/{lib_id}/items")
def sqlite_all_items(lib_type: str, lib_id: str):
    """Devuelve todos los ítems de una biblioteca desde SQLite."""
    from backend.db import get_all_items
    rows = get_all_items(lib_type, lib_id)
    zot = user_zot if lib_type == "user" else group_client(lib_id)
    result = []
    
    for row in rows:
        item_id, title, metadata_str = row
        metadata = json.loads(metadata_str) if metadata_str else {}
        
        # Verificar si tiene adjuntos
        has_attachment = False
        try:
            children = zot.children(item_id)
            for child in children:
                if child.get('data', {}).get('itemType') == 'attachment':
                    has_attachment = True
                    break
        except Exception as e:
            print(f"Error verificando adjuntos para ítem {item_id}: {e}")
        
        result.append({
            "id": item_id,
            "key": item_id,  # Usar el mismo valor para key e id
            "title": title,
            "metadata": metadata,
            "hasAttachment": has_attachment,
            "itemType": metadata.get("itemType", ""),
            "creators": format_creators(metadata.get("creators", [])),
            "date": metadata.get("date", ""),
            "tags": [t.get('tag') for t in metadata.get("tags", [])],
            "publisher": metadata.get("publisher", ""),
            "publicationTitle": metadata.get("publicationTitle", metadata.get("publication", ""))
        })
    
    return result

@app.get("/api/sqlite/libraries/{lib_type}/{lib_id}/collections/{collection_id}/subcollections")
def sqlite_subcollections(lib_type: str, lib_id: str, collection_id: str):
    """Devuelve las subcolecciones de una colección desde SQLite, incluyendo el número de subcolecciones hijas."""
    from backend.db import get_connection
    rows = get_subcollections(collection_id, lib_type, lib_id)
    result = []
    conn = get_connection()
    cur = conn.cursor()
    for row in rows:
        sub_id, sub_name = row
        cur.execute('''SELECT COUNT(*) FROM collections WHERE parent_id=? AND library_type=? AND library_id=?''', (sub_id, lib_type, lib_id))
        num = cur.fetchone()[0]
        result.append({
            "id": sub_id,
            "name": sub_name,
            "numCollections": num
        })
    conn.close()
    return result

@app.get("/api/sqlite/libraries/{lib_type}/{lib_id}/collections/{collection_id}/items")
def sqlite_collection_items(lib_type: str, lib_id: str, collection_id: str):
    """Devuelve los ítems de una colección desde SQLite."""
    rows = get_items(collection_id, lib_type, lib_id)
    return [
        {"id": row[0], "title": row[1], "metadata": row[2]} for row in rows
    ]

@app.get("/api/sqlite/libraries/{lib_type}/{lib_id}/collections/{collection_id}/items_recursive")
def sqlite_collection_items_recursive(lib_type: str, lib_id: str, collection_id: str, recursive: bool = True):
    """Devuelve los ítems de una colección y, si recursive=True, de todas sus subcolecciones (sin duplicados)."""
    from backend.db import get_items_for_collection, get_subcollections
    zot = user_zot if lib_type == "user" else group_client(lib_id)
    seen = set()
    result = []
    
    def collect_items(col_id):
        rows = get_items_for_collection(col_id, lib_type, lib_id)
        for row in rows:
            item_id, title, metadata_str = row
            if item_id not in seen:
                seen.add(item_id)
                metadata = json.loads(metadata_str) if metadata_str else {}
                
                # Verificar si tiene adjuntos
                has_attachment = False
                try:
                    children = zot.children(item_id)
                    for child in children:
                        if child.get('data', {}).get('itemType') == 'attachment':
                            has_attachment = True
                            break
                except Exception as e:
                    print(f"Error verificando adjuntos para ítem {item_id}: {e}")
                
                result.append({
                    "id": item_id,
                    "key": item_id,  # Usar el mismo valor para key e id
                    "title": title,
                    "metadata": metadata,
                    "hasAttachment": has_attachment,
                    "itemType": metadata.get("itemType", ""),
                    "creators": format_creators(metadata.get("creators", [])),
                    "date": metadata.get("date", ""),
                    "tags": [t.get('tag') for t in metadata.get("tags", [])],
                    "publisher": metadata.get("publisher", ""),
                    "publicationTitle": metadata.get("publicationTitle", metadata.get("publication", ""))
                })
        
        if recursive:
            for subcol in get_subcollections(col_id, lib_type, lib_id):
                collect_items(subcol[0])
    
    collect_items(collection_id)
    return result

@app.get("/api/sqlite/libraries/{lib_type}/{lib_id}/items/search")
def sqlite_search_items(lib_type: str, lib_id: str, q: str):
    """Busca ítems por texto en SQLite."""
    rows = search_items(q, lib_type, lib_id)
    return [
        {"id": row[0], "title": row[1], "metadata": row[2]} for row in rows
    ]

@app.get("/api/sqlite/libraries/{lib_type}/{lib_id}/items/{item_id}")
def sqlite_item_detail(lib_type: str, lib_id: str, item_id: str):
    conn = get_connection()
    cur = conn.cursor()
    cur.execute('''
        SELECT id, title, metadata FROM items WHERE id=? AND library_type=? AND library_id=?
    ''', (item_id, lib_type, lib_id))
    row = cur.fetchone()
    conn.close()
    
    if not row:
        raise HTTPException(404, "Ítem no encontrado en SQLite")
    
    # metadata es un string JSON, lo parseamos si existe
    metadata = json.loads(row[2]) if row[2] else {}
    
    # Consultar los attachments directamente a Zotero para asegurarnos de tener la información más actualizada
    zot = user_zot if lib_type == "user" else group_client(lib_id)
    try:
        children = zot.children(item_id)
        
        # Filtrar adjuntos - solo mantener PDFs cuando hay múltiples adjuntos
        filtered_children = [
            att for att in children 
            if att.get('data', {}).get('itemType') == 'attachment'
        ]
        
        # Si hay más de un adjunto, filtrar solo por PDFs
        if len(filtered_children) > 1:
            pdf_attachments = [
                att for att in filtered_children
                if att.get('data', {}).get('contentType') == 'application/pdf'
            ]
            # Si encontramos PDFs, usamos solo esos, de lo contrario mantenemos todos los adjuntos
            if pdf_attachments:
                total_attachments = len(filtered_children)
                filtered_children = pdf_attachments
                pdf_count = len(filtered_children)
                print(f"Item {item_id}: Filtered to {pdf_count} PDF attachments from {total_attachments} total attachments")
                
        # Formatear la lista de adjuntos
        attachments = [
            {
                "key": att['key'],
                "title": att['data'].get('title', ''),
                "filename": att['data'].get('filename', ''),
                "contentType": att['data'].get('contentType', '')
            }
            for att in filtered_children
        ]
    except Exception as e:
        print(f"Error obteniendo adjuntos para el ítem {item_id}: {e}")
        attachments = []
    
    return {
        "id": row[0],
        "key": row[0],  # Usar el mismo valor para key e id
        "title": row[1],
        "metadata": metadata,
        "hasAttachment": len(attachments) > 0,
        "attachments": attachments,
        "itemType": metadata.get("itemType", ""),
        "creators": format_creators(metadata.get("creators", [])),
        "date": metadata.get("date", ""),
        "tags": [t.get('tag') for t in metadata.get("tags", [])],
        "publisher": metadata.get("publisher", ""),
        "publicationTitle": metadata.get("publicationTitle", metadata.get("publication", ""))
    }

# archivos estáticos (frontend compilado)
# Make sure this mount is AFTER all API routers
app.mount("/", StaticFiles(directory="frontend", html=True), name="frontend")
