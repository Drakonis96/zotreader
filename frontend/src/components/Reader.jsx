import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Document, Page, pdfjs } from 'react-pdf';
import 'react-pdf/dist/esm/Page/AnnotationLayer.css';
import 'react-pdf/dist/esm/Page/TextLayer.css';
import './Reader.css';
import * as fabric from 'fabric';
import ErrorBoundary from './ErrorBoundary';
import DocInfo from './DocInfo'; // Import DocInfo component for document info

const pastelColors = ['#FFB3BA', '#FFDFBA', '#FFFFBA', '#BAE1FF', '#BFFCC6']; // Pastel: Pink, Orange, Yellow, Blue, Green
const drawColors = ['#FF0000', '#FFA500', '#FFFF00', '#008000', '#0000FF', '#4B0082', '#EE82EE', '#000000', '#FFFFFF']; // Normal: Red, Orange, Yellow, Green, Blue, Indigo, Violet, Black, White

// Set up the worker for PDF.js
pdfjs.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs';

// Función auxiliar para guardar anotaciones en el servidor
const saveAnnotationsToServer = async (filename, data) => {
  try {
    const response = await fetch('/api/annotations/save', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        filename,
        data,
      }),
    });
    
    if (!response.ok) {
      throw new Error(`Error saving annotations: ${response.statusText}`);
    }
    return await response.json();
  } catch (error) {
    console.error('Error saving annotations:', error);
    return null;
  }
};

// Función auxiliar para cargar anotaciones desde el servidor
const loadAnnotationsFromServer = async (filename) => {
  try {
    const response = await fetch(`/api/annotations/${encodeURIComponent(filename)}`);
    
    if (!response.ok) {
      if (response.status === 404) {
        return {}; // No annotations for this file
      }
      throw new Error(`Error loading annotations: ${response.statusText}`);
    }
    return await response.json();
  } catch (error) {
    console.error('Error loading annotations:', error);
    return {};
  }
};

// Nuevo: función para aplicar zoom visual sin alterar el sistema de coordenadas interno
const applyViewportZoom = (canvas, z) => {
  canvas.setViewportTransform([z, 0, 0, z, 0, 0]);
  canvas.renderAll();
};

// Utilidad para detectar móvil (no tablet)
function isMobilePhone() {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent || navigator.vendor || window.opera;
  // Detecta iPhone, Android phones, pero NO tablets
  return (/android/i.test(ua) && !/tablet|ipad/i.test(ua)) || /iPhone|iPod/.test(ua);
}

// Nuevo componente PageCanvasWrapper
const PageCanvasWrapper = React.memo(({
  pageNumber,
  scale,
  initialPageAnnotations,
  onAnnotationsUpdate,
  globalAnnotationMode,
  globalBrushColor,
  globalBrushThickness,
  globalTextSelectionMode,
  docNameForSaving,
  pdfDocument, // Pass the loaded PDF document object
}) => {
  const canvasElRef = useRef(null);
  const fabricInstanceRef = useRef(null);
  const pageRef = useRef(null); // Ref for the react-pdf Page component
  const [pdfPageProxy, setPdfPageProxy] = useState(null);
  // Add a local ref to track if annotations are loaded
  const annotationsLoadedRef = useRef(false);

  const adjustCanvasDimensions = useCallback(() => {
    if (!fabricInstanceRef.current || !canvasElRef.current || !pageRef.current) return;

    const pageElement = pageRef.current.querySelector('.react-pdf__Page__canvas');
    const overlayEl = canvasElRef.current;

    if (pageElement) {
      const displayWidth = pageElement.offsetWidth;
      const displayHeight = pageElement.offsetHeight;

      // Usar las dimensiones del canvas de PDF renderizado
      overlayEl.width = pageElement.width;
      overlayEl.height = pageElement.height;
      overlayEl.style.width = `${displayWidth}px`;
      overlayEl.style.height = `${displayHeight}px`;

      fabricInstanceRef.current.setWidth(pageElement.width);
      fabricInstanceRef.current.setHeight(pageElement.height);
      fabricInstanceRef.current.setDimensions({
        width: `${displayWidth}px`,
        height: `${displayHeight}px`
      }, { cssOnly: true });
      
      fabricInstanceRef.current.calcOffset();
      fabricInstanceRef.current.renderAll();
    }
  }, []);

  // Effect to initialize the canvas with annotations
  useEffect(() => {
    if (canvasElRef.current && !fabricInstanceRef.current && pdfPageProxy) {
      const fabCanvas = new fabric.Canvas(canvasElRef.current, {
        selection: false, // Default to no selection, mode will enable
      });
      fabricInstanceRef.current = fabCanvas;
      fabCanvas.freeDrawingBrush = new fabric.PencilBrush(fabCanvas);

      if (initialPageAnnotations) {
        const zSaved = initialPageAnnotations.__viewport || 1;
        fabCanvas.loadFromJSON(initialPageAnnotations, () => {
          applyViewportZoom(fabCanvas, scale); // zoom actual de la vista
          adjustCanvasDimensions(); // Adjust after loading
          annotationsLoadedRef.current = true;
          console.log(`Loaded annotations for page ${pageNumber}`);
        });
      } else {
        adjustCanvasDimensions(); // Adjust even if no annotations
      }
      
      applyViewportZoom(fabCanvas, scale);

      // Modificado: guardar quitando temporalmente el zoom
      const savePageAnnotations = () => {
        if (!fabricInstanceRef.current) return;
        const c = fabricInstanceRef.current;
        const vt = c.viewportTransform; // [sx,0,0,sy,0,0]
        c.setViewportTransform([1,0,0,1,0,0]); // quita el zoom
        const json = c.toJSON();
        json.__viewport = vt[0]; // guardo el zoom con el que se dibujó
        c.setViewportTransform(vt); // restaurar
        onAnnotationsUpdate(pageNumber, json);
      };
      fabCanvas.on('object:added', savePageAnnotations);
      fabCanvas.on('object:modified', savePageAnnotations);
      fabCanvas.on('object:removed', savePageAnnotations);
      fabCanvas.on('text:editing:exited', savePageAnnotations);
      fabCanvas.on('mouse:up', (opt) => {
        if (fabCanvas.isDrawingMode) savePageAnnotations();
      });
    }
    
    return () => {
      if (fabricInstanceRef.current) {
        // Save state on cleanup if necessary
        if (fabricInstanceRef.current && annotationsLoadedRef.current) {
          const c = fabricInstanceRef.current;
          const vt = c.viewportTransform;
          c.setViewportTransform([1,0,0,1,0,0]);
          const json = c.toJSON();
          json.__viewport = vt[0];
          c.setViewportTransform(vt);
          onAnnotationsUpdate(pageNumber, json);
        }
        
        // Clean up canvas
        fabricInstanceRef.current.dispose();
        fabricInstanceRef.current = null;
        annotationsLoadedRef.current = false;
      }
    };
  }, [initialPageAnnotations, onAnnotationsUpdate, pageNumber, docNameForSaving, pdfPageProxy, scale, adjustCanvasDimensions]);

  useEffect(() => {
    if (fabricInstanceRef.current) {
      applyViewportZoom(fabricInstanceRef.current, scale);
      adjustCanvasDimensions(); // Re-adjust dimensions on scale change after PDF page re-renders
    }
  }, [scale, adjustCanvasDimensions]);
  
  useEffect(() => {
    const currentCanvas = fabricInstanceRef.current;
    if (!currentCanvas || !canvasElRef.current) return;

    const pageContainer = canvasElRef.current.closest('.continuous-canvas-page-wrapper');
    const textLayer = pageContainer?.querySelector('.react-pdf__Page__textContent');

    currentCanvas.isDrawingMode = false;
    currentCanvas.selection = false;
    currentCanvas.defaultCursor = 'default';
    currentCanvas.hoverCursor = 'default';
    currentCanvas.off('mouse:down');
    currentCanvas.forEachObject(obj => {
      obj.selectable = false;
      obj.evented = false;
    });

    // Default: canvas is interactive, text layer is not
    if (canvasElRef.current) {
      canvasElRef.current.style.pointerEvents = 'auto';
      canvasElRef.current.style.zIndex = '2';
    }
    if (textLayer) {
      textLayer.style.pointerEvents = 'none';
      textLayer.style.zIndex = '1';
    }

    if (globalTextSelectionMode) {
      if (canvasElRef.current) {
        canvasElRef.current.style.pointerEvents = 'none'; // Canvas no interactivo
      }
      if (textLayer) {
        textLayer.style.pointerEvents = 'auto'; // Text layer interactivo
        textLayer.style.zIndex = '3'; // Text layer encima de todo para selección
      }
      currentCanvas.renderAll();
      return;
    }

    // For all other annotation modes, ensure canvas is interactive
    // and text layer is not (already set as default above, but good to be explicit)

    if (globalAnnotationMode === 'draw' || globalAnnotationMode === 'highlight') {
      currentCanvas.isDrawingMode = true;
      let colorToUse = globalBrushColor;
      if (globalAnnotationMode === 'highlight') {
        if (pastelColors.includes(globalBrushColor)) {
          const r = parseInt(globalBrushColor.slice(1, 3), 16);
          const g = parseInt(globalBrushColor.slice(3, 5), 16);
          const b = parseInt(globalBrushColor.slice(5, 7), 16);
          colorToUse = `rgba(${r},${g},${b},0.3)`;
        } else if (!globalBrushColor.startsWith('rgba')) {
          colorToUse = 'rgba(255,255,0,0.3)'; // Default highlight
        }
      }
      currentCanvas.freeDrawingBrush.color = colorToUse;
      currentCanvas.freeDrawingBrush.width = globalBrushThickness;

      // Force brush to be immediately visible by simulating a small movement
      setTimeout(() => {
        currentCanvas.renderAll();
      }, 10);
    } else if (globalAnnotationMode === 'text') {
      currentCanvas.defaultCursor = 'text';
      currentCanvas.on('mouse:down', opt => {
        if (opt.target || currentCanvas.isDrawingMode) return;
        const pt = currentCanvas.getPointer(opt.e);
        const txt = new fabric.IText('Text', {
          left: pt.x, top: pt.y,
          fontSize: 16 / currentCanvas.getZoom(),
          fill: 'black',
          selectable: true, editable: true, evented: true,
        });
        currentCanvas.add(txt);
        currentCanvas.setActiveObject(txt);
        txt.enterEditing();
        txt.selectAll();
      });
      
      // Force canvas to be immediately visible in text mode
      setTimeout(() => {
        currentCanvas.renderAll();
      }, 10);
    } else if (globalAnnotationMode === 'delete') {
      currentCanvas.defaultCursor = 'pointer';
      currentCanvas.hoverCursor = 'pointer';
      currentCanvas.forEachObject(obj => { obj.evented = true; });
      
      // Clear previous mouse:down handlers
      currentCanvas.off('mouse:down');
      
      currentCanvas.on('mouse:down', opt => {
        if (opt.target) {
          // Keep a reference to the object being removed
          const targetToRemove = opt.target;
          
          // Remove the object
          currentCanvas.remove(targetToRemove);
          
          // Explicitly render the canvas after removal
          currentCanvas.renderAll();
          
          // Prevent event propagation to stop canvas from losing focus
          if (opt.e) {
            opt.e.stopPropagation();
          }
        }
      });
    } else { // 'none'
      currentCanvas.selection = true;
      currentCanvas.defaultCursor = 'default';
      currentCanvas.hoverCursor = 'move';
      currentCanvas.forEachObject(obj => {
        obj.selectable = true;
        obj.evented = true;
      });
      
      // Force canvas to be immediately visible in selection mode
      setTimeout(() => {
        currentCanvas.renderAll();
      }, 10);
    }
    currentCanvas.renderAll(); // << AÑADIDO AL FINAL DEL BLOQUE PRINCIPAL
  }, [globalAnnotationMode, globalBrushColor, globalBrushThickness, globalTextSelectionMode, scale, fabricInstanceRef, canvasElRef]);


  const onPageRenderSuccess = useCallback((page) => {
    setPdfPageProxy(page); // Store page proxy for scale changes
    // Delay slightly to ensure DOM is updated by react-pdf
    setTimeout(adjustCanvasDimensions, 50);
  }, [adjustCanvasDimensions]);

  if (!pdfDocument) return <div>Loading page {pageNumber}...</div>;

  return (
    <div ref={pageRef} className="continuous-canvas-page-wrapper" style={{ position: 'relative', margin: '8px auto' }}>
      <Page
        pdfDocument={pdfDocument} // Pass the document object
        pageNumber={pageNumber}
        scale={scale}
        renderTextLayer={true}
        renderAnnotationLayer={false} // We use our own canvas
        onRenderSuccess={onPageRenderSuccess}
      />
      <canvas ref={canvasElRef} className="annotation-canvas-continuous" style={{ position: 'absolute', top: 0, left: 0, zIndex: 2 }} />
    </div>
  );
});

