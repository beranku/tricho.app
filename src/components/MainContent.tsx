/**
 * Main Content Component
 *
 * The main authenticated view of the TrichoApp, displayed when the user
 * is logged in and the database is ready.
 *
 * Features:
 * - App header with title and sync status
 * - Customer list with search and navigation
 * - Responsive layout with iOS safe area support
 *
 * @module components/MainContent
 */

import React from 'react';
import { CustomerList } from './CustomerList';
import { SyncStatus } from './SyncStatus';

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
// Component
// ============================================================================

/**
 * Main authenticated content area.
 *
 * Renders the app header with sync status and the customer list.
 * This is the primary view users see after logging in.
 */
export function MainContent({ className = '' }: MainContentProps) {
  const containerClasses = ['main-content', className].filter(Boolean).join(' ');

  return (
    <div className={containerClasses}>
      <header className="main-content-header">
        <h1 className="main-content-title">TrichoApp</h1>
        <div className="main-content-actions">
          <SyncStatus variant="compact" />
        </div>
      </header>

      <main className="main-content-body">
        <CustomerList />
      </main>
    </div>
  );
}

// ============================================================================
// Exports
// ============================================================================

export default MainContent;
