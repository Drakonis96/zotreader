import { useEffect, useState } from 'react';
import { Resizable } from 'react-resizable'; // Import Resizable
import 'react-resizable/css/styles.css'; // Import default styles
import { DragDropContext, Droppable, Draggable } from 'react-beautiful-dnd';
import LoadingDots from './LoadingDots';

// Resizable Header Component
const ResizableTitle = ({ onResize, width, children }) => {
  if (!width) {
    return <th className="px-4 py-2 text-center font-medium text-gray-500 uppercase tracking-wider">{children}</th>;
  }
  return (
    <Resizable
      width={width}
      height={0} // Height is not needed for column resizing
      handle={<span className="react-resizable-handle" />} // Default handle
      onResize={onResize}
      draggableOpts={{ enableUserSelectHack: false }}
    >
      <th style={{ width: `${width}px` }} className="px-4 py-2 text-center font-medium text-gray-500 uppercase tracking-wider overflow-hidden">
        {children}
      </th>
    </Resizable>
  );
};

const DEFAULT_COLUMNS = [
  { key: 'title', label: 'Title' },
  { key: 'creator', label: 'Creator(s)' },
  { key: 'date', label: 'Date' },
  { key: 'type', label: 'Type' },
  { key: 'publisher', label: 'Publisher' },
  { key: 'publication', label: 'Publication' },
  { key: 'tags', label: 'Tags' },
  { key: 'url', label: 'URL' },
  { key: 'attach', label: 'Att.' },
];

