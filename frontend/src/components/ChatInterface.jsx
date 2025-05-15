import { useState, useRef, useEffect } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import LoadingDots from './LoadingDots';
import ErrorBoundary from './ErrorBoundary';

// Añadimos algunos estilos inline para el markdown
const markdownStyles = {
  message: {
    lineHeight: '1.5',
    wordBreak: 'break-word'
  },
  paragraph: {
    margin: '0.5em 0'
  },
  heading1: {
    fontSize: '1.5em',
    fontWeight: 'bold',
    margin: '0.5em 0',
    borderBottom: '1px solid #eee'
  },
  heading2: {
    fontSize: '1.3em',
    fontWeight: 'bold',
    margin: '0.5em 0'
  },
  heading3: {
    fontSize: '1.1em',
    fontWeight: 'bold',
    margin: '0.5em 0'
  },
  list: {
    marginLeft: '1.5em',
    marginTop: '0.5em',
    marginBottom: '0.5em'
  },
  listItem: {
    margin: '0.2em 0'
  },
  link: {
    color: '#0366d6',
    textDecoration: 'none'
  },
  code: {
    backgroundColor: '#f6f8fa',
    padding: '0.2em 0.4em',
    borderRadius: '3px',
    fontFamily: 'monospace',
    fontSize: '85%'
  },
  pre: {
    backgroundColor: '#f6f8fa',
    padding: '1em',
    borderRadius: '3px',
    overflow: 'auto',
    fontSize: '85%'
  },
  blockquote: {
    borderLeft: '4px solid #dfe2e5',
    paddingLeft: '1em',
    color: '#6a737d',
    margin: '0.5em 0'
  },
  table: {
    borderCollapse: 'collapse',
    width: '100%',
    marginBottom: '1em'
  },
  tableCell: {
    border: '1px solid #dfe2e5',
    padding: '6px 13px'
  },
  tableHeader: {
    backgroundColor: '#f6f8fa'
  },
  codeBlock: {
    margin: '0.5em 0',
    padding: '0.5em',
    overflow: 'auto',
    backgroundColor: '#f6f8fa',
    borderRadius: '3px',
    fontFamily: 'monospace',
    fontSize: '90%'
  }
};

const API_OPTIONS = [
  { value: 'openai', label: 'OpenAI' },
  { value: 'google', label: 'Google' },
  { value: 'openrouter', label: 'OpenRouter' },
];

