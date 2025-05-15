import { useEffect, useRef, useState } from 'react'
import Header from './components/Header'
import SidebarLibraries from './components/SidebarLibraries'
import DocumentList from './components/DocumentList'
import RightPanel from './components/RightPanel'
import Reader from './components/Reader';
import ErrorBoundary from './components/ErrorBoundary';
import './index.css'

export default function App() {
  const [libs, setLibs] = useState([])
  const [activeLib, setActiveLib] = useState(null)
  const [activeDoc, setActiveDoc] = useState(null)
  const [collections, setCollections] = useState({}) // Store collections per library ID
  const [activeCollectionKey, setActiveCollectionKey] = useState(null); // State for selected collection
  const [showSidebar, setShowSidebar] = useState(true);
  const [showRightPanel, setShowRightPanel] = useState(true);
  const [sidebarWidth, setSidebarWidth] = useState(320); // px
  const [rightPanelWidth, setRightPanelWidth] = useState(320); // px
  const [numPages, setNumPages] = useState(null);
  const [currentPage, setCurrentPage] = useState(1);
  const sidebarRef = useRef();
  const rightPanelRef = useRef();
  const [reader, setReader] = useState(null); // { fileUrl, filename }

  // Handler for resizing sidebar
  const startSidebarResize = (e) => {
    e.preventDefault();
    const startX = e.touches ? e.touches[0].clientX : e.clientX;
    const startWidth = sidebarWidth;
    const onMove = (ev) => {
      const clientX = ev.touches ? ev.touches[0].clientX : ev.clientX;
      let newWidth = startWidth + (clientX - startX);
      newWidth = Math.max(180, Math.min(newWidth, 600));
      setSidebarWidth(newWidth);
    };
    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('touchmove', onMove);
      window.removeEventListener('mouseup', onUp);
      window.removeEventListener('touchend', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('touchmove', onMove);
    window.addEventListener('mouseup', onUp);
    window.addEventListener('touchend', onUp);
  };

  // Handler for resizing right panel
  const startRightPanelResize = (e) => {
    e.preventDefault();
    const startX = e.touches ? e.touches[0].clientX : e.clientX;
    const startWidth = rightPanelWidth;
    const onMove = (ev) => {
      const clientX = ev.touches ? ev.touches[0].clientX : ev.clientX;
      let newWidth = startWidth - (clientX - startX);
      newWidth = Math.max(180, Math.min(newWidth, 600));
      setRightPanelWidth(newWidth);
    };
    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('touchmove', onMove);
      window.removeEventListener('mouseup', onUp);
      window.removeEventListener('touchend', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('touchmove', onMove);
    window.addEventListener('mouseup', onUp);
    window.addEventListener('touchend', onUp);
  };

  useEffect(() => {
    fetch('/api/libraries')
      .then(r => r.json())
      .then(setLibs)
  }, [])

  // Fetch collections when activeLib changes
  useEffect(() => {
    if (activeLib) {
      if (!collections[activeLib.id]) {
        fetch(`/api/sqlite/libraries/${activeLib.type}/${activeLib.id}/collections`)
          .then(r => {
            if (!r.ok) throw new Error(`HTTP error! status: ${r.status}`);
            return r.json();
          })
          .then(data => {
            // Construir jerarquía a partir de la lista plana y transformar al formato esperado por SidebarLibraries
            const byId = {};
            data.forEach(col => {
              byId[col.id] = {
                key: col.id, // Usamos id como key
                data: { name: col.name }, // name dentro de data
                meta: { numCollections: 0 },
                subcollections: []
              };
            });
            const roots = [];
            data.forEach(col => {
              if (col.parent_id && byId[col.parent_id]) {
                byId[col.parent_id].subcollections.push(byId[col.id]);
                byId[col.parent_id].meta.numCollections = byId[col.parent_id].subcollections.length;
              } else {
                roots.push(byId[col.id]);
              }
            });
            // Ordenar recursivamente todas las colecciones y subcolecciones por nombre
            function sortCollections(arr) {
              arr.sort((a, b) => a.data.name.localeCompare(b.data.name, undefined, { sensitivity: 'base' }));
              arr.forEach(col => {
                if (col.subcollections && col.subcollections.length > 0) {
                  sortCollections(col.subcollections);
                }
              });
            }
            sortCollections(roots);
            setCollections(prev => ({ ...prev, [activeLib.id]: roots }));
          })
          .catch(error => console.error("Error fetching collections:", error));
      }
    }
  }, [activeLib, collections]);

  const handleSelectLibrary = (library) => {
    setActiveLib(library);
    setActiveDoc(null); // Reset active document
    setActiveCollectionKey(null); // Reset active collection when library changes
  };

  const handleSelectCollection = (collectionKey) => {
    setActiveCollectionKey(collectionKey);
    setActiveDoc(null); // Reset active document when collection changes
  };

  const handleSelectDocument = async (doc) => {
    if (!activeLib || !doc) {
      setActiveDoc(null);
      return;
    }
    try {
      // Cambiado a endpoint SQLite
      const res = await fetch(`/api/sqlite/libraries/${activeLib.type}/${activeLib.id}/items/${doc.key || doc.id}`);
      if (!res.ok) throw new Error('Error fetching document details');
      const fullDoc = await res.json();
      setActiveDoc(fullDoc);
    } catch (e) {
      setActiveDoc({ ...doc, error: 'No se pudo cargar detalles' });
    }
  };

  // Handler to open reader
  const handleOpenReader = (attachment) => {
    if (!activeLib || !attachment) return;
    const fileUrl = `/api/libraries/${activeLib.type}/${activeLib.id}/attachments/${attachment.key}/file`;
    // Reset page view and then open reader
    setCurrentPage(1);
    setNumPages(null);
    setReader({ fileUrl, filename: attachment.title || attachment.filename || 'Documento' });
  };
  // Handler to close reader
  const handleCloseReader = () => setReader(null);

  return (
    <div className="flex flex-col h-screen">
      <Header />
      <div className="flex flex-1 overflow-hidden relative">
        {showSidebar ? (
          <div style={{ width: sidebarWidth, minWidth: 120, maxWidth: 600, position: 'relative', zIndex: 10, display: 'flex' }}>
            <SidebarLibraries
              libs={libs}
              active={activeLib}
              collections={collections[activeLib?.id] || []}
              onSelect={handleSelectLibrary}
              onSelectCollection={handleSelectCollection}
              activeCollectionKey={activeCollectionKey}
              onHide={() => setShowSidebar(false)}
              width={sidebarWidth}
              // Page thumbnails props
              numPages={numPages}
              currentPage={currentPage}
              pdfUrl={reader?.fileUrl}
              onPageChange={setCurrentPage}
            />
            {/* Barra de resize absolutamente posicionada y con zIndex alto */}
            <div
              style={{ width: 8, cursor: 'col-resize', background: '#e5e7eb', position: 'absolute', right: 0, top: 0, bottom: 0, zIndex: 100, pointerEvents: 'auto' }}
              onMouseDown={startSidebarResize}
              onTouchStart={startSidebarResize}
              aria-label="Resize sidebar"
            />
            {/* Botón de flecha para ocultar sidebar izquierdo */}
            <button
              className="absolute right-0 top-1/2 -translate-y-1/2 z-20 bg-gray-200 border rounded-l px-2 py-1 text-xs hover:bg-gray-300"
              style={{ transform: 'translateY(-50%) translateX(100%)' }}
              onClick={() => setShowSidebar(false)}
              aria-label="Ocultar menú"
            >
              ◀
            </button>
          </div>
        ) : (
          <button
            className="absolute left-0 top-1/2 -translate-y-1/2 z-20 bg-gray-200 border rounded-r px-2 py-1 text-xs hover:bg-gray-300"
            onClick={() => setShowSidebar(true)}
            aria-label="Mostrar menú"
          >
            ▶
          </button>
        )}
        <div className="flex-1 flex overflow-hidden" style={{ minWidth: 0, position: 'relative' }}>
          {/* Barra de resize del right panel absolutamente posicionada y con zIndex alto */}
          {showRightPanel && (
            <div
              style={{ width: 8, cursor: 'col-resize', background: '#e5e7eb', position: 'absolute', right: rightPanelWidth, top: 0, bottom: 0, zIndex: 100, pointerEvents: 'auto' }}
              onMouseDown={startRightPanelResize}
              onTouchStart={startRightPanelResize}
              aria-label="Resize right panel"
            />
          )}
          {reader ? (
            <ErrorBoundary>
              <div className="flex-1 overflow-hidden bg-gray-100" style={{ pointerEvents: 'auto' }}>
                <Reader
                  fileUrl={reader.fileUrl}
                  filename={reader.filename}
                  onClose={handleCloseReader}
                  doc={activeDoc}
                  lib={activeLib}
                  onDocumentLoad={setNumPages}
                  onPageChange={setCurrentPage}
                  currentPage={currentPage}
                />
              </div>
            </ErrorBoundary>
          ) : (
            <ErrorBoundary>
              <DocumentList
                lib={activeLib}
                active={activeDoc}
                onSelect={handleSelectDocument}
                activeCollectionKey={activeCollectionKey}
                onOpenReader={handleOpenReader}
              />
            </ErrorBoundary>
          )}
          {showRightPanel ? (
            <div style={{ width: rightPanelWidth, minWidth: 120, maxWidth: 600, position: 'relative' }}>
              {/* Botón de flecha para ocultar sidebar derecho */}
              <button
                className="absolute left-0 top-1/2 -translate-y-1/2 z-20 bg-gray-200 border rounded-r px-2 py-1 text-xs hover:bg-gray-300"
                style={{ transform: 'translateY(-50%) translateX(-100%)' }}
                onClick={() => setShowRightPanel(false)}
                aria-label="Ocultar panel"
              >
                ▶
              </button>
              <RightPanel doc={activeDoc} onHide={() => setShowRightPanel(false)} lib={activeLib} width={rightPanelWidth} />
            </div>
          ) : (
            <button
              className="absolute right-0 top-1/2 -translate-y-1/2 z-20 bg-gray-200 border rounded-l px-2 py-1 text-xs hover:bg-gray-300"
              onClick={() => setShowRightPanel(true)}
              aria-label="Mostrar panel"
            >
              ◀
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