export default function DocumentList({ lib, active, onSelect, activeCollectionKey, onOpenReader }) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  // State for column widths
  const [widths, setWidths] = useState({
    attach: 100,
    title: 400, // mucho más pequeño
    creator: 150,
    date: 100,
    type: 100,
    publisher: 150,
    publication: 150,
    url: 100,
    tags: 100,
  });

  const [columns, setColumns] = useState(DEFAULT_COLUMNS);

  // Estado para ordenación
  const [sortConfig, setSortConfig] = useState({ key: 'date', direction: 'desc' });

  // Estado para mostrar menú contextual de columna
  const [columnMenu, setColumnMenu] = useState({ visible: false, colIdx: null, x: 0, y: 0 });

  const handleResize = (key) => (e, { size }) => {
    setWidths(prev => ({
      ...prev,
      [key]: size.width,
    }));
  };

  // Drag and drop handlers for columns
  function onDragEnd(result) {
    if (!result.destination) return;
    const reordered = Array.from(columns);
    const [removed] = reordered.splice(result.source.index, 1);
    reordered.splice(result.destination.index, 0, removed);
    setColumns(reordered);
  }

  // Ordenar items según sortConfig
  const getSortedItems = (data) => {
    if (!sortConfig.key) return data;
    const sorted = [...data].sort((a, b) => {
      let aValue = a[sortConfig.key];
      let bValue = b[sortConfig.key];
      // Normalizar para strings y arrays
      if (Array.isArray(aValue)) aValue = aValue.join(', ');
      if (Array.isArray(bValue)) bValue = bValue.join(', ');
      if (typeof aValue === 'string' && typeof bValue === 'string') {
        return sortConfig.direction === 'asc'
          ? aValue.localeCompare(bValue, undefined, { sensitivity: 'base' })
          : bValue.localeCompare(aValue, undefined, { sensitivity: 'base' });
      }
      if (typeof aValue === 'number' && typeof bValue === 'number') {
        return sortConfig.direction === 'asc' ? aValue - bValue : bValue - aValue;
      }
      return 0;
    });
    return sorted;
  };

  // Click en cabecera para ordenar
  const handleHeaderClick = (colKey) => {
    setSortConfig(prev => {
      if (prev.key === colKey) {
        return { key: colKey, direction: prev.direction === 'asc' ? 'desc' : 'asc' };
      }
      return { key: colKey, direction: 'asc' };
    });
  };

  // Handler para doble clic en cabecera de columna
  const handleHeaderDoubleClick = (idx, e) => {
    e.preventDefault();
    setColumnMenu({ visible: true, colIdx: idx, x: e.clientX, y: e.clientY });
  };

  // Handler para mover columna
  const moveColumn = (direction) => {
    setColumns(cols => {
      const idx = columnMenu.colIdx;
      if (direction === 'left' && idx > 0) {
        const newCols = [...cols];
        [newCols[idx - 1], newCols[idx]] = [newCols[idx], newCols[idx - 1]];
        setColumnMenu({ ...columnMenu, visible: false });
        return newCols;
      }
      if (direction === 'right' && idx < cols.length - 1) {
        const newCols = [...cols];
        [newCols[idx], newCols[idx + 1]] = [newCols[idx + 1], newCols[idx]];
        setColumnMenu({ ...columnMenu, visible: false });
        return newCols;
      }
      setColumnMenu({ ...columnMenu, visible: false });
      return cols;
    });
  };

  // Cerrar menú contextual al hacer click fuera
  useEffect(() => {
    if (!columnMenu.visible) return;
    const handler = () => setColumnMenu({ ...columnMenu, visible: false });
    window.addEventListener('mousedown', handler);
    return () => window.removeEventListener('mousedown', handler);
  }, [columnMenu]);

  const formatCreators = (creators) => {
    if (!creators) return 'N/A';
    if (Array.isArray(creators)) {
      return creators.map(c => `${c.firstName || ''} ${c.lastName || ''}`.trim()).join(', ') || 'N/A';
    }
    if (typeof creators === 'string') {
      return creators; // Return as is if it's already a string
    }
    return 'N/A'; // Fallback
  };

  useEffect(() => {
    if (!lib) {
      setItems([]); // Clear items if no library is selected
      return;
    }

    setLoading(true);
    setError(null);

    let url;
    if (activeCollectionKey) {
      // Fetch items for the selected collection and all its subcollections
      url = `/api/sqlite/libraries/${lib.type}/${lib.id}/collections/${activeCollectionKey}/items_recursive?recursive=true`;
    } else {
      // Fetch top-level items for the selected library - Usar el mismo formato de endpoint
      url = `/api/sqlite/libraries/${lib.type}/${lib.id}/items`;
    }

    console.log(`Fetching items from URL: ${url}`); // Debugging

    fetch(url)
      .then(r => {
        if (!r.ok) {
          throw new Error(`HTTP error! status: ${r.status}`);
        }
        return r.json();
      })
      .then(data => {
        // Adaptar: si los ítems vienen con 'id', convertir a 'key' para coherencia
        const itemsWithKey = data.map(it => {
          const d = { ...it, key: it.key || it.id };
          // Normaliza publisher y publicationTitle
          d.publisher = it.publisher || (it.data && it.data.publisher) || '';
          d.publicationTitle = it.publicationTitle || (it.data && (it.data.publicationTitle || it.data.publication)) || '';
          // Normaliza tags a array de strings
          if (Array.isArray(it.tags)) {
            d.tags = it.tags.map(t => (typeof t === 'string' ? t : t.tag)).filter(Boolean);
          } else if (it.data && Array.isArray(it.data.tags)) {
            d.tags = it.data.tags.map(t => (typeof t === 'string' ? t : t.tag)).filter(Boolean);
          } else {
            d.tags = [];
          }
          return d;
        });
        console.log(`Received ${itemsWithKey.length} items`); // Debugging
        // Add basic sorting by date (descending) as an example, if date exists
        const sortedData = itemsWithKey.sort((a, b) => {
          const dateA = a.date || '0';
          const dateB = b.date || '0';
          return dateB.localeCompare(dateA); // Sort descending by date string
        });
        setItems(sortedData);
      })
      .catch(err => {
        console.error("Error fetching items:", err);
        setError(err.message);
        setItems([]); // Clear items on error
      })
      .finally(() => {
        setLoading(false);
      });
  }, [lib, activeCollectionKey]);

  const handleRowDoubleClick = async (doc) => {
    if (!lib || !doc) return;
    // Fetch full doc details to get attachments
    const res = await fetch(`/api/sqlite/libraries/${lib.type}/${lib.id}/items/${doc.key || doc.id}`);
    if (!res.ok) return;
    const fullDoc = await res.json();
    if (fullDoc.attachments && fullDoc.attachments.length > 0) {
      // First select the document to show its information
      onSelect(fullDoc);
      // Then open the reader with the first attachment
      onOpenReader(fullDoc.attachments[0]);
    }
  };

  const handleAttachmentClick = async (e, doc) => {
    e.stopPropagation();
    if (!lib || !doc) return;

    // Si es un attachment independiente, abrir en el reader
    if (doc.itemType === 'attachment') {
      onSelect(doc);
      onOpenReader(doc);
      return;
    }

    // Si no, comportamiento original: abrir el primer attachment en el reader
    const res = await fetch(`/api/sqlite/libraries/${lib.type}/${lib.id}/items/${doc.key || doc.id}`);
    if (!res.ok) return;
    const fullDoc = await res.json();
    if (fullDoc.attachments && fullDoc.attachments.length > 0) {
      onSelect(fullDoc);
      onOpenReader(fullDoc.attachments[0]);
    }
  };

  return (
    <main className="flex-1 overflow-y-auto p-4">
      {loading && <div className="text-center text-gray-500 pt-4"><LoadingDots /></div>}
      {error && <div className="text-center text-red-500 pt-4">Error loading items: {error}</div>}
      {!loading && !error && items.length === 0 && lib && (
        <div className="text-center text-gray-400 italic pt-4">
          {activeCollectionKey ? 'No items in this collection.' : 'No items in this library.'}
        </div>
      )}
      {!loading && !error && items.length > 0 && (
        <div style={{ width: '100%', overflowX: 'auto' }}>
          <table className="min-w-full text-sm table-fixed border border-gray-300" style={{ minWidth: 600 }}>
            <DragDropContext onDragEnd={onDragEnd}>
              <Droppable droppableId="columns" direction="horizontal">
                {(provided) => (
                  <thead className="bg-gray-50" ref={provided.innerRef} {...provided.droppableProps}>
                    <tr>
                      {columns.map((col, idx) => (
                        <Draggable key={col.key} draggableId={col.key} index={idx}>
                          {(provided, snapshot) => (
                            <Resizable
                              width={widths[col.key]}
                              height={0}
                              minConstraints={[40, 0]}
                              maxConstraints={[600, 0]}
                              handle={
                                <span
                                  className="react-resizable-handle group-hover:bg-blue-300"
                                  style={{
                                    cursor: 'col-resize',
                                    width: 8,
                                    right: 0,
                                    top: 0,
                                    bottom: 0,
                                    position: 'absolute',
                                    zIndex: 10,
                                    background: '#e5e7eb',
                                    transition: 'background 0.2s',
                                  }}
                                />
                              }
                              onResize={handleResize(col.key)}
                              draggableOpts={{ enableUserSelectHack: false }}
                            >
                              <th
                                ref={provided.innerRef}
                                {...provided.draggableProps}
                                style={{
                                  width: widths[col.key],
                                  minWidth: widths[col.key],
                                  maxWidth: widths[col.key],
                                  position: 'relative',
                                  background: snapshot.isDragging ? '#dbeafe' : undefined, // Tailwind blue-100
                                  zIndex: snapshot.isDragging ? 50 : undefined,
                                  userSelect: 'none',
                                  touchAction: 'none',
                                  cursor: 'pointer',
                                  borderRight: '1px solid #e5e7eb',
                                  borderBottom: '1px solid #e5e7eb',
                                  boxShadow: snapshot.isDragging ? '0 2px 8px rgba(59,130,246,0.15)' : undefined,
                                  transition: 'box-shadow 0.2s',
                                }}
                                className="px-4 py-2 text-center font-medium text-gray-500 uppercase tracking-wider overflow-hidden select-none group"
                                onClick={() => handleHeaderClick(col.key)}
                                onDoubleClick={e => handleHeaderDoubleClick(idx, e)}
                              >
                                <span className="flex items-center">
                                  <span
                                    {...provided.dragHandleProps}
                                    className="mr-2 cursor-grab active:cursor-grabbing text-gray-400 hover:text-blue-500"
                                    title="Drag to move column"
                                    style={{ display: 'inline-flex', alignItems: 'center', fontSize: 16 }}
                                    onClick={e => e.stopPropagation()} // Evita que el click en el handle ordene
                                  >
                                    <svg width="14" height="14" viewBox="0 0 20 20" fill="none"><circle cx="5" cy="6" r="1.5" fill="currentColor"/><circle cx="5" cy="10" r="1.5" fill="currentColor"/><circle cx="5" cy="14" r="1.5" fill="currentColor"/><circle cx="10" cy="6" r="1.5" fill="currentColor"/><circle cx="10" cy="10" r="1.5" fill="currentColor"/><circle cx="10" cy="14" r="1.5" fill="currentColor"/></svg>
                                  </span>
                                  {col.label}
                                  {sortConfig.key === col.key && (
                                    <span className="ml-1 text-xs">
                                      {sortConfig.direction === 'asc' ? '▲' : '▼'}
                                    </span>
                                  )}
                                </span>
                              </th>
                            </Resizable>
                          )}
                        </Draggable>
                      ))}
                      {provided.placeholder}
                    </tr>
                  </thead>
                )}
              </Droppable>
            </DragDropContext>
            <tbody className="bg-white divide-y divide-gray-200">
              {getSortedItems(items).map(it => (
                <tr
                  key={it.key}
                  onClick={() => onSelect(it)}
                  onDoubleClick={() => handleRowDoubleClick(it)}
                  className={`hover:bg-gray-50 cursor-pointer ${active?.key === it.key ? 'bg-blue-50' : ''}`}
                >
                  {columns.map(col => {
                    if (col.key === 'attach') {
                      return (
                        <td key={col.key} style={{ width: widths.attach, minWidth: widths.attach, maxWidth: widths.attach, borderRight: '1px solid #e5e7eb', borderBottom: '1px solid #e5e7eb' }} className="px-4 py-2 whitespace-nowrap text-center overflow-hidden truncate">
                          {(it.itemType === 'attachment' || it.hasAttachment) ? (
                            <span
                              onClick={(e) => handleAttachmentClick(e, it)}
                              title="View attachment"
                              style={{ cursor: 'pointer' }}
                            >
                              <img src="/icons/attachment.svg" alt="Has attachment" className="inline-block w-5 h-5 text-gray-500" />
                            </span>
                          ) : (
                            <span className="text-gray-300">—</span>
                          )}
                        </td>
                      );
                    }
                    if (col.key === 'title') {
                      return (
                        <td key={col.key} style={{ width: widths.title, minWidth: widths.title, maxWidth: widths.title, borderRight: '1px solid #e5e7eb', borderBottom: '1px solid #e5e7eb' }} className={`px-4 py-2 font-medium whitespace-nowrap truncate overflow-hidden ${active?.key === it.key ? 'text-blue-800' : 'text-gray-900'}`}>{it.title || "(Untitled)"}</td>
                      );
                    }
                    if (col.key === 'creator') {
                      return (
                        <td key={col.key} style={{ width: widths.creator, minWidth: widths.creator, maxWidth: widths.creator, borderRight: '1px solid #e5e7eb', borderBottom: '1px solid #e5e7eb' }} className="px-4 py-2 text-gray-600 whitespace-nowrap truncate overflow-hidden">{formatCreators(it.creators)}</td>
                      );
                    }
                    if (col.key === 'date') {
                      return (
                        <td key={col.key} style={{ width: widths.date, minWidth: widths.date, maxWidth: widths.date, borderRight: '1px solid #e5e7eb', borderBottom: '1px solid #e5e7eb' }} className="px-4 py-2 text-gray-500 whitespace-nowrap overflow-hidden truncate">{it.date || 'No date'}</td>
                      );
                    }
                    if (col.key === 'type') {
                      return (
                        <td key={col.key} style={{ width: widths.type, minWidth: widths.type, maxWidth: widths.type, borderRight: '1px solid #e5e7eb', borderBottom: '1px solid #e5e7eb' }} className="px-4 py-2 text-gray-500 whitespace-nowrap italic overflow-hidden truncate">{it.itemType}</td>
                      );
                    }
                    if (col.key === 'publisher') {
                      return (
                        <td key={col.key} style={{ width: widths.publisher, minWidth: widths.publisher, maxWidth: widths.publisher, borderRight: '1px solid #e5e7eb', borderBottom: '1px solid #e5e7eb' }} className="px-4 py-2 text-gray-500 whitespace-nowrap truncate overflow-hidden">{it.publisher || 'N/A'}</td>
                      );
                    }
                    if (col.key === 'publication') {
                      return (
                        <td key={col.key} style={{ width: widths.publication, minWidth: widths.publication, maxWidth: widths.publication, borderRight: '1px solid #e5e7eb', borderBottom: '1px solid #e5e7eb' }} className="px-4 py-2 text-gray-500 whitespace-nowrap truncate overflow-hidden">{it.publicationTitle || 'N/A'}</td>
                      );
                    }
                    if (col.key === 'url') {
                      return (
                        <td key={col.key} style={{ width: widths.url, minWidth: widths.url, maxWidth: widths.url, borderRight: '1px solid #e5e7eb', borderBottom: '1px solid #e5e7eb' }} className="px-4 py-2 text-gray-500 whitespace-nowrap truncate overflow-hidden">
                          {it.url ? <a href={it.url} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline" onClick={(e) => e.stopPropagation()}>Link</a> : 'N/A'}
                        </td>
                      );
                    }
                    if (col.key === 'tags') {
                      return (
                        <td key={col.key} style={{ width: widths.tags, minWidth: widths.tags, maxWidth: widths.tags, borderRight: '1px solid #e5e7eb', borderBottom: '1px solid #e5e7eb' }} className="px-4 py-2 text-gray-500 whitespace-nowrap truncate overflow-hidden">
                          {it.tags && it.tags.length > 0 ? it.tags.join(', ') : 'N/A'}
                        </td>
                      );
                    }
                    return null;
                  })}
                </tr>
              ))}
            </tbody>
          </table>
          {columnMenu.visible && (
            <div style={{ position: 'fixed', top: columnMenu.y, left: columnMenu.x, zIndex: 1000, background: '#fff', border: '1px solid #e5e7eb', borderRadius: 4, boxShadow: '0 2px 8px rgba(0,0,0,0.08)' }}>
              <button className="block w-full text-left px-4 py-2 hover:bg-gray-100" onClick={() => moveColumn('left')}>Move left</button>
              <button className="block w-full text-left px-4 py-2 hover:bg-gray-100" onClick={() => moveColumn('right')}>Move right</button>
            </div>
          )}
        </div>
      )}
    </main>
  );
}