const Reader = ({ pdfUrl, attachment, fileUrl, filename, onClose, doc, lib, onPageChange, onDocumentLoad, currentPage }) => {
  const activeSinglePageRef = useRef(1); // nueva referencia
  // ... (extractNameFromUrl and docName setup as before)
  const extractNameFromUrl = url => decodeURIComponent(url.split('/').pop());
  const docName = filename
    || attachment?.filename
    || attachment?.title
    || (fileUrl ? extractNameFromUrl(fileUrl) : null)
    || (pdfUrl ? extractNameFromUrl(pdfUrl) : null)
    || 'document';
  const [brushColor, setBrushColor] = useState('#000000'); // default draw color
  const [brushThickness, setBrushThickness] = useState(10); // default brush thickness
  const [numPages, setNumPages] = useState(null);
  const [pageNumber, setPageNumber] = useState(1);
  const [scale, setScale] = useState(1);
  const [viewMode, setViewMode] = useState('canvas'); // 'original' or 'canvas'
  const [annotationMode, setAnnotationMode] = useState('none'); // 'none' = seleccionar/mover
  const [documentLoaded, setDocumentLoaded] = useState(false);
  const [pdfSource, setPdfSource] = useState(null);
  const [textSelectionMode, setTextSelectionMode] = useState(false); // Changed to false as default
  const [showDocInfo, setShowDocInfo] = useState(false); // Document info hidden by default
  const [focusMode, setFocusMode] = useState(false);
  const [annData, setAnnData] = useState({ pages: {} });
  const [showDropdown, setShowDropdown] = useState(false);
  const canvasRef = useRef(null); // For single page canvas mode
  const fabricRef = useRef(null); // For single page canvas mode
  const pageContainerRef = useRef(null);
  const annDataRef = useRef({ pages: {} });
  // Ref to track previous page number for saving
  const prevPageRef = useRef(pageNumber);
  const fileInputRef = useRef(null);
  const dropdownButtonRef = useRef(null);
  const [dropdownPos, setDropdownPos] = useState({ top: 0, left: 0 });
  const clipboardRef = useRef([]); // Buffer for copied canvas objects
  const repeatTimerRef = useRef(null); // Estado para temporizador de repetición
  const pageToScrollAfterSwitchRef = useRef(null); // Ref to store page number for scrolling
  
  const [canvasContinuousMode, setCanvasContinuousMode] = useState(true); // default true, pero se forzará en móvil
  const [loadedPdfDocument, setLoadedPdfDocument] = useState(null); // Store the loaded PDF document object
  
  // Add a render trigger to refresh annotations when pages change
  const [annotationsRefreshKey, setAnnotationsRefreshKey] = useState(0);

  const saveCurrentSinglePage = useCallback(async () => {
    if (fabricRef.current && docName && !canvasContinuousMode) {
      try {
        const c = fabricRef.current;
        const vt = c.viewportTransform;
        c.setViewportTransform([1,0,0,1,0,0]);
        const json = c.toJSON();
        json.__viewport = vt[0];
        c.setViewportTransform(vt);
        const existingData = annDataRef.current;
        const pageKey = activeSinglePageRef.current; // ✅ página real
        const annotationsToSave = {
          pages: {
            ...(existingData.pages || {}),
            [pageKey]: json
          }
        };
        await saveAnnotationsToServer(docName, annotationsToSave);
        annDataRef.current = annotationsToSave;
      } catch (error) {
        console.error('Error saving annotations (single-page):', error);
      }
    }
  }, [docName, canvasContinuousMode, activeSinglePageRef]);

  // Forzar modo página única en móvil
  useEffect(() => {
    if (isMobilePhone() && canvasContinuousMode) {
      setCanvasContinuousMode(false);
    }
  }, [canvasContinuousMode]);

  // ... (useEffect for dropdownPos as before)
  useEffect(() => {
    if (showDropdown && dropdownButtonRef.current) {
      const rect = dropdownButtonRef.current.getBoundingClientRect();
      setDropdownPos({
        top: rect.bottom + 4, // 4px de separación
        left: rect.left
      });
    }
  }, [showDropdown]);

  // ... (useEffect for pdfSource as before)
  useEffect(() => {
    // Determine source: prioritize fileUrl, then pdfUrl, then attachment
    if (fileUrl) {
      setPdfSource(fileUrl);
    } else if (pdfUrl) {
      setPdfSource(pdfUrl);
    } else if (attachment) {
      const name = attachment.filename || attachment.title;
      if (name) {
        setPdfSource(`/api/pdf/${encodeURIComponent(name)}`);
      } else {
        console.error('Attachment is missing a filename or title property');
        setPdfSource(null);
      }
    } else {
      setPdfSource(null);
    }
  }, [fileUrl, pdfUrl, attachment]);

  // ... (useEffect for initial annotation loading as before)
  useEffect(() => {
    (async () => {
      try {
        const data = await loadAnnotationsFromServer(docName);
        const initial = { pages: data.pages || {} };
        setAnnData(initial);
        annDataRef.current = initial;
      if (!canvasContinuousMode && fabricRef.current) {
  loadPageAnnotations(pageNumber);
}

      } catch (e) {
        console.error('Error loading initial annotations:', e);
        const empty = { pages: {} };
        setAnnData(empty);
        annDataRef.current = empty;
      }
    })();
  }, [docName]);

  // Forzar recarga de anotaciones al cambiar entre modos canvas
  useEffect(() => {
    if (viewMode === 'canvas') {
      (async () => {
        try {
          const data = await loadAnnotationsFromServer(docName);
          const initial = { pages: data.pages || {} };
          setAnnData(initial);
          annDataRef.current = initial;
        } catch (e) {
          console.error('Error reloading annotations when switching modes:', e);
          const empty = { pages: {} };
          setAnnData(empty);
          annDataRef.current = empty;
        }
      })();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewMode, canvasContinuousMode, docName]);

  const toggleDocInfo = () => {
    setShowDocInfo(!showDocInfo);
  };

  function onDocumentLoadSuccess(pdf) { // pdf is the PDFDocumentProxy
    setNumPages(pdf.numPages);
    setLoadedPdfDocument(pdf); // Store the PDF document proxy
    setDocumentLoaded(true);
    if (typeof onDocumentLoad === 'function') onDocumentLoad(pdf.numPages);
  }

  // Sync external page changes (sidebar) with annotation handling
  useEffect(() => {
    if (typeof currentPage === 'number' && currentPage !== pageNumber) {
      if (viewMode === 'canvas' && !canvasContinuousMode && fabricRef.current) { // Only for single page canvas
        saveCurrentSinglePage();
        setPageNumber(currentPage);
      } else if (viewMode === 'canvas' && canvasContinuousMode) { // For continuous canvas mode
        // Set the page number
        setPageNumber(currentPage);
        // Use the same mechanism as toggleCanvasContinuousMode to scroll to the right page
        pageToScrollAfterSwitchRef.current = currentPage;
        
        // Save current annotations before loading new state
        (async () => {
          try {
            await saveAnnotationsToServer(docName, annDataRef.current);
            console.log('Saved current annotations before page switch in continuous mode');
            // Reload annotations from server to ensure we have the most current data
            const data = await loadAnnotationsFromServer(docName);
            const updatedAnnotations = { pages: data.pages || {} };
            setAnnData(updatedAnnotations);
            annDataRef.current = updatedAnnotations;
            
            // Trigger refresh of PageCanvasWrapper components
            setAnnotationsRefreshKey(prevKey => prevKey + 1);
            console.log('Refreshed annotations for page change in continuous mode');
            // Scroll to the specified page
            setTimeout(() => {
              const el = document.getElementById(`continuous-page-${currentPage}`);
              if (el) el.scrollIntoView({ behavior: 'auto', block: 'start' });
            }, 100);
          } catch (e) {
            console.error('Error saving or refreshing annotations during page change:', e);
          }
        })();
      } else {
        setPageNumber(currentPage);
      }
    }
  }, [currentPage, viewMode, canvasContinuousMode, docName, pageNumber, saveCurrentSinglePage]);

  useEffect(() => {
    if (typeof onPageChange === 'function') {
      onPageChange(pageNumber);
    }
  }, [pageNumber, onPageChange]);

  function changePage(offset) {
    if (viewMode === 'canvas' && !canvasContinuousMode && fabricRef.current) { // Only for single page canvas
      saveCurrentSinglePage();
      const next = Math.min(Math.max(pageNumber + offset, 1), numPages);
      loadPageAnnotations(next); // For single page canvas
      setPageNumber(next);
      if (typeof onPageChange === 'function') onPageChange(next);
    } else if (viewMode !== 'canvas' || (viewMode === 'canvas' && canvasContinuousMode)) { // Original mode or continuous canvas
        // In continuous modes, page change is via scroll, this function is for button clicks
        const next = Math.min(Math.max(pageNumber + offset, 1), numPages);
        setPageNumber(next); // Still update for potential focus or indicator
        if (typeof onPageChange === 'function') onPageChange(next);
        setAnnotationsRefreshKey(prevKey => prevKey + 1); // Trigger refresh
    } else {
      const next = Math.min(Math.max(pageNumber + offset, 1), numPages);
      setPageNumber(next);
      if (typeof onPageChange === 'function') onPageChange(next);
    }
  }

  // Al cambiar de página, recargar anotaciones de esa página (SOLO MODO SINGLE CANVAS)
  useEffect(() => {
    if (viewMode === 'canvas' && !canvasContinuousMode && documentLoaded && fabricRef.current) {
      loadPageAnnotations(pageNumber);
    }
  }, [pageNumber, viewMode, documentLoaded, canvasContinuousMode]); // Added canvasContinuousMode

  function previousPage() {
    changePage(-1);
  }

  function nextPage() {
    changePage(1);
  }

  function zoomIn() {
    setScale(prevScale => Math.min(prevScale + 0.1, 3));
  }

  function zoomOut() {
    setScale(prevScale => Math.max(prevScale - 0.1, 0.5));
  }
  
  const safeCleanupCanvas = useCallback(async () => {
    // First, attempt to save any pending changes for the current single page.
    // saveCurrentSinglePage has its own internal check for fabricRef.current.
    if (fabricRef.current) { // Check if there's a canvas to save from
        await saveCurrentSinglePage();
    }

    // After awaiting, fabricRef.current might have been changed by an effect if saveCurrentSinglePage
    // triggered re-renders. So, we operate on what is *now* in fabricRef.current.
    // This part is for cleaning up the Fabric instance.
    if (fabricRef.current) {
        const canvasInstanceToDispose = fabricRef.current; // Capture instance
        fabricRef.current = null; // Set to null *before* potentially slow/error-prone dispose

        try {
            // Ensure methods are called on a valid Fabric canvas object
            if (typeof canvasInstanceToDispose.off === 'function') {
                canvasInstanceToDispose.off(); // Remove event listeners
            }
            if (typeof canvasInstanceToDispose.dispose === 'function') {
                canvasInstanceToDispose.dispose(); // Dispose the captured instance
            }
        } catch (e) {
            console.warn("Error during fabric canvas cleanup (off/dispose):", e);
            // fabricRef.current is already null, so no further action needed on it here.
        }
    }
  }, [saveCurrentSinglePage]);

  const clearCanvas = () => {
    // This function now only applies to single-page canvas mode
    if (viewMode === 'canvas' && !canvasContinuousMode && fabricRef.current) {
      if (window.confirm('Are you sure you want to clear all annotations on this page?')) {
        fabricRef.current.clear();
        const filenameKey = docName;
        if (filenameKey) {
          saveAnnotationsToServer(filenameKey, {
            pages: {
              ...(annDataRef.current.pages || {}), // Preserve other pages
              [activeSinglePageRef.current]: { objects: [] } // ✅ página real
            }
          }).then(response => {
            if (response) {
              annDataRef.current.pages[activeSinglePageRef.current] = { objects: [] }; // ✅ página real
              console.log('Clean canvas saved to server (single-page)');
            }
          });
        }
      }
    } else if (canvasContinuousMode) {
        alert("Clear page is not implemented for continuous canvas mode. Please delete annotations individually.");
    }
  };

  const setAnnotationModeWithCleanup = (mode) => {
    if (textSelectionMode) {
      setTextSelectionMode(false);
      // For single page mode, enableCanvasInteraction is called by toggleTextSelection
      // For continuous mode, PageCanvasWrapper handles its own interaction state via globalTextSelectionMode
    }
    
    // Set the annotation mode
    setAnnotationMode(mode);
    
    // Force a refresh on all canvas instances after changing the mode
    if (canvasContinuousMode) {
      // In continuous mode, we rely on the PageCanvasWrapper components to refresh
      // They will react to the globalAnnotationMode change
    } else if (fabricRef.current) {
      // In single page mode, manually refresh the canvas
      setTimeout(() => {
        if (fabricRef.current) {
          fabricRef.current.renderAll();
        }
      }, 10);
    }
  };

  // Funciones para habilitar/deshabilitar interacción con canvas (SOLO MODO SINGLE CANVAS)
  const enableCanvasInteraction = useCallback(() => {
    if (canvasContinuousMode) return; // Not for continuous mode
    const canvasContainer = document.querySelector('.canvas-container'); // Specific to single page
    if (canvasContainer) {
      canvasContainer.style.pointerEvents = 'auto';
    }
    const textLayers = document.querySelectorAll('.pdf-container.single-mode .react-pdf__Page__textContent');
    textLayers.forEach(layer => {
      layer.style.pointerEvents = 'none';
      layer.style.zIndex = '1';
      layer.querySelectorAll('span').forEach(span => {
        span.style.color = 'transparent';
      });
    });
  }, [canvasContinuousMode]);

  const disableCanvasInteraction = useCallback(() => {
    if (canvasContinuousMode) return; // Not for continuous mode
    const canvasContainer = document.querySelector('.canvas-container'); // Specific to single page
    if (canvasContainer) {
      canvasContainer.style.pointerEvents = 'none';
    }
    const textLayers = document.querySelectorAll('.pdf-container.single-mode .react-pdf__Page__textContent');
    textLayers.forEach(layer => {
      layer.style.pointerEvents = 'auto';
      layer.style.zIndex = '3';
      layer.querySelectorAll('span').forEach(span => {
        span.style.color = 'transparent';
        span.style.cursor = 'text';
      });
    });
  }, [canvasContinuousMode]);

  const toggleTextSelection = () => {
    const newTextSelectionMode = !textSelectionMode;
    setTextSelectionMode(newTextSelectionMode);
    
    // For single page mode:
    if (!canvasContinuousMode) {
        if (newTextSelectionMode) {
          setAnnotationMode('none'); // Also turn off annotation tools
          disableCanvasInteraction();
        } else {
          enableCanvasInteraction();
        }
    }
    // For continuous mode, PageCanvasWrapper will react to globalTextSelectionMode
  };

  function toggleViewMode() {
    safeCleanupCanvas(); // Cleans up single-page canvas if active
    if (viewMode === 'canvas' && canvasContinuousMode) {
      setCanvasContinuousMode(false); // Reset continuous mode when switching from canvas
    }
    setTimeout(() => {
      const newMode = viewMode === 'original' ? 'canvas' : 'original';
      setViewMode(newMode);
      if (newMode === 'canvas') {
        setAnnotationMode('none'); // Default for canvas modes
        // setCanvasContinuousMode(false); // Ensure single page canvas is default
      }
    }, 10);
  }
  
  // Toggle between single page canvas and continuous canvas
  const toggleCanvasContinuousMode = async () => { // Make async
    if (viewMode === 'canvas') {
      await safeCleanupCanvas(); // Await cleanup and save of single page canvas if active

      if (!canvasContinuousMode) { // If switching TO continuous FROM single
        pageToScrollAfterSwitchRef.current = pageNumber; // Store current page for scrolling
        
        // Force a fresh reload of annotations when switching to continuous mode
        try {
          const data = await loadAnnotationsFromServer(docName);
          const updatedAnnotations = { pages: data.pages || {} };
          setAnnData(updatedAnnotations);
          annDataRef.current = updatedAnnotations;
          setAnnotationsRefreshKey(prevKey => prevKey + 1); // Force re-render of canvas wrappers
        } catch (e) {
          console.error('Error refreshing annotations when switching to continuous mode:', e);
        }
      } else { // If switching FROM continuous TO single
        // Ensure single page canvas re-initializes for current pageNumber
        // Force a reload of annotations for the current page
        try {
          const data = await loadAnnotationsFromServer(docName);
          const updatedAnnotations = { pages: data.pages || {} };
          setAnnData(updatedAnnotations);
          annDataRef.current = updatedAnnotations;
        } catch (e) {
          console.error('Error refreshing annotations when switching to single page mode:', e);
        }
      }
      setCanvasContinuousMode(prev => !prev);
    }
  };

  // useEffect to scroll to the correct page when switching to continuous view or when pageNumber changes
  useEffect(() => {
    if (viewMode === 'canvas' && canvasContinuousMode && loadedPdfDocument && pageToScrollAfterSwitchRef.current !== null) {
      const targetPage = pageToScrollAfterSwitchRef.current;
      // Delay slightly to ensure DOM is updated by react-pdf and our wrappers
      const timerId = setTimeout(() => {
        const pageElement = document.getElementById(`continuous-page-${targetPage}`);
        if (pageElement) {
          // Use block: 'start' for better positioning - puts the page at the top of the viewport
          pageElement.scrollIntoView({ behavior: 'auto', block: 'start' });
          console.log(`Scrolled to page ${targetPage} in continuous view`);
        } else {
          console.warn(`Could not find element with id continuous-page-${targetPage}`);
        }
        pageToScrollAfterSwitchRef.current = null; // Reset after attempting to scroll
      }, 150); // Adjusted delay
      return () => clearTimeout(timerId);
    }
  }, [viewMode, canvasContinuousMode, loadedPdfDocument, numPages, pageToScrollAfterSwitchRef.current]); // Added pageToScrollAfterSwitchRef.current as dependency

  // Add an effect to ensure annotations are refreshed when switching pages in continuous mode
  useEffect(() => {
    if (viewMode === 'canvas' && canvasContinuousMode && pageToScrollAfterSwitchRef.current) {
      // Refresh the annotations when switching pages in continuous mode
      (async () => {
        try {
          // Reload annotations from server
          const data = await loadAnnotationsFromServer(docName);
          const updatedAnnotations = { pages: data.pages || {} };
          setAnnData(updatedAnnotations);
          annDataRef.current = updatedAnnotations;
          console.log(`Refreshed annotations for page change to ${pageToScrollAfterSwitchRef.current}`);
        } catch (e) {
          console.error('Error refreshing annotations for page change:', e);
        }
      })();
    }
  }, [pageToScrollAfterSwitchRef.current, viewMode, canvasContinuousMode, docName]);

  // Auto-scroll to active page in continuous canvas mode when pageNumber changes
  useEffect(() => {
    if (viewMode === 'canvas' && canvasContinuousMode) {
      const el = document.getElementById(`continuous-page-${pageNumber}`);
      if (el) {
        el.scrollIntoView({ behavior: 'auto', block: 'start' });
        console.log(`Auto-scrolled to page ${pageNumber}`);
      }
    }
  }, [pageNumber, viewMode, canvasContinuousMode]);

  // --- Detectar página visible en modo canvas continuo y actualizar selección en Pages View ---
  useEffect(() => {
    if (!(viewMode === 'canvas' && canvasContinuousMode && documentLoaded && numPages > 0)) return;
    const container = pageContainerRef.current;
    if (!container) return;

    let ticking = false;
    let lastReportedPage = pageNumber;

    function getMostVisiblePage() {
      const containerRect = container.getBoundingClientRect();
      let maxVisible = 0;
      let bestPage = 1;
      for (let i = 1; i <= numPages; i++) {
        const el = document.getElementById(`continuous-page-${i}`);
        if (!el) continue;
        const rect = el.getBoundingClientRect();
        // Calculate visible height inside container
        const visible = Math.max(0, Math.min(rect.bottom, containerRect.bottom) - Math.max(rect.top, containerRect.top));
        if (visible > maxVisible) {
          maxVisible = visible;
          bestPage = i;
        }
      }
      return bestPage;
    }

    function onScroll() {
      if (!ticking) {
        window.requestAnimationFrame(() => {
          const mostVisible = getMostVisiblePage();
          if (mostVisible !== lastReportedPage) {
            lastReportedPage = mostVisible;
            setPageNumber(mostVisible);
            if (typeof onPageChange === 'function') onPageChange(mostVisible);
          }
          ticking = false;
        });
        ticking = true;
      }
    }

    container.addEventListener('scroll', onScroll, { passive: true });
    return () => container.removeEventListener('scroll', onScroll);
  }, [viewMode, canvasContinuousMode, documentLoaded, numPages, onPageChange]);

  const renderAllPages = () => {
    return Array.from(
      new Array(numPages),
      (el, index) => (
        <Page 
          key={`page_${index + 1}`} 
          pdfDocument={loadedPdfDocument}
          pageNumber={index + 1}
          scale={scale} 
          renderTextLayer={true}
          renderAnnotationLayer={true} // Original mode shows PDF annotations
        />
      )
    );
  };
  
  // For single page canvas mode
  const renderSinglePage = () => {
    return (
      <div className="page-wrapper">
        <Page
          pdfDocument={loadedPdfDocument}
          pageNumber={pageNumber}
          scale={scale}
          renderTextLayer={true}
          renderAnnotationLayer={false} // Our canvas handles annotations
          onRenderSuccess={setCanvasDimensions} // For single page canvas
        />
        <canvas ref={canvasRef} className="annotation-canvas" />
      </div>
    );
  };

  // For continuous canvas mode
  const handlePageAnnotationUpdate = useCallback(async (pageNum, pageJson) => {
    annDataRef.current = {
      pages: {
        ...(annDataRef.current.pages || {}),
        [pageNum]: pageJson,
      },
    };
    await saveAnnotationsToServer(docName, annDataRef.current);
  }, [docName]);

  const renderAllCanvasPages = () => {
    if (!loadedPdfDocument) return null;
    return Array.from(new Array(numPages), (el, index) => (
      <div id={`continuous-page-${index + 1}`} key={`canvas-page-container-${index + 1}`} className="continuous-page-render-wrapper">
        <PageCanvasWrapper
          key={`canvas-page-${index + 1}-${annotationsRefreshKey}`}
          pdfDocument={loadedPdfDocument}
          pageNumber={index + 1}
          scale={scale}
          initialPageAnnotations={annDataRef.current.pages?.[index + 1]}
          onAnnotationsUpdate={handlePageAnnotationUpdate}
          globalAnnotationMode={annotationMode}
          globalBrushColor={brushColor}
          globalBrushThickness={brushThickness}
          globalTextSelectionMode={textSelectionMode}
          docNameForSaving={docName}
        />
      </div>
    ));
  };


  useEffect(() => {
    if (annotationMode === 'draw') {
      setBrushColor(drawColors[7]);
    } else if (annotationMode === 'highlight') {
      setBrushColor('rgba(255,255,0,0.3)');
    }
  }, [annotationMode]);

  // Helper to set canvas dimensions (SOLO MODO SINGLE CANVAS)
  const setCanvasDimensions = useCallback(() => {
    if (canvasContinuousMode || !fabricRef.current || !canvasRef.current) return;
    const overlayEl = canvasRef.current;
    const pageWrapper = overlayEl.closest('.page-wrapper'); // Contenedor de la página individual
    const pageCanvas = pageWrapper?.querySelector('.react-pdf__Page__canvas');

    if (pageCanvas && overlayEl) {
      const displayWidth = pageCanvas.offsetWidth;
      const displayHeight = pageCanvas.offsetHeight;

      // Usar las dimensiones del canvas de PDF renderizado
      overlayEl.width = pageCanvas.width;
      overlayEl.height = pageCanvas.height;
      overlayEl.style.width = `${displayWidth}px`;
      overlayEl.style.height = `${displayHeight}px`;
      // Asegurar que el canvas de fabric se superponga correctamente
      overlayEl.style.position = 'absolute';
      overlayEl.style.top = '0'; // pageCanvas.offsetTop puede ser 0 si page-wrapper no tiene padding
      overlayEl.style.left = '0';// pageCanvas.offsetLeft puede ser 0
      overlayEl.style.zIndex = 2;

      fabricRef.current.setWidth(pageCanvas.width);
      fabricRef.current.setHeight(pageCanvas.height);
      fabricRef.current.setDimensions({
        width: `${displayWidth}px`,
        height: `${displayHeight}px`
      }, { cssOnly: true });
      
      applyViewportZoom(fabricRef.current, scale);

      fabricRef.current.calcOffset();
      fabricRef.current.renderAll();
    }
  }, [canvasContinuousMode, scale]);

  // Helper to load annotations for a given page into the canvas (SOLO MODO SINGLE CANVAS)
  const loadPageAnnotations = useCallback((pageNo) => {
    if (canvasContinuousMode) return;
    const targetCanvasInstance = fabricRef.current;
    if (!targetCanvasInstance) return;

    targetCanvasInstance.clear();
    const pageData = annDataRef.current.pages?.[pageNo] || { objects: [] };

    targetCanvasInstance.loadFromJSON(pageData, () => {
      if (fabricRef.current === targetCanvasInstance) {
        // --- Ajuste de zoom guardado ---
        const zSaved = pageData.__viewport || 1;
        applyViewportZoom(targetCanvasInstance, 1 / zSaved);
        setCanvasDimensions();
        applyViewportZoom(targetCanvasInstance, scale);

        targetCanvasInstance.forEachObject(obj => { obj.selectable = true; obj.evented = true; });
        targetCanvasInstance.renderAll();

        // --- Elimina listeners previos y registra nuevos para esta página ---
        targetCanvasInstance.off('object:added');
        targetCanvasInstance.off('object:modified');
        targetCanvasInstance.off('object:removed');
        targetCanvasInstance.off('text:editing:exited');
        targetCanvasInstance.off('mouse:up');

        const saveForThisPage = () => {
          const c = targetCanvasInstance;
          const vt = c.viewportTransform;
          c.setViewportTransform([1,0,0,1,0,0]);
          const json = c.toJSON();
          json.__viewport = vt[0];
          c.setViewportTransform(vt);
          annDataRef.current.pages[pageNo] = json;
          saveAnnotationsToServer(docName, annDataRef.current);
        };

        targetCanvasInstance.on('object:added', saveForThisPage);
        targetCanvasInstance.on('object:modified', saveForThisPage);
        targetCanvasInstance.on('object:removed', saveForThisPage);
        targetCanvasInstance.on('text:editing:exited', saveForThisPage);
        targetCanvasInstance.on('mouse:up', (opt) => {
          if (targetCanvasInstance.isDrawingMode) saveForThisPage();
        });
      }
    });
  }, [canvasContinuousMode, scale, setCanvasDimensions, annDataRef, docName]);

  // useEffect: Initialize Fabric.js canvas for SINGLE PAGE MODE
  useEffect(() => {
    const cleanupSingleCanvas = () => {
      if (fabricRef.current) {
        window.removeEventListener('resize', setCanvasDimensions);
        try {
          fabricRef.current.dispose();
        } catch (err) {
          console.warn('Error disposing single-page annotation canvas', err);
        }
        fabricRef.current = null;
      }
    };

    // Only run for single page canvas mode
    if (viewMode !== 'canvas' || canvasContinuousMode || !documentLoaded) {
      cleanupSingleCanvas();
      return;
    }

    if (!fabricRef.current && canvasRef.current) {
      const timer = setTimeout(async () => {
        const overlayEl = canvasRef.current;
        if (!overlayEl) return;

        try {
          overlayEl.style.opacity = '1';
          overlayEl.style.pointerEvents = 'auto';

          fabricRef.current = new fabric.Canvas(overlayEl, {
            width: 100, height: 100, selection: true,
          });
          fabricRef.current.freeDrawingBrush = new fabric.PencilBrush(fabricRef.current);
          loadPageAnnotations(pageNumber);

          // --- usa el ref para la página activa ---
          const save = async () => {
            if (fabricRef.current && docName && !canvasContinuousMode) {
              try {
                const pageKey = activeSinglePageRef.current; // ✅ página correcta
                const existingData = annDataRef.current;
                const json = fabricRef.current.toJSON();
                json.__viewport = fabricRef.current.viewportTransform[0];
                const annotationsToSave = {
                  pages: {
                    ...(existingData.pages || {}),
                    [pageKey]: json
                  }
                };
                await saveAnnotationsToServer(docName, annotationsToSave);
                annDataRef.current = annotationsToSave;
              } catch (error) {
                console.error('Error saving annotations (single-page):', error);
              }
            }
          };

          fabricRef.current.on('object:added', save);
          fabricRef.current.on('object:modified', save);
          fabricRef.current.on('object:removed', save);
          fabricRef.current.on('text:editing:exited', save);
          fabricRef.current.on('mouse:up', (opt) => {
            if (fabricRef.current?.isDrawingMode) save();
          });

          window.addEventListener('resize', setCanvasDimensions);
          setTimeout(() => {
            if (fabricRef.current) {
              setCanvasDimensions();
              fabricRef.current.renderAll();
            }
          }, 300);

        } catch (e) {
          console.error('Error initializing single-page canvas', e);
          fabricRef.current = null;
        }
      }, 100);
      return () => clearTimeout(timer);
    }
    return cleanupSingleCanvas;
  }, [viewMode, documentLoaded, canvasContinuousMode, docName, loadPageAnnotations, setCanvasDimensions, pageNumber]);

  // --- actualiza el ref cada vez que cambias de página en modo página-única ---
  useEffect(() => {
    if (!canvasContinuousMode) {
      activeSinglePageRef.current = pageNumber;
    }
  }, [pageNumber, canvasContinuousMode]);

  // useEffect: Configure Fabric.js canvas based on annotationMode and brushColor (SINGLE PAGE MODE)
  useEffect(() => {
    const currentCanvas = fabricRef.current;
    // This effect is only for single-page canvas mode
    if (!currentCanvas || canvasContinuousMode) {
      // If in continuous mode, or no canvas, do nothing here.
      // PageCanvasWrapper handles its own modes.
      // However, if textSelectionMode changed, single-page canvas interaction might need update
      if (!canvasContinuousMode && textSelectionMode) {
          disableCanvasInteraction();
      } else if (!canvasContinuousMode && !textSelectionMode) {
          enableCanvasInteraction();
      }
      return;
    }
    
    // Default: canvas is interactive, text layer is not
    enableCanvasInteraction(); // Ensures canvas is interactive by default unless text selection is on

    if (textSelectionMode) {
      disableCanvasInteraction(); 
      currentCanvas.isDrawingMode = false; // Ensure drawing mode is off
      currentCanvas.selection = false; // Ensure selection is off
      currentCanvas.defaultCursor = 'default';
      currentCanvas.hoverCursor = 'default';
      currentCanvas.forEachObject(obj => {
        obj.selectable = false;
        obj.evented = false;
      });
      currentCanvas.renderAll(); 
      return; 
    }

    currentCanvas.isDrawingMode = false;
    currentCanvas.selection = false;
    currentCanvas.defaultCursor = 'default';
    currentCanvas.hoverCursor = 'default';
    currentCanvas.off('mouse:down');
    currentCanvas.forEachObject(obj => {
      obj.selectable = false;
      obj.evented = false;
    });

    const overlayEl = canvasRef.current; // single page canvas
    const canvasWrapper = overlayEl?.parentElement?.querySelector('.canvas-container'); // single page specific
    if (canvasWrapper) {
        canvasWrapper.className = 'canvas-container'; 
        canvasWrapper.style.pointerEvents = 'auto';
    }

    if (annotationMode === 'draw' || annotationMode === 'highlight') {
      currentCanvas.isDrawingMode = true;
      if (canvasWrapper) canvasWrapper.classList.add(annotationMode === 'draw' ? 'draw-mode' : 'highlight-mode');
      let colorToUse = brushColor;
      if (annotationMode === 'highlight') {
         if (pastelColors.includes(brushColor)) {
             const r = parseInt(brushColor.slice(1, 3), 16);
             const g = parseInt(brushColor.slice(3, 5), 16);
             const b = parseInt(brushColor.slice(5, 7), 16);
             colorToUse = `rgba(${r},${g},${b},0.3)`;
         } else if (!brushColor.startsWith('rgba')) {
             colorToUse = 'rgba(255,255,0,0.3)';
         }
      }
      currentCanvas.freeDrawingBrush.color = colorToUse;
      currentCanvas.freeDrawingBrush.width = brushThickness;

      // Force the brush to be immediately visible
      setTimeout(() => {
        if (currentCanvas) {
          currentCanvas.renderAll();
        }
      }, 10);
    } else if (annotationMode === 'text') {
       if (canvasWrapper) canvasWrapper.classList.add('text-mode');
       currentCanvas.defaultCursor = 'text';
       currentCanvas.forEachObject(obj => { obj.evented = false; });
       currentCanvas.on('mouse:down', opt => {
         if (opt.target || currentCanvas.isDrawingMode) return;
         const pt = currentCanvas.getPointer(opt.e);
         const currentZoom = currentCanvas.getZoom();
         const txt = new fabric.IText('Text', {
           left: pt.x, top: pt.y,
           fontSize: 16 / currentZoom,
           fill: 'black',
           selectable: true, editable: true, evented: true,
         });
         currentCanvas.add(txt);
         currentCanvas.setActiveObject(txt);
         txt.enterEditing();
         txt.selectAll();
       });
       
       // Force canvas to be immediately visible in text mode
       setTimeout(() => {
         if (currentCanvas) {
           currentCanvas.renderAll();
         }
       }, 10);
    } else if (annotationMode === 'delete') {
        if (canvasWrapper) canvasWrapper.classList.add('delete-mode');
        currentCanvas.defaultCursor = 'pointer';
        currentCanvas.hoverCursor = 'pointer';
        currentCanvas.forEachObject(obj => { obj.evented = true; });
        
        // Clear previous mouse:down handlers
        currentCanvas.off('mouse:down');
        
        currentCanvas.on('mouse:down', opt => {
          if (opt.target) {
            // Keep a reference to the object being removed
            const targetToRemove = opt.target;
            
            // Remove the object
            currentCanvas.remove(targetToRemove);
            
            // Explicitly render the canvas after removal
            currentCanvas.renderAll();
            
            // Prevent event propagation to stop canvas from losing focus
            if (opt.e) {
              opt.e.stopPropagation();
            }
          }
        });
    } else { // 'none' mode (Select/Move)
        if (canvasWrapper) canvasWrapper.classList.add('select-mode');
        currentCanvas.selection = true;
        currentCanvas.defaultCursor = 'default';
        currentCanvas.hoverCursor = 'move';
        currentCanvas.forEachObject(obj => {
            obj.selectable = true;
            obj.evented = true;
        });
        
        // Force canvas to be immediately visible in selection/move mode
        setTimeout(() => {
          if (currentCanvas) {
            currentCanvas.renderAll();
          }
        }, 10);
    }
    currentCanvas.renderAll(); // << AÑADIDO AL FINAL DEL BLOQUE PRINCIPAL
  }, [annotationMode, brushColor, textSelectionMode, brushThickness, canvasContinuousMode, enableCanvasInteraction, disableCanvasInteraction, fabricRef, scale]);


  // useEffect: Handle Zoom changes (SINGLE PAGE MODE)
  useEffect(() => {
    if (viewMode === 'canvas' && !canvasContinuousMode && documentLoaded && fabricRef.current) {
      applyViewportZoom(fabricRef.current, scale);
      setCanvasDimensions(); // This also calls renderAll
    }
    // For continuous canvas mode, PageCanvasWrapper handles its own zoom and dimensions
  }, [scale, viewMode, documentLoaded, canvasContinuousMode, setCanvasDimensions]);

  // Manejar tecla Delete/Backspace para eliminar objetos (SINGLE PAGE MODE)
  useEffect(() => {
    if (viewMode !== 'canvas' || canvasContinuousMode || textSelectionMode) return; // Only for single page, non-text-selection
    const handleKeyDown = (e) => {
      if (!fabricRef.current) return;
      if ((e.key === 'Delete' || e.key === 'Backspace') && document.activeElement?.tagName !== 'INPUT' && document.activeElement?.tagName !== 'TEXTAREA') {
        const activeObject = fabricRef.current.getActiveObject();
        if (activeObject) {
          fabricRef.current.remove(activeObject);
          fabricRef.current.discardActiveObject();
          fabricRef.current.requestRenderAll();
        }
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'c') {
        const activeObjects = fabricRef.current.getActiveObjects();
        clipboardRef.current = activeObjects.length ? activeObjects.map(obj => obj.toObject()) : [];
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'v') {
        const clipboardData = clipboardRef.current;
        if (clipboardData.length && fabricRef.current) {
          const pageKey = activeSinglePageRef.current; // ✅ página real
          const pageJson = annDataRef.current.pages[pageKey] || { objects: [] };
          const clones = clipboardData.map(objJson => ({
            ...objJson,
            left: (objJson.left || 0) + 10,
            top: (objJson.top || 10) + 10
          }));
          annDataRef.current.pages[pageKey] = {
            objects: [...pageJson.objects, ...clones]
          };
          fabricRef.current.clear();
          fabricRef.current.loadFromJSON(annDataRef.current.pages[pageKey], () => {
            fabricRef.current.requestRenderAll();
          });
          saveAnnotationsToServer(docName, annDataRef.current);
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [viewMode, textSelectionMode, canvasContinuousMode, docName, activeSinglePageRef, annDataRef]);

  // ... (focusMode useEffect as before)
  useEffect(() => {
    if (focusMode) {
      const overlay = document.createElement('div');
      overlay.id = 'focus-overlay';
      overlay.style.position = 'fixed';
      overlay.style.top = '0';
      overlay.style.left = '0';
      overlay.style.width = '100vw';
      overlay.style.height = '100vh';
      overlay.style.background = 'rgba(0,0,0,0.7)';
      overlay.style.zIndex = '9998';
      overlay.style.transition = 'opacity 0.4s';
      overlay.style.opacity = '1';
      overlay.onclick = () => setFocusMode(false);
      document.body.appendChild(overlay);
      const reader = document.querySelector('.reader-container');
      if (reader) {
        reader.style.position = 'relative';
        reader.style.zIndex = '9999';
      }
      return () => {
        if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
        if (reader) reader.style.zIndex = '';
      };
    }
  }, [focusMode]);

  // ... (handleFullscreen as before)
  const handleFullscreen = useCallback(() => {
    const elem = document.querySelector('.reader-container');
    if (elem) {
      if (document.fullscreenElement) {
        document.exitFullscreen();
      } else {
        elem.requestFullscreen();
      }
    }
  }, []);

  // Función para cerrar lector y guardar anotaciones actuales (SINGLE PAGE MODE)
  const handleClose = async () => {
    // If in single page canvas mode and fabricRef exists, save current page
    if (viewMode === 'canvas' && !canvasContinuousMode && fabricRef.current) {
      try {
        await saveCurrentSinglePage();
      } catch (e) {
        console.error('Error saving before closing (single-page):', e);
      }
    }
    // For continuous canvas mode, annotations are saved by PageCanvasWrapper instances.
    onClose();
  };

  // ... (handleDownloadAnnotations, handleDownloadOriginal, handleImportAnnotations, onFileInputChange as before)
  const handleDownloadAnnotations = async () => {
    try {
      // Ensure annDataRef.current has the latest from all pages if in continuous mode
      // Or rely on server having the latest. For simplicity, load from server.
      const data = await loadAnnotationsFromServer(docName);
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${docName}_annotations.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e) {
      console.error('Error downloading annotations:', e);
    }
  };

  const handleDownloadOriginal = async () => {
    try {
      const response = await fetch(pdfSource); // pdfSource should be correct
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = docName; // docName should be the original filename
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e) {
      console.error('Error downloading original PDF:', e);
    }
  };
  
  const handleImportAnnotations = () => fileInputRef.current?.click();
  const onFileInputChange = async (e) => {
    const file = e.target.files[0];
    if (file) {
      try {
        const text = await file.text();
        const data = JSON.parse(text);
        // Ensure data is in { pages: { ... } } format
        const formatted = (data.pages && typeof data.pages === 'object') ? data : { pages: data };

        await saveAnnotationsToServer(docName, formatted);
        annDataRef.current = formatted; // Update ref
        setAnnData(formatted); // Update state to trigger re-render if necessary

        // If in single page mode, reload current page's annotations
        if (viewMode === 'canvas' && !canvasContinuousMode && fabricRef.current) {
          loadPageAnnotations(pageNumber);
        }
        // If in continuous mode, PageCanvasWrappers will get new initialPageAnnotations on next full render,
        // or we might need to force a re-render of them. For now, setAnnData should help.
        console.log('Annotations imported and saved.');
      } catch (err) {
        console.error('Error importing annotations:', err);
        alert('Error importing annotation file. Ensure it is a valid JSON.');
      }
    }
  };


  // ... (startRepeat, stopRepeat as before)
  const startRepeat = (fn) => {
    fn();
    repeatTimerRef.current = setInterval(fn, 180);
  };

  const stopRepeat = () => {
    if (repeatTimerRef.current) {
      clearInterval(repeatTimerRef.current);
      repeatTimerRef.current = null;
    }
  };

  return (
    <div className="reader-container">
      {/* ... (hidden input, doc info panel as before) ... */}
      <input type="file" accept="application/json" ref={fileInputRef} style={{ display: 'none' }} onChange={onFileInputChange} />
      {showDocInfo && doc && (
        <div className="doc-info-panel">
          {/* ... DocInfo content ... */}
          <div className="doc-info-header">
            <h2>Document Information</h2>
            <button onClick={toggleDocInfo} className="toggle-doc-info">Hide Info</button>
          </div>
          <div className="doc-info-content">
            <h3>{doc.title || "Untitled Document"}</h3>
            {doc.creators && (
              <p className="doc-authors">
                By: {Array.isArray(doc.creators) 
                  ? doc.creators.map(c => `${c.firstName || ''} ${c.lastName || ''}`.trim()).join(', ')
                  : typeof doc.creators === 'string' 
                    ? doc.creators 
                    : 'Unknown'
                }
              </p>
            )}
            {doc.date && <p className="doc-date">Date: {doc.date}</p>}
            {doc.abstractNote && <p className="doc-abstract">{doc.abstractNote}</p>}
            {doc.tags && Array.isArray(doc.tags) && doc.tags.length > 0 && (
              <div className="doc-tags">
                Tags: {doc.tags.map((tag, index) => 
                  <span key={tag?.toString() || index} className="doc-tag">{tag}</span>
                )}
              </div>
            )}
            {doc.DOI && <p className="doc-doi">DOI: <a href={`https://doi.org/${doc.DOI}`} target="_blank" rel="noreferrer">{doc.DOI}</a></p>}
            {doc.url && <p className="doc-url">URL: <a href={doc.url} target="_blank" rel="noreferrer">{doc.url}</a></p>}
          </div>
        </div>
      )}
      <div className="reader-controls" onMouseDown={e => e.preventDefault()}>
        {/* ... (doc info toggle, download/import dropdown as before) ... */}
        {doc && (
          <button 
            onClick={toggleDocInfo} 
            className="zoom-button"
            title={showDocInfo ? "Hide document info" : "Show document info"}
          >
            <img src="/icons/document info.svg" alt="Document Info" className="inline-block w-5 h-5" />
          </button>
        )}
        <div className="dropdown-container" style={{ position: 'relative', display: 'inline-block' }}>
          <button 
            ref={dropdownButtonRef}
            onClick={() => setShowDropdown(!showDropdown)} 
            className="zoom-button"
            title="Download or import"
          >
            <img src="/icons/download.svg" alt="Download/Import" className="inline-block w-5 h-5" />
          </button>
          {showDropdown && (
            <div 
              className="dropdown-menu"
              style={{
                position: 'fixed',
                top: dropdownPos.top,
                left: dropdownPos.left,
                zIndex: 10001, // Ensure dropdown is above focus overlay
                display: 'flex',
                flexDirection: 'column',
                gap: '0.5em',
                background: '#fff',
                border: '1px solid #ddd',
                borderRadius: '6px',
                boxShadow: '0 2px 8px rgba(0,0,0,0.12)',
                padding: '4px 0',
                minWidth: '160px',
              }}
            >
              <button onClick={() => { setShowDropdown(false); handleDownloadOriginal(); }} className="zoom-button" style={{ width: 'auto', minWidth: '160px', textAlign: 'left', whiteSpace: 'nowrap' }}><img src="/icons/download.svg" alt="Download" className="inline-block w-4 h-4 mr-2" />Download original</button>
              <button onClick={() => { setShowDropdown(false); handleDownloadAnnotations(); }} className="zoom-button" style={{ width: 'auto', minWidth: '160px', textAlign: 'left', whiteSpace: 'nowrap' }}><img src="/icons/download.svg" alt="Download" className="inline-block w-4 h-4 mr-2" />Download notes</button>
              <button onClick={() => { setShowDropdown(false); handleImportAnnotations(); }} className="zoom-button" style={{ width: 'auto', minWidth: '160px', textAlign: 'left', whiteSpace: 'nowrap' }}><img src="/icons/import.svg" alt="Import" className="inline-block w-4 h-4 mr-2" />Import notes</button>
            </div>
          )}
        </div>
        {(viewMode === 'original' || viewMode === 'canvas') && (
          <>
            <button
              onClick={() => setFocusMode(f => !f)}
              className={`zoom-button${focusMode ? ' active-tool' : ''}`}
              title={focusMode ? 'Exit focus mode' : 'Focus mode (dim background)'}
            >
              <img src="/icons/focus.svg" alt="Focus Mode" className="inline-block w-5 h-5" />
            </button>
            <button
              onClick={handleFullscreen}
              className="zoom-button"
              title="Fullscreen"
            >
              <img src="/icons/full screen.svg" alt="Fullscreen" className="inline-block w-5 h-5" />
            </button>
          </>
        )}
        {/* Controles de anotación y modo canvas */}
        {viewMode === 'canvas' && (
          <>
            {/* Botón para cambiar entre canvas de página única y continuo */}
            <button
              onClick={toggleCanvasContinuousMode}
              className={`zoom-button ${canvasContinuousMode ? 'active-tool' : ''}`}
              title={canvasContinuousMode ? "Switch to single page view (Canvas)" : "Switch to continuous view (Canvas)"}
              disabled={isMobilePhone()}
            >
              {canvasContinuousMode ? <img src="/icons/view mode.svg" alt="Single Page View" className="inline-block w-5 h-5" /> : <img src="/icons/view mode.svg" alt="Continuous View" className="inline-block w-5 h-5" /> }
            </button>
            {/* Color picker y controles de grosor (comunes a ambos modos canvas) */}
            <div className="color-picker">
              {/* ... (color pickers as before, driven by annotationMode) ... */}
              {annotationMode === 'highlight' && pastelColors.map(color => (
                <button
                  key={color}
                  className={`color-button ${brushColor === color || (color === '#FFFFBA' && brushColor === 'rgba(255,255,0,0.3)') ? 'active-color' : ''}`}
                  style={{ backgroundColor: color }}
                  title={color}
                  onClick={() => setBrushColor(color)}
                />
              ))}
              {annotationMode === 'draw' && drawColors.map(color => (
                <button
                  key={color}
                  className={`color-button ${brushColor === color ? 'active-color' : ''}`}
                  style={{
                    backgroundColor: color,
                    border: color === '#FFFFFF' && brushColor !== color ? '1px solid #ccc' : null
                  }}
                  title={color}
                  onClick={() => setBrushColor(color)}
                />
              ))}
            </div>
            {(annotationMode === 'draw' || annotationMode === 'highlight') && (
              <div className="thickness-control">
                {/* ... (thickness controls as before) ... */}
                <button
                  onMouseDown={() => startRepeat(() => setBrushThickness(prev => Math.max(1, prev - 1)))}
                  onMouseUp={stopRepeat}
                  onMouseLeave={stopRepeat}
                  onTouchStart={() => startRepeat(() => setBrushThickness(prev => Math.max(1, prev - 1)))}
                  onTouchEnd={stopRepeat}
                  className="thickness-button"
                  title="Reduce thickness"
                >
                  -
                </button>
                <div className="thickness-value">
                  <input
                    type="number"
                    min="1"
                    max="20"
                    value={brushThickness}
                    onChange={(e) => {
                      const value = parseInt(e.target.value, 10);
                      if (!isNaN(value) && value >= 1 && value <= 20) {
                        setBrushThickness(value);
                      }
                    }}
                    title="Stroke thickness"
                    inputMode="numeric"
                    style={{ MozAppearance: 'textfield', appearance: 'textfield' }}
                    className="no-spinner"
                  />
                </div>
                <button
                  onMouseDown={() => startRepeat(() => setBrushThickness(prev => Math.min(20, prev + 1)))}
                  onMouseUp={stopRepeat}
                  onMouseLeave={stopRepeat}
                  onTouchStart={() => startRepeat(() => setBrushThickness(prev => Math.min(20, prev + 1)))}
                  onTouchEnd={stopRepeat}
                  className="thickness-button"
                  title="Increase thickness"
                >
                  +
                </button>
              </div>
            )}
            {/* Botones de herramientas de anotación */}
            <button 
              onClick={() => setAnnotationModeWithCleanup('none')} 
              className={`zoom-button ${annotationMode === 'none' && !textSelectionMode ? 'active-tool' : ''}`} 
              title="Select/Move"
            >
              <img src="/icons/move.svg" alt="Select/Move" className="inline-block w-5 h-5" />
            </button>
            {/* ... (otros botones de anotación: draw, text, highlight, delete) ... */}
            <button 
              onClick={() => setAnnotationModeWithCleanup('draw')} 
              className={`zoom-button ${annotationMode === 'draw' ? 'active-tool' : ''}`} 
              title="Draw"
            >
              <img src="/icons/draw.svg" alt="Draw" className="inline-block w-5 h-5" />
            </button>
            <button 
              onClick={() => setAnnotationModeWithCleanup('text')} 
              className={`zoom-button ${annotationMode === 'text' ? 'active-tool' : ''}`} 
              title="Text"
            >
              <img src="/icons/note.svg" alt="Text" className="inline-block w-5 h-5" />
            </button>
            <button 
              onClick={() => setAnnotationModeWithCleanup('highlight')} 
              className={`zoom-button ${annotationMode === 'highlight' ? 'active-tool' : ''}`} 
              title="Highlight"
            >
              <img src="/icons/highlighter.svg" alt="Highlight" className="inline-block w-5 h-5" />
            </button>
            <button 
              onClick={() => setAnnotationModeWithCleanup('delete')} 
              className={`zoom-button ${annotationMode === 'delete' ? 'active-tool' : ''}`} 
              title="Delete Annotation"
            >
              <img src="/icons/bin.svg" alt="Delete Annotation" className="inline-block w-5 h-5" />
            </button>
            {/* Botón Limpiar Página (solo para modo canvas de página única) */}
            {!canvasContinuousMode && (
              <button 
                onClick={clearCanvas} 
                className="zoom-button" 
                title="Clear Page"
              >
                <img src="/icons/eraser.svg" alt="Clear Page" className="inline-block w-5 h-5" />
              </button>
            )}
            <button 
              onClick={toggleTextSelection} 
              className={`zoom-button ${textSelectionMode ? 'active-tool' : ''}`} 
              title="Select Text"
            >
              <img src="/icons/text selection.svg" alt="Select Text" className="inline-block w-5 h-5" />
            </button>
          </>
        )}
        {/* ... (zoom controls, view mode toggle, close button as before) ... */}
        <button onClick={zoomOut} className="zoom-button">-</button>
        <span className="zoom-level">{Math.round(scale * 100)}%</span>
        <button onClick={zoomIn} className="zoom-button">+</button>
        <button
          onClick={toggleViewMode}
          className="view-mode-button"
        >
          {viewMode === 'original' ? 'Canvas' : 'Original'}
        </button>
        <button onClick={handleClose} className="zoom-button close-button" title="Close reader"><img src="/icons/close pdf.svg" alt="Close Reader" className="inline-block w-5 h-5" /></button>
        {attachment && (
          <span className="pdf-title">
            {attachment.filename || attachment.title || 'PDF Document'}
          </span>
        )}
      </div>

      <div 
        ref={pageContainerRef} 
        className={`pdf-container ${
            viewMode === 'original' ? 'continuous-mode' : 
            (viewMode === 'canvas' && canvasContinuousMode) ? 'continuous-mode canvas-continuous-active' : 
            'single-mode' // Default to single-mode for canvas if not continuous
          } ${textSelectionMode ? 'text-selection-mode' : ''} ${showDocInfo ? 'with-doc-info' : ''}`
        }
      >  
        <ErrorBoundary onClose={onClose}>
          {pdfSource ? (
            <Document
              file={pdfSource}
              onLoadSuccess={onDocumentLoadSuccess}
              loading={<div className="loading-pdf">Loading PDF...</div>}
              error={
                <div className="pdf-error">
                  <button className="error-close-button" type="button" onClick={onClose}><img src="/icons/close pdf.svg" alt="Close Error" className="inline-block w-5 h-5" /></button>
                  <div>Error loading PDF! Make sure the file exists in the downloaded_pdfs folder.</div>
                </div>
              }
            >
              {documentLoaded && viewMode === 'original' && renderAllPages()}
              {documentLoaded && viewMode === 'canvas' && !canvasContinuousMode && renderSinglePage()}
              {documentLoaded && viewMode === 'canvas' && canvasContinuousMode && renderAllCanvasPages()}
            </Document>
          ) : (
            <div className="no-pdf-selected">No PDF selected or available</div>
          )}
        </ErrorBoundary>
      </div>
      {/* Navegación de página (solo para modo canvas de página única) */}
      {viewMode === 'canvas' && !canvasContinuousMode && documentLoaded && (
        <div className="page-navigation">
          {/* ... (page navigation buttons as before) ... */}
          <button 
            onClick={previousPage} 
            disabled={pageNumber <= 1}
            className="page-nav-button"
          >
            ←
          </button>
          <span className="page-indicator">
            {pageNumber} of {numPages}
          </span>
          <button 
            onClick={nextPage} 
            disabled={pageNumber >= numPages}
            className="page-nav-button"
          >
            →
          </button>
        </div>
      )}
    </div>
  );
};

export default Reader;