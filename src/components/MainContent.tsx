/**
 * Main Content Component
 *
 * The main authenticated view of the TrichoApp, displayed when the user
 * is logged in and the database is ready.
 *
 * Features:
 * - App header with title and sync status
 * - Customer list with search and navigation
 * - Offline CRUD support (create customers offline, sync when online)
 * - Responsive layout with iOS safe area support
 *
 * @module components/MainContent
 */

import React, { useState, useCallback, useEffect, useRef } from 'react';
import { CustomerList } from './CustomerList';
import { SyncStatus } from './SyncStatus';
import { CustomerFormModal } from './CustomerForm';
import { useIsOnline } from '../sync/hooks';
import { getDatabase } from '../db/index';
import { useAuth } from '../context/AuthContext';
import type { CustomerDocument } from '../db/schemas';

// ============================================================================
// Types
// ============================================================================

/**
 * Props for MainContent component
 */
export interface MainContentProps {
  /** Optional class name for styling */
  className?: string;
}

// ============================================================================
// Icons
// ============================================================================

function WifiOffIcon({ size = 16 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <line x1="1" y1="1" x2="23" y2="23" />
      <path d="M16.72 11.06A10.94 10.94 0 0 1 19 12.55" />
      <path d="M5 12.55a10.94 10.94 0 0 1 5.17-2.39" />
      <path d="M10.71 5.05A16 16 0 0 1 22.58 9" />
      <path d="M1.42 9a15.91 15.91 0 0 1 4.7-2.88" />
      <path d="M8.53 16.11a6 6 0 0 1 6.95 0" />
      <line x1="12" y1="20" x2="12.01" y2="20" />
    </svg>
  );
}

// ============================================================================
// Component
// ============================================================================

/**
 * Main authenticated content area.
 *
 * Renders the app header with sync status and the customer list.
 * This is the primary view users see after logging in.
 *
 * Supports offline CRUD:
 * - Create customers while offline (saved to local RxDB)
 * - Data syncs automatically when device comes back online
 */
export function MainContent({ className = '' }: MainContentProps) {
  const containerClasses = ['main-content', className].filter(Boolean).join(' ');

  // Modal state for adding customers
  const [isAddCustomerOpen, setIsAddCustomerOpen] = useState(false);
  const [selectedCustomerId, setSelectedCustomerId] = useState<string | null>(null);

  // Online status for showing offline indicator
  const isOnline = useIsOnline();

  // Auth context for sync initialization
  const { user, isDatabaseReady } = useAuth();

  // Track if sync has been initialized
  const syncInitializedRef = useRef(false);

  // Initialize sync when database is ready
  useEffect(() => {
    let destroyed = false;

    async function initializeSync() {
      // Only init once, when database and user are ready
      if (syncInitializedRef.current || !isDatabaseReady || !user) {
        return;
      }

      const db = getDatabase();
      if (!db) {
        return;
      }

      try {
        // Dynamically import to avoid SSR issues
        const { initSync, destroySync } = await import('../sync/orchestrator');

        // Don't init if component was destroyed
        if (destroyed) {
          return;
        }

        // Initialize sync with database and user info
        await initSync({
          database: db,
          userId: user.userId,
          // Enable all sync features
          enableForegroundSync: true, // Sync when app comes to foreground (iOS)
          enableNetworkSync: true,    // Sync when network status changes
          live: true,                 // Continuous sync
        });

        syncInitializedRef.current = true;
      } catch (error) {
        // Sync init failed - app still works offline
        // Error is logged in sync orchestrator
      }
    }

    initializeSync();

    // Cleanup on unmount
    return () => {
      destroyed = true;
      // Note: We don't destroy sync on unmount because it should continue
      // running in the background. destroySync() is called on logout.
    };
  }, [isDatabaseReady, user]);

  // Handlers
  const handleAddCustomer = useCallback(() => {
    setIsAddCustomerOpen(true);
  }, []);

  const handleCloseAddCustomer = useCallback(() => {
    setIsAddCustomerOpen(false);
  }, []);

  const handleCustomerSaved = useCallback((customer: CustomerDocument) => {
    setSelectedCustomerId(customer.id);
    setIsAddCustomerOpen(false);
  }, []);

  const handleCustomerClick = useCallback((customerId: string) => {
    setSelectedCustomerId(customerId);
  }, []);

  return (
    <div className={containerClasses}>
      <header className="main-content-header">
        <h1 className="main-content-title">TrichoApp</h1>
        <div className="main-content-actions">
          <SyncStatus variant="compact" />
        </div>
      </header>

      {/* Offline indicator */}
      {!isOnline && (
        <div className="main-content-offline-banner" role="status">
          <WifiOffIcon size={16} />
          <span>You're offline. Changes will sync when reconnected.</span>
        </div>
      )}

      <main className="main-content-body">
        <CustomerList
          onAddCustomer={handleAddCustomer}
          onCustomerClick={handleCustomerClick}
        />
      </main>

      {/* Add Customer Modal */}
      <CustomerFormModal
        isOpen={isAddCustomerOpen}
        onClose={handleCloseAddCustomer}
        onSave={handleCustomerSaved}
      />
    </div>
  );
}

// ============================================================================
// Exports
// ============================================================================

export default MainContent;
