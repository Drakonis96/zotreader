import { useState, useEffect } from 'react';
import { DndProvider, useDrag, useDrop } from 'react-dnd';
import { HTML5Backend } from 'react-dnd-html5-backend';
import LoadingDots from './LoadingDots';
import { Document, Page } from 'react-pdf';

const ITEM_TYPE = 'COLLECTION';

function CollectionItem({ collection, libType, libId, level = 0, onSelectCollection, activeCollectionKey }) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [subcollections, setSubcollections] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const hasSubcollections = collection.meta.numCollections > 0;
  const indent = level * 8;

  const fetchSubcollections = () => {
    if (!isLoading && hasSubcollections && !subcollections.length) {
      setIsLoading(true);
      fetch(`/api/sqlite/libraries/${libType}/${libId}/collections/${collection.id || collection.key}/subcollections`)
        .then(response => response.json())
        .then(data => {
          // Transformar cada subcolección al formato esperado por CollectionItem
          const formatted = data.map(col => ({
            key: col.id,
            data: { name: col.name },
            meta: { numCollections: col.numCollections },
            subcollections: []
          }));
          // Ordenar alfabéticamente las subcolecciones
          formatted.sort((a, b) => a.data.name.localeCompare(b.data.name, undefined, { sensitivity: 'base' }));
          setSubcollections(formatted);
        })
        .catch(() => {})
        .finally(() => setIsLoading(false));
    }
  };

  const handleToggle = () => {
    setIsExpanded(!isExpanded);
    if (!isExpanded && hasSubcollections) fetchSubcollections();
  };

  const isActive = collection.key === activeCollectionKey;

  // Drag & Drop hooks (solo para visual, no mover)
  const [{ isDragging }, drag] = useDrag({
    type: ITEM_TYPE,
    item: { key: collection.key },
    collect: (monitor) => ({ isDragging: monitor.isDragging() })
  });
  const [{ isOver, canDrop }, drop] = useDrop({
    accept: ITEM_TYPE,
    canDrop: () => false,
    collect: (monitor) => ({
      isOver: monitor.isOver({ shallow: true }),
      canDrop: monitor.canDrop()
    })
  });

  return (
    <div
      ref={drop}
      style={{ paddingLeft: `${indent}px`, opacity: isDragging ? 0.5 : 1, background: isOver && canDrop ? '#e0f7fa' : undefined }}
    >
      <div ref={drag} className={`flex items-center ${isActive ? 'bg-blue-100' : ''}`}>
        {hasSubcollections && (
          <button onClick={handleToggle} className="mr-1 text-gray-500 hover:text-gray-700">{isExpanded ? '▼' : '▶'}</button>
        )}
        {!hasSubcollections && <span className="w-4 mr-1"></span>}
        <button
          onClick={() => onSelectCollection(collection.key)}
          className={`flex-1 text-left py-1 text-sm hover:bg-gray-50 ${isActive ? 'font-semibold' : ''}`}
        >
          {collection.data.name}
        </button>
      </div>
      {isExpanded && isLoading && <div className="pl-4 text-xs text-gray-500"><LoadingDots className="inline" /></div>}
      {isExpanded && !isLoading && subcollections.length > 0 && (
        <div>
          {subcollections.map(subCol => (
            <CollectionItem
              key={subCol.key}
              collection={subCol}
              libType={libType}
              libId={libId}
              level={level + 1}
              onSelectCollection={onSelectCollection}
              activeCollectionKey={activeCollectionKey}
            />
          ))}
        </div>
      )}
      {isExpanded && !isLoading && hasSubcollections && subcollections.length === 0 && (
        <div className="pl-4 text-xs text-gray-400 italic">No subcollections</div>
      )}
    </div>
  );
}