export default function ChatInterface() {
  const [api, setApi] = useState('openai');
  const [model, setModel] = useState('gpt-3.5-turbo');
  const [models, setModels] = useState({
    openai: [
      'gpt-4.1',
      'gpt-4.1-mini',
      'gpt-4o',
      'gpt-4o-mini',
    ],
    google: ['gemini-2.0-flash'],
    openrouter: [
      'google/gemma-3-27b-it:free',
      'google/gemini-2.0-flash-exp:free',
      'meta-llama/llama-4-maverick:free',
      'meta-llama/llama-4-scout:free',
    ],
  });
  const [apiKeys, setApiKeys] = useState({ openai: '', google: '', openrouter: '' });
  const [showSettings, setShowSettings] = useState(false);
  const [input, setInput] = useState('');
  const [messages, setMessages] = useState([]); // [{role: 'user'|'assistant', content: ''}]
  const [localPdfs, setLocalPdfs] = useState([]); // List of local PDFs
  const [selectedPdf, setSelectedPdf] = useState(''); // Selected PDF filename
  const [sendAsMarkdown, setSendAsMarkdown] = useState(true); // Por defecto activado
  const [isLoading, setIsLoading] = useState(false);
  const chatRef = useRef(null);

  // Auto-scroll al final del chat
  useEffect(() => {
    if (chatRef.current) {
      chatRef.current.scrollTop = chatRef.current.scrollHeight;
    }
  }, [messages]);

  // Update model when API changes
  useEffect(() => {
    const availableModels = models[api] || [];
    if (availableModels.length > 0) {
      setModel(availableModels[0]); // Set to the first model of the selected API
    } else {
      setModel(''); // Or handle the case where there are no models for the API
    }
  }, [api, models]); // Rerun when api or the models list itself changes

  // Fetch local PDFs when API es google, openai o openrouter
  useEffect(() => {
    if (api === 'google' || api === 'openai' || api === 'openrouter') {
      fetch(`/api/${api}/list-local-pdfs`)
        .then(res => res.json())
        .then(data => setLocalPdfs(data))
        .catch(() => setLocalPdfs([]));
    }
  }, [api]);

  // Fetch API keys from backend on mount
  useEffect(() => {
    fetch('/api/config')
      .then(res => res.json())
      .then(config => {
        setApiKeys(prevKeys => ({
          openai: config.openai_api_key || prevKeys.openai, // Keep existing if not provided by backend
          google: config.google_api_key || prevKeys.google,
          openrouter: config.openrouter_api_key || prevKeys.openrouter,
        }));
      })
      .catch(err => console.error("Error fetching API config:", err));
  }, []); // Empty dependency array ensures this runs only once on mount

  // Handlers para ajustes
  const handleAddModel = (apiName, newModel) => {
    setModels(prev => ({
      ...prev,
      [apiName]: [...(prev[apiName] || []), newModel]
    }));
  };
  const handleRemoveModel = (apiName, modelName) => {
    setModels(prev => ({
      ...prev,
      [apiName]: prev[apiName].filter(m => m !== modelName)
    }));
  };
  const handleApiKeyChange = (apiName, value) => {
    setApiKeys(prev => ({ ...prev, [apiName]: value }));
  };
  const handleDeleteApiKey = (apiName) => {
    setApiKeys(prev => ({ ...prev, [apiName]: '' }));
  };
  const handleSaveSettings = () => {
    setShowSettings(false);
    // Optionally save manually entered keys to localStorage if needed
    // localStorage.setItem('manualApiKeys', JSON.stringify(apiKeys));
  };

  // Chat handlers
  const handleSend = async () => {
    if (!input.trim()) return;
    const userMsg = { role: 'user', content: input };
    const updatedMessages = [...messages, userMsg];
    setMessages(updatedMessages);
    setInput('');
    setIsLoading(true);

    // Prepara el historial para la API (ajusta roles y limpia assistant)
    const MAX_TURNS = 20;
    const apiHistory = updatedMessages
      .map(msg => ({
        role: msg.role === 'assistant' ? 'model' : msg.role,
        content: msg.content
      }))
      .slice(-MAX_TURNS);

    // Determina el nombre del archivo a enviar (PDF o markdown)
    let fileToSend = selectedPdf;
    if (sendAsMarkdown && selectedPdf) {
      // Cambia la extensión a .txt si existe un archivo markdown generado
      fileToSend = selectedPdf.replace(/\.pdf$/i, '.txt');
    }

    if (api === 'google' || api === 'openai') {
      const apiKeyToSend = apiKeys[api];
      if (!apiKeyToSend) {
        setMessages(prev => [...prev, { role: 'system', content: `⚠️ Missing API Key for ${api === 'google' ? 'Google' : 'OpenAI'}. Add it in settings or in the .env file.` }]);
        setIsLoading(false);
        return;
      }
      // Si hay un PDF seleccionado, usa /process-pdf
      if (selectedPdf) {
        const historyWithoutLast = apiHistory.slice(0, -1);
        try {
          const res = await fetch(`/api/${api}/process-pdf`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'X-Session-Id': window.localStorage.getItem('session_id') || ''
            },
            body: JSON.stringify({
              api_key: apiKeyToSend,
              model,
              pdf_filename: fileToSend, // Usar el archivo correcto
              prompt: input,
              history: historyWithoutLast
            })
          });
          if (res.status === 413) {
            const detail = await res.text();
            alert(detail);
            setIsLoading(false);
            return;
          }
          const data = await res.json();
          if (res.ok) {
            setMessages(prev => [...prev, { role: 'model', content: data.response }]);
          } else {
            setMessages(prev => [...prev, { role: 'model', content: `Error: ${data.detail || 'Unknown error'}` }]);
          }
        } catch (err) {
          setMessages(prev => [...prev, { role: 'model', content: `Error: ${err.message}` }]);
        }
        setIsLoading(false);
        return;
      }
      // Si NO hay PDF, usa el endpoint de chat normal
      try {
        const res = await fetch(`/api/${api}/chat`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Session-Id': window.localStorage.getItem('session_id') || ''
          },
          body: JSON.stringify({
            api_key: apiKeyToSend,
            model,
            history: apiHistory
          })
        });
        const data = await res.json();
        if (res.ok) {
          setMessages(prev => [...prev, { role: 'model', content: data.response }]);
        } else {
          setMessages(prev => [...prev, { role: 'model', content: `Error: ${data.detail || 'Unknown error'}` }]);
        }
      } catch (err) {
        setMessages(prev => [...prev, { role: 'model', content: `Error: ${err.message}` }]);
      }
      setIsLoading(false);
      return;
    }

    // Lógica para openrouter
    if (api === 'openrouter') {
      const apiKeyToSend = apiKeys[api];
      if (!apiKeyToSend) {
        setMessages(prev => [...prev, { role: 'system', content: '⚠️ Missing API Key for OpenRouter. Add it in settings or in the .env file.' }]);
        setIsLoading(false);
        return;
      }
      if (selectedPdf) {
        const historyWithoutLast = apiHistory.slice(0, -1);
        try {
          const res = await fetch('/api/openrouter/process-pdf', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'X-Session-Id': window.localStorage.getItem('session_id') || ''
            },
            body: JSON.stringify({
              api_key: apiKeyToSend,
              model,
              pdf_filename: fileToSend, // Usar el archivo correcto
              prompt: input,
              history: historyWithoutLast
            })
          });
          const data = await res.json();
          if (res.ok) {
            setMessages(prev => [...prev, { role: 'model', content: data.response }]);
          } else {
            setMessages(prev => [...prev, { role: 'model', content: `Error: ${data.detail || 'Unknown error'}` }]);
          }
        } catch (err) {
          setMessages(prev => [...prev, { role: 'model', content: `Error: ${err.message}` }]);
        }
        setIsLoading(false);
        return;
      }
      // Si NO hay PDF, usa el endpoint de chat normal
      try {
        const res = await fetch('/api/openrouter/chat', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Session-Id': window.localStorage.getItem('session_id') || ''
          },
          body: JSON.stringify({
            api_key: apiKeyToSend,
            model,
            history: apiHistory
          })
        });
        const data = await res.json();
        if (res.ok) {
          setMessages(prev => [...prev, { role: 'model', content: data.response }]);
        } else {
          setMessages(prev => [...prev, { role: 'model', content: `Error: ${data.detail || 'Unknown error'}` }]);
        }
      } catch (err) {
        setMessages(prev => [...prev, { role: 'model', content: `Error: ${err.message}` }]);
      }
      setIsLoading(false);
      return;
    }

    // ...aquí iría la lógica para deepseek...
    // Placeholder for other APIs - they might need similar history handling
    console.warn(`API ${api} sending logic not fully implemented with history.`);
    // Simulating an echo response for other APIs for now
    // setMessages(prev => [...prev, { role: 'assistant', content: `Echo (${api}): ${currentInput}` }]);
    setIsLoading(false);
  };
  
  const handleStop = () => {
    // Lógica para parar la generación
  };
  
  const handleClear = () => {
    setMessages([]);
  };

  useEffect(() => {
    function handleFragmentEvent(e) {
      if (e.detail) {
        setInput(e.detail); // Usar el texto recibido tal cual
      }
    }
    window.addEventListener('sendFragmentToChat', handleFragmentEvent);
    return () => window.removeEventListener('sendFragmentToChat', handleFragmentEvent);
  }, []);

  // Genera un session_id único si no existe
  useEffect(() => {
    if (!window.localStorage.getItem('session_id')) {
      // Polyfill para randomUUID si no existe
      function uuidv4() {
        if (window.crypto && window.crypto.getRandomValues) {
          // https://stackoverflow.com/a/2117523/282960
          return ([1e7]+-1e3+-4e3+-8e3+-1e11).replace(/[018]/g, c =>
            (c ^ window.crypto.getRandomValues(new Uint8Array(1))[0] & 15 >> c / 4).toString(16)
          );
        } else {
          // Fallback muy simple (no seguro, pero mejor que nada)
          return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
            var r = Math.random() * 16 | 0, v = c === 'x' ? r : (r & 0x3 | 0x8);
            return v.toString(16);
          });
        }
      }
      const uuid = (window.crypto && window.crypto.randomUUID) ? window.crypto.randomUUID() : uuidv4();
      window.localStorage.setItem('session_id', uuid);
    }
  }, []);

  return (
    <ErrorBoundary onClose={() => window.location.reload()}>
      <div className="flex flex-col h-full w-full relative">
        {/* Top bar: API selector, model selector, settings */}
        <div className="flex items-center gap-2 p-2 border-b bg-gray-50 shrink-0">
          <select value={api} onChange={e => setApi(e.target.value)} className="border rounded px-2 py-1 text-sm">
            {API_OPTIONS.map(opt => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
          <select value={model} onChange={e => setModel(e.target.value)} className="border rounded px-2 py-1 text-sm">
            {(models[api] || []).map(m => (
              <option key={m} value={m}>{m}</option>
            ))}
          </select>
          <button onClick={() => setShowSettings(true)} className="ml-2 px-2 py-1 border rounded text-lg" title="Settings">
            <img src="/icons/settings.svg" alt="Settings" className="inline-block w-5 h-5" />
          </button>
        </div>

        {/* Local PDF selector for Gemini, OpenAI, and OpenRouter */}
        {(api === 'google' || api === 'openai' || api === 'openrouter') && (
          <div className="p-2 border-b bg-gray-50 flex flex-col gap-1">
            <div className="flex items-center gap-2 mb-1">
              <label className="mr-2">Local PDF:</label>
              <select
                value={selectedPdf}
                onChange={e => setSelectedPdf(e.target.value)}
                className="border rounded px-2 py-1 text-sm"
              >
                <option value="">(None)</option>
                {localPdfs.map(pdf => (
                  <option key={pdf} value={pdf}>{pdf}</option>
                ))}
              </select>
            </div>
            <div className="flex items-center gap-2 mt-1">
              <input
                type="checkbox"
                id="sendAsMarkdown"
                checked={sendAsMarkdown}
                onChange={e => setSendAsMarkdown(e.target.checked)}
                disabled={!selectedPdf}
                style={{ transform: 'scale(1.2)' }}
              />
              <label htmlFor="sendAsMarkdown" className="text-sm select-none" style={{ fontWeight: 500 }} title="Send the automatically generated markdown file instead of the original PDF">
                Send as markdown <span style={{color:'#888'}}>(faster responses, less token usage)</span>
              </label>
            </div>
          </div>
        )}

        {/* Chat block, scrollable only here */}
        <div ref={chatRef} className="flex-1 overflow-y-auto p-4 space-y-4 bg-white">
          {messages.length === 0 && (
            <div className="text-gray-400 text-center">
              No messages yet
            </div>
          )}
          {messages.map((msg, idx) => {
            let isUser = msg.role === 'user';
            let isModel = msg.role === 'model';
            return (
              <div key={idx} className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
                <div className={`rounded px-3 py-2 max-w-[70%] ${isUser ? 'bg-blue-100 text-right' : isModel ? 'bg-gray-200' : 'bg-yellow-100 text-left'}`}>
                  {isUser && <span className="block text-xs text-blue-600 mb-1">You</span>}
                  {isModel && (
                    <span className="block text-xs text-green-700 mb-1">
                      {api === 'google' ? 'Gemini' : api === 'openai' ? 'ChatGPT' : 'Assistant'}
                    </span>
                  )}
                  {!isUser && !isModel && <span className="block text-xs text-yellow-700 mb-1">{msg.role}</span>}
                  {isModel ? (
                    <ReactMarkdown
                      remarkPlugins={[remarkGfm]}
                      components={{
                        p: ({ node, ...props }) => <p style={markdownStyles.paragraph} {...props} />,
                        h1: ({ node, ...props }) => <h1 style={markdownStyles.heading1} {...props} />,
                        h2: ({ node, ...props }) => <h2 style={markdownStyles.heading2} {...props} />,
                        h3: ({ node, ...props }) => <h3 style={markdownStyles.heading3} {...props} />,
                        ul: ({ node, ...props }) => <ul style={markdownStyles.list} {...props} />,
                        li: ({ node, ...props }) => <li style={markdownStyles.listItem} {...props} />,
                        a: ({ node, ...props }) => <a style={markdownStyles.link} {...props} />,
                        code: ({ node, inline, ...props }) =>
                          inline ? <code style={markdownStyles.code} {...props} /> : <pre style={markdownStyles.codeBlock} {...props} />,
                        blockquote: ({ node, ...props }) => <blockquote style={markdownStyles.blockquote} {...props} />,
                        table: ({ node, ...props }) => <table style={markdownStyles.table} {...props} />,
                        th: ({ node, ...props }) => <th style={markdownStyles.tableHeader} {...props} />,
                        td: ({ node, ...props }) => <td style={markdownStyles.tableCell} {...props} />,
                      }}
                    >
                      {msg.content}
                    </ReactMarkdown>
                  ) : (
                    <span>{msg.content}</span>
                  )}
                </div>
              </div>
            );
          })}
          {isLoading && (
            <div className="flex justify-start">
              <div className="rounded px-3 py-2 max-w-[70%] bg-gray-200">
                <LoadingDots />
              </div>
            </div>
          )}
        </div>

        {/* Input and actions, ALWAYS fixed at the bottom */}
        <div className="shrink-0 w-full p-2 border-t flex items-center gap-2 bg-white">
          <textarea
            className="flex-1 border rounded px-2 py-1 resize-none h-24 max-h-40 min-h-[64px] overflow-y-auto"
            placeholder={'Type…'}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && !e.shiftKey && handleSend()}
            rows={3}
            style={{lineHeight: '1.4', fontSize: '1rem', minHeight: '48px', maxHeight: '120px'}}
            disabled={api === 'deepseek'}
          />
          <button
            onClick={handleSend}
            className="px-2 py-1 text-xl"
            title="Send"
            disabled={api === 'deepseek'}
          >
            <img src="/icons/send.svg" alt="Send" className="inline-block w-5 h-5" />
          </button>
          <button onClick={handleStop} className="px-2 py-1 text-xl" title="Stop">
            <img src="/icons/stop.svg" alt="Stop" className="inline-block w-5 h-5" />
          </button>
          <button onClick={handleClear} className="px-2 py-1 text-xl" title="Clear chat">
            <img src="/icons/bin.svg" alt="Clear Chat" className="inline-block w-5 h-5" />
          </button>
        </div>

        {/* Settings modal */}
        {showSettings && (
          <div className="fixed inset-0 bg-black bg-opacity-30 flex items-center justify-center z-50">
            <div className="bg-white rounded shadow-lg p-6 min-w-[340px] max-w-[90vw]">
              <div className="flex justify-between items-center mb-4">
                <h2 className="font-semibold text-lg">Chat Settings</h2>
                <button onClick={() => setShowSettings(false)} className="text-xl"><img src="/icons/close pdf.svg" alt="Close Settings" className="inline-block w-5 h-5" /></button>
              </div>
              <div className="mb-4">
                <label className="block font-medium mb-1">API</label>
                <select value={api} onChange={e => setApi(e.target.value)} className="border rounded px-2 py-1 w-full">
                  {API_OPTIONS.map(opt => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                  ))}
                </select>
              </div>
              <div className="mb-4">
                <label className="block font-medium mb-1">Models</label>
                <ul className="mb-2">
                  {(models[api] || []).map(m => (
                    <li key={m} className="flex items-center gap-2 mb-1">
                      <span className="flex-1">{m}</span>
                      <button onClick={() => handleRemoveModel(api, m)} className="text-red-500 text-sm">Remove</button>
                    </li>
                  ))}
                </ul>
                <div className="flex gap-2">
                  <input type="text" placeholder="New model" className="border rounded px-2 py-1 flex-1" id="new-model-input" />
                </div>
              </div>
              {/* API Key Input - Pre-filled from state (which includes .env values) */}
              <div className="mb-4">
                <label className="block font-medium mb-1">API Key ({API_OPTIONS.find(o => o.value === api)?.label})</label>
                <div className="flex gap-2 items-center">
                  <input
                    type="password" // Changed to password for slight obscurity
                    className="border rounded px-2 py-1 flex-1"
                    value={apiKeys[api] || ''}
                    onChange={e => handleApiKeyChange(api, e.target.value)}
                    placeholder={`Enter your API key for ${API_OPTIONS.find(o => o.value === api)?.label}`}
                  />
                  {apiKeys[api] && (
                    <button onClick={() => handleDeleteApiKey(api)} className="text-red-500 text-sm" title="Delete manually entered API Key">Delete</button>
                  )}
                </div>
              </div>
              <button onClick={handleSaveSettings} className="mt-2 px-4 py-2 bg-blue-500 text-white rounded">Close Settings</button>
            </div>
          </div>
        )}
      </div>
    </ErrorBoundary>
  );
}
