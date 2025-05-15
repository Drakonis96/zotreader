import {useState} from 'react'
import DocInfo from './DocInfo'
import ChatInterface from './ChatInterface'

export default function RightPanel({doc, onHide, lib, width}){
  const [mode,setMode]=useState('info') // info | chat
  return (
    <aside className="border-l flex flex-col relative h-full" style={{ width: width || '100%', minWidth: 120, maxWidth: 600 }}>
      {/* Eliminar el botón de cerrar de aquí, lo movemos fuera en App.jsx */}
      <div className="flex border-b shrink-0"> {/* Cambiado justify-around a flex para que coincida con SidebarLibraries */}
        <button 
          onClick={()=>setMode('info')} 
          className={`flex-1 py-2 text-sm ${mode==='info'?'font-semibold border-b-2 border-gray-700':''}`}
        >Info</button>
        <button 
          onClick={()=>setMode('chat')} 
          className={`flex-1 py-2 text-sm ${mode==='chat'?'font-semibold border-b-2 border-gray-700':''}`}
        >Chat</button>
      </div>
      {/* Removed overflow-y-auto, added flex-1 to let child manage scroll */}
      <div className="flex-1 flex flex-col overflow-hidden"> 
        {mode==='info'? <div className="flex-1 overflow-y-auto"><DocInfo doc={doc} lib={lib}/></div> : <ChatInterface doc={doc}/>} 
      </div>
    </aside>
  )
}
