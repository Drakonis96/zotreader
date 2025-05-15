import { useRef, useState } from 'react';

export default function DocInfo({ doc, lib }) {
  if (!doc) return <p className="p-4 text-gray-400">Select a document</p>;

  // Helper function to format creators
  const formatCreators = (creators) => {
    if (!creators || creators.length === 0) return 'N/A';
    // Handle both array of objects and simple string format if needed
    if (Array.isArray(creators)) {
        return creators.map(c => `${c.firstName || ''} ${c.lastName || ''}`.trim()).join(', ') || 'N/A';
    }
    if (typeof creators === 'string') {
        return creators;
    }
    return 'N/A';
  };

  // Helper function to format tags
  const formatTags = (tags) => {
    if (!tags || tags.length === 0) return 'N/A';
    // Normaliza: si es objeto, extrae .tag, si es string, usa tal cual
    return tags.map(t => (typeof t === 'string' ? t : t.tag)).filter(Boolean).join(', ');
  };

  return (
    <div className="p-4 space-y-3">
      <div>
        <p className="font-semibold">Title:</p>
        <p className="text-sm">{doc.title || 'N/A'}</p>
      </div>

      <div>
        <p className="font-semibold">Creator(s):</p>
        <p className="text-sm">{formatCreators(doc.creators)}</p>
      </div>

      <div>
        <p className="font-semibold">Abstract:</p>
        <p className="text-sm">{doc.abstractNote || 'N/A'}</p>
      </div>

      <div>
        <p className="font-semibold">Item Type:</p>
        <p className="text-sm">{doc.itemType || 'N/A'}</p>
      </div>

      <div>
        <p className="font-semibold">Date:</p>
        <p className="text-sm">{doc.date || 'N/A'}</p>
      </div>

      <div>
        <p className="font-semibold">URL:</p>
        <p className="text-sm truncate">
          {doc.url ? 
            <a href={doc.url} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline">
              {doc.url}
            </a> 
            : 'N/A'}
        </p>
      </div>

      <div>
        <p className="font-semibold">Tags:</p>
        <p className="text-sm">{formatTags(doc.tags)}</p>
      </div>

      <div>
        <p className="font-semibold">Publisher:</p>
        <p className="text-sm">{doc.publisher || 'N/A'}</p>
      </div>

      <div>
        <p className="font-semibold">Publication:</p>
        <p className="text-sm">{doc.publicationTitle || doc.publication || 'N/A'}</p>
      </div>

      <div>
        <p className="font-semibold">Attachments:</p>
        {doc.attachments && doc.attachments.length > 0 ? (
          <ul className="text-sm list-disc pl-5">
            {doc.attachments.map(att => (
              <li key={att.key}>
                {att.title || att.filename || '(Unnamed attachment)'}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm">None</p>
        )}
      </div>

      {/* Add more fields as needed from doc object */}

    </div>
  );
}