export default function SidebarLibraries({ libs, active, collections, onSelect, onSelectCollection, activeCollectionKey, onHide, width, numPages, currentPage, pdfUrl, onPageChange }){
  const [search, setSearch] = useState("");
  const [localLibs, setLocalLibs] = useState(libs || []);
  const [localCollections, setLocalCollections] = useState(collections || []);
  const [activeTab, setActiveTab] = useState('library');
  // Determine thumbnail width: sidebar width minus padding
  const thumbWidth = width ? width - 16 : 80;

  useEffect(() => { setLocalLibs(libs || []); }, [libs]);
  useEffect(() => { setLocalCollections(collections || []); }, [collections]);

  function filterCollections(cols, query) {
    if (!query) return cols;
    return cols
      .map(col => {
        const match = col.data.name.toLowerCase().includes(query.toLowerCase());
        let filteredSubs = [];
        if (col.meta.numCollections > 0 && col.subcollections) {
          filteredSubs = filterCollections(col.subcollections, query);
        }
        if (match || (filteredSubs && filteredSubs.length > 0)) {
          return { ...col, subcollections: filteredSubs };
        }
        return null;
      })
      .filter(Boolean);
  }
  const filteredCollections = filterCollections(localCollections, search);

  const renderPagesView = () => (
    <div className="p-2 overflow-y-auto">
      {pdfUrl && numPages > 0 ? (
        <Document file={pdfUrl} loading={<div>Loading...</div>}>
          {Array.from({ length: numPages }, (_, i) => {
            const page = i + 1;
            const isActive = page === currentPage;
            return (
              <div
                key={page}
                onClick={() => onPageChange(page)}
                style={{
                  cursor: 'pointer',
                  marginBottom: 4,
                  ...(isActive ? { border: '2px solid #B30333', borderRadius: '4px' } : {}),
                }}
              >
                <Page
                  pageNumber={page}
                  width={thumbWidth}
                  renderTextLayer={false}
                  renderAnnotationLayer={false}
                />
              </div>
            );
          })}
        </Document>
      ) : (
        <div className="text-xs text-gray-500">No PDF or pages available</div>
      )}
    </div>
  );

  return (
    <div className="flex flex-col h-full">
      <div className="flex border-b">
        <button
          className={`flex-1 py-2 text-sm ${activeTab==='library' ? 'font-semibold border-b-2 border-gray-700' : ''}`}
          onClick={()=>setActiveTab('library')}
        >My Library</button>
        <button
          className={`flex-1 py-2 text-sm ${activeTab==='pages' ? 'font-semibold border-b-2 border-gray-700' : ''}`}
          onClick={()=>setActiveTab('pages')}
        >Pages View</button>
      </div>
      {activeTab === 'library' ? (
        <DndProvider backend={HTML5Backend}>
          <aside className="border-r overflow-y-auto relative" style={{ width: width || '100%', minWidth: 120, maxWidth: 600 }}>
            <div className="p-2">
              <input
                className="w-full text-xs border rounded px-2 py-1 mb-2"
                placeholder="Buscar colección..."
                value={search}
                onChange={e => setSearch(e.target.value)}
              />
            </div>
            {localLibs.map(l => (
              <div key={l.id} className="group flex items-center">
                <button
                  onClick={() => onSelect(l)}
                  className={`flex-1 text-left px-3 py-2 hover:bg-gray-100 ${active?.id === l.id ? 'bg-gray-100 font-medium' : ''}`}
                >
                  {l.name}
                </button>
              </div>
            ))}
            {active?.id && (
              <div className="pl-1 mt-1 border-l ml-3">
                {filteredCollections && filteredCollections.length > 0 ? (
                  filteredCollections.map(col => (
                    <CollectionItem
                      key={col.key}
                      collection={col}
                      libType={active.type}
                      libId={active.id}
                      level={0}
                      onSelectCollection={onSelectCollection}
                      activeCollectionKey={activeCollectionKey}
                    />
                  ))
                ) : (
                  <div className="px-3 py-1 text-sm text-gray-400 italic"><LoadingDots /></div>
                )}
              </div>
            )}
          </aside>
        </DndProvider>
      ) : (
        <aside className="border-r overflow-y-auto relative" style={{ width: width || '100%', minWidth: 120, maxWidth: 600 }}>
          {renderPagesView()}
        </aside>
      )}
    </div>
  );
}
