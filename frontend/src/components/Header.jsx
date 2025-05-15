import { useState } from 'react';

export default function Header(){
    const [isRefreshing, setIsRefreshing] = useState(false); // Renamed for clarity
    const [isClearing, setIsClearing] = useState(false); // State for clearing downloads

    const handleRefresh = async () => {
        setIsRefreshing(true);
        try {
            const response = await fetch('/api/refresh-libraries', { method: 'POST' });
            if (!response.ok) {
                throw new Error('Error updating libraries');
            }
            console.log('Libraries updated');
            window.location.reload();
        } catch (error) {
            console.error("Error refreshing libraries:", error);
            alert(`Error updating: ${error.message}`); // Show alert on error
        } finally {
            setIsRefreshing(false);
        }
    };

    const handleClearDownloads = async () => {
        // Confirmation dialog
        if (!window.confirm("Are you sure you want to delete all locally downloaded PDF files?")) {
            return; // Abort if user cancels
        }

        setIsClearing(true);
        try {
            const response = await fetch('/api/clear-downloads', { method: 'POST' });
            const result = await response.json(); // Get response body

            if (!response.ok) {
                throw new Error(result.detail || 'Error clearing downloads');
            }

            console.log('Downloads cleared:', result);
            alert(result.message || 'Downloaded files deleted.'); // Show success message from backend

        } catch (error) {
            console.error("Error clearing downloads:", error);
            alert(`Error clearing downloads: ${error.message}`); // Show alert on error
        } finally {
            setIsClearing(false);
        }
    };

    return (
      <header className="flex items-center justify-between px-4 h-20 shadow-md overflow-x-auto whitespace-nowrap">
        <div className="flex items-center flex-shrink-0">
            <img src="/logo.png" alt="logo" className="h-14 mr-2"/>
            <h1 className="font-semibold text-2xl">ZotReader</h1>
        </div>
        {/* Group buttons together */}
        <div className="flex items-center space-x-2 flex-shrink-0">
            <button
                onClick={handleClearDownloads}
                disabled={isClearing || isRefreshing} // Disable if either action is running
                className="p-2 rounded hover:bg-gray-200 disabled:opacity-50 disabled:cursor-not-allowed text-red-600 hover:text-red-800"
                title="Clear downloaded PDFs"
            >
                {isClearing ? <img src="/icons/bin.svg" alt="Clearing..." className="inline-block w-5 h-5 animate-pulse" /> : <img src="/icons/bin.svg" alt="Clear Downloads" className="inline-block w-5 h-5" />} {/* Trash icon */}
            </button>
            <button
                onClick={handleRefresh}
                disabled={isRefreshing || isClearing} // Disable if either action is running
                className="p-2 rounded hover:bg-gray-200 disabled:opacity-50 disabled:cursor-not-allowed"
                title="Refresh libraries"
            >
                {isRefreshing ? <img src="/icons/update.svg" alt="Refreshing..." className="inline-block w-5 h-5 animate-spin" /> : <img src="/icons/update.svg" alt="Refresh Libraries" className="inline-block w-5 h-5" />} {/* Refresh icon */}
            </button>
        </div>
      </header>
    )
  }
