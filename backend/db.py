import sqlite3
from pathlib import Path

DB_PATH = Path(__file__).parent / "database.db"

def get_connection():
    return sqlite3.connect(DB_PATH)

def init_db():
    conn = get_connection()
    cur = conn.cursor()
    # Crear tabla de colecciones
    cur.execute('''
        CREATE TABLE IF NOT EXISTS collections (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            parent_id TEXT,
            library_type TEXT NOT NULL,
            library_id TEXT NOT NULL
        )
    ''')
    # Crear tabla de ítems
    cur.execute('''
        CREATE TABLE IF NOT EXISTS items (
            id TEXT PRIMARY KEY,
            title TEXT,
            library_type TEXT NOT NULL,
            library_id TEXT NOT NULL,
            metadata TEXT
        )
    ''')
    # Tabla intermedia para relación muchos-a-muchos ítem-colección
    cur.execute('''
        CREATE TABLE IF NOT EXISTS item_collections (
            item_id TEXT NOT NULL,
            collection_id TEXT NOT NULL,
            library_type TEXT NOT NULL,
            library_id TEXT NOT NULL,
            PRIMARY KEY (item_id, collection_id, library_type, library_id),
            FOREIGN KEY (item_id) REFERENCES items(id),
            FOREIGN KEY (collection_id) REFERENCES collections(id)
        )
    ''')
    conn.commit()
    conn.close()

def insert_collection(id, name, parent_id, library_type, library_id):
    conn = get_connection()
    cur = conn.cursor()
    cur.execute('''
        INSERT OR REPLACE INTO collections (id, name, parent_id, library_type, library_id)
        VALUES (?, ?, ?, ?, ?)
    ''', (id, name, parent_id, library_type, library_id))
    conn.commit()
    conn.close()

def insert_item(id, title, library_type, library_id, metadata):
    conn = get_connection()
    cur = conn.cursor()
    cur.execute('''
        INSERT OR REPLACE INTO items (id, title, library_type, library_id, metadata)
        VALUES (?, ?, ?, ?, ?)
    ''', (id, title, library_type, library_id, metadata))
    conn.commit()
    conn.close()

def insert_item_collection(item_id, collection_id, library_type, library_id):
    conn = get_connection()
    cur = conn.cursor()
    cur.execute('''
        INSERT OR IGNORE INTO item_collections (item_id, collection_id, library_type, library_id)
        VALUES (?, ?, ?, ?)
    ''', (item_id, collection_id, library_type, library_id))
    conn.commit()
    conn.close()

def get_collections(library_type, library_id):
    conn = get_connection()
    cur = conn.cursor()
    cur.execute('''
        SELECT id, name, parent_id FROM collections WHERE library_type=? AND library_id=?
    ''', (library_type, library_id))
    rows = cur.fetchall()
    conn.close()
    return rows

def get_subcollections(parent_id, library_type, library_id):
    conn = get_connection()
    cur = conn.cursor()
    cur.execute('''
        SELECT id, name FROM collections WHERE parent_id=? AND library_type=? AND library_id=?
    ''', (parent_id, library_type, library_id))
    rows = cur.fetchall()
    conn.close()
    return rows

def get_items(collection_id, library_type, library_id):
    conn = get_connection()
    cur = conn.cursor()
    cur.execute('''
        SELECT i.id, i.title, i.metadata FROM items i
        JOIN item_collections ic ON i.id = ic.item_id
        WHERE ic.collection_id=? AND ic.library_type=? AND ic.library_id=?
    ''', (collection_id, library_type, library_id))
    rows = cur.fetchall()
    conn.close()
    return rows

def get_all_items(library_type, library_id):
    conn = get_connection()
    cur = conn.cursor()
    cur.execute('''
        SELECT id, title, metadata FROM items 
        WHERE library_type=? AND library_id=?
    ''', (library_type, library_id))
    rows = cur.fetchall()
    conn.close()
    return rows

def get_items_for_collection(collection_id, library_type, library_id):
    conn = get_connection()
    cur = conn.cursor()
    cur.execute('''
        SELECT i.id, i.title, i.metadata FROM items i
        JOIN item_collections ic ON i.id = ic.item_id
        WHERE ic.collection_id=? AND ic.library_type=? AND ic.library_id=?
    ''', (collection_id, library_type, library_id))
    rows = cur.fetchall()
    conn.close()
    return rows

def search_items(query, library_type, library_id):
    conn = get_connection()
    cur = conn.cursor()
    cur.execute('''
        SELECT id, title, metadata FROM items WHERE library_type=? AND library_id=? AND title LIKE ?
    ''', (library_type, library_id, f"%{query}%"))
    rows = cur.fetchall()
    conn.close()
    return rows

# Inicializar la base de datos al importar
init_db()
