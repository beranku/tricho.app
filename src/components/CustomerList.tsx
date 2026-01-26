/**
 * Customer List Component
 *
 * Displays a searchable, sortable list of customers with reactive updates.
 * Uses RxDB hooks for real-time data synchronization.
 *
 * Features:
 * - Real-time search across encrypted name, phone, and email fields
 * - Sortable by name, recent activity, or creation date
 * - Empty states for no customers and no search results
 * - Loading skeleton for better perceived performance
 * - Accessibility-compliant with proper ARIA attributes
 *
 * @module components/CustomerList
 *
 * @example
 * ```tsx
 * import { CustomerList } from '@/components/CustomerList';
 *
 * function CustomersPage() {
 *   return (
 *     <CustomerList
 *       onCustomerClick={(id) => navigate(`/customers/${id}`)}
 *       onAddCustomer={() => setShowAddModal(true)}
 *     />
 *   );
 * }
 * ```
 */

import React, {
  useState,
  useCallback,
  useMemo,
  type ChangeEvent,
} from 'react';
import {
  useCustomers,
  useCustomerSearch,
  useCustomerVisitCount,
  type CustomerQueryOptions,
} from '../db/hooks';
import type { CustomerDocument } from '../db/schemas';

// ============================================================================
// Types
// ============================================================================

/**
 * Sort options for customer list
 */
export type CustomerSortOption = 'name' | 'recent' | 'created';

/**
 * Props for CustomerList component
 */
export interface CustomerListProps {
  /** Callback when a customer is clicked */
  onCustomerClick?: (customerId: string) => void;
  /** Callback for add customer action */
  onAddCustomer?: () => void;
  /** Whether to show the add button (default: true) */
  showAddButton?: boolean;
  /** Whether to show the search input (default: true) */
  showSearch?: boolean;
  /** Whether to show sort options (default: true) */
  showSort?: boolean;
  /** Maximum number of customers to display */
  limit?: number;
  /** Custom class name for styling */
  className?: string;
  /** Empty state message when no customers exist */
  emptyMessage?: string;
  /** Empty state message when search returns no results */
  noResultsMessage?: string;
}

/**
 * Props for CustomerListItem
 */
interface CustomerListItemProps {
  customer: CustomerDocument;
  onClick?: () => void;
  isSelected?: boolean;
}

// ============================================================================
// Helper Components
// ============================================================================

/**
 * Search icon SVG
 */
function SearchIcon({ size = 20 }: { size?: number }) {
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
      className="customer-list-search-icon"
      aria-hidden="true"
    >
      <circle cx="11" cy="11" r="8" />
      <line x1="21" y1="21" x2="16.65" y2="16.65" />
    </svg>
  );
}

/**
 * Add icon SVG
 */
function AddIcon({ size = 20 }: { size?: number }) {
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
      className="customer-list-add-icon"
      aria-hidden="true"
    >
      <line x1="12" y1="5" x2="12" y2="19" />
      <line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  );
}

/**
 * Person icon SVG for avatar placeholder
 */
function PersonIcon({ size = 24 }: { size?: number }) {
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
      className="customer-avatar-icon"
      aria-hidden="true"
    >
      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
      <circle cx="12" cy="7" r="4" />
    </svg>
  );
}

/**
 * Chevron right icon for list items
 */
function ChevronRightIcon({ size = 16 }: { size?: number }) {
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
      className="customer-list-chevron"
      aria-hidden="true"
    >
      <polyline points="9 18 15 12 9 6" />
    </svg>
  );
}

/**
 * Loading spinner
 */
function LoadingSpinner({ size = 24 }: { size?: number }) {
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
      className="customer-list-spinner"
      aria-hidden="true"
    >
      <path d="M21 12a9 9 0 1 1-6.219-8.56" />
    </svg>
  );
}

/**
 * Get initials from customer name
 */
function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 0 || parts[0] === '') {
    return '?';
  }
  if (parts.length === 1) {
    return parts[0].charAt(0).toUpperCase();
  }
  return (parts[0].charAt(0) + parts[parts.length - 1].charAt(0)).toUpperCase();
}

/**
 * Format relative time for last visit
 */
function formatRelativeTime(timestamp: number): string {
  const now = Date.now();
  const diff = now - timestamp;
  const seconds = Math.floor(diff / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  const weeks = Math.floor(days / 7);
  const months = Math.floor(days / 30);

  if (months > 0) {
    return months === 1 ? '1 month ago' : `${months} months ago`;
  }
  if (weeks > 0) {
    return weeks === 1 ? '1 week ago' : `${weeks} weeks ago`;
  }
  if (days > 0) {
    return days === 1 ? 'yesterday' : `${days} days ago`;
  }
  if (hours > 0) {
    return hours === 1 ? '1 hour ago' : `${hours} hours ago`;
  }
  if (minutes > 0) {
    return minutes === 1 ? '1 minute ago' : `${minutes} minutes ago`;
  }
  return 'just now';
}

/**
 * Customer avatar component
 */
function CustomerAvatar({ name }: { name: string }) {
  const initials = useMemo(() => getInitials(name), [name]);

  return (
    <div className="customer-avatar" aria-hidden="true">
      {initials !== '?' ? (
        <span className="customer-avatar-initials">{initials}</span>
      ) : (
        <PersonIcon size={20} />
      )}
    </div>
  );
}

/**
 * Customer list item component with visit count
 */
function CustomerListItem({
  customer,
  onClick,
  isSelected = false,
}: CustomerListItemProps) {
  const { data: visitCount } = useCustomerVisitCount(customer.id);
  const name = customer.enc?.name || 'Unknown';
  const phone = customer.enc?.phone;
  const email = customer.enc?.email;
  const lastUpdated = customer.updatedAt;

  const handleClick = useCallback(() => {
    onClick?.();
  }, [onClick]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        onClick?.();
      }
    },
    [onClick]
  );

  return (
    <div
      className={`customer-list-item ${isSelected ? 'customer-list-item--selected' : ''}`}
      onClick={handleClick}
      onKeyDown={handleKeyDown}
      role="button"
      tabIndex={0}
      aria-selected={isSelected}
    >
      <CustomerAvatar name={name} />
      <div className="customer-list-item-content">
        <div className="customer-list-item-name">{name}</div>
        <div className="customer-list-item-details">
          {phone && (
            <span className="customer-list-item-phone">{phone}</span>
          )}
          {email && !phone && (
            <span className="customer-list-item-email">{email}</span>
          )}
          {!phone && !email && (
            <span className="customer-list-item-meta">
              {visitCount > 0
                ? `${visitCount} visit${visitCount === 1 ? '' : 's'}`
                : 'No visits yet'}
            </span>
          )}
        </div>
      </div>
      <div className="customer-list-item-right">
        <span className="customer-list-item-time">
          {formatRelativeTime(lastUpdated)}
        </span>
        <ChevronRightIcon size={16} />
      </div>
    </div>
  );
}

/**
 * Loading skeleton for customer list
 */
function CustomerListSkeleton({ count = 5 }: { count?: number }) {
  return (
    <div className="customer-list-skeleton" aria-busy="true" aria-label="Loading customers">
      {Array.from({ length: count }).map((_, index) => (
        <div key={index} className="customer-list-skeleton-item">
          <div className="customer-list-skeleton-avatar" />
          <div className="customer-list-skeleton-content">
            <div className="customer-list-skeleton-name" />
            <div className="customer-list-skeleton-details" />
          </div>
          <div className="customer-list-skeleton-time" />
        </div>
      ))}
    </div>
  );
}

/**
 * Empty state component
 */
function EmptyState({
  message,
  showAddButton,
  onAdd,
  isSearchEmpty = false,
}: {
  message: string;
  showAddButton: boolean;
  onAdd?: () => void;
  isSearchEmpty?: boolean;
}) {
  return (
    <div className="customer-list-empty" role="status">
      <PersonIcon size={48} />
      <p className="customer-list-empty-message">{message}</p>
      {showAddButton && !isSearchEmpty && (
        <button
          type="button"
          className="customer-list-empty-button"
          onClick={onAdd}
        >
          <AddIcon size={16} />
          <span>Add First Customer</span>
        </button>
      )}
    </div>
  );
}

/**
 * Error state component
 */
function ErrorState({ message }: { message: string }) {
  return (
    <div className="customer-list-error" role="alert">
      <svg
        width="48"
        height="48"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <circle cx="12" cy="12" r="10" />
        <line x1="12" y1="8" x2="12" y2="12" />
        <line x1="12" y1="16" x2="12.01" y2="16" />
      </svg>
      <p className="customer-list-error-message">{message}</p>
    </div>
  );
}

// ============================================================================
// Main Component
// ============================================================================

/**
 * Customer list component with search, sort, and real-time updates.
 *
 * Provides a comprehensive view of all customers with:
 * - Client-side search across encrypted fields
 * - Multiple sort options
 * - Loading states and skeletons
 * - Empty and error states
 * - Accessibility support
 */
export function CustomerList({
  onCustomerClick,
  onAddCustomer,
  showAddButton = true,
  showSearch = true,
  showSort = true,
  limit,
  className = '',
  emptyMessage = 'No customers yet',
  noResultsMessage = 'No customers match your search',
}: CustomerListProps) {
  // ========================================================================
  // State
  // ========================================================================

  const [searchTerm, setSearchTerm] = useState('');
  const [sortOption, setSortOption] = useState<CustomerSortOption>('recent');

  // ========================================================================
  // Data Fetching
  // ========================================================================

  // Build query options based on sort
  const queryOptions = useMemo<CustomerQueryOptions>(() => {
    const options: CustomerQueryOptions = {
      includeDeleted: false,
      limit,
    };

    switch (sortOption) {
      case 'recent':
        options.sortBy = 'updatedAt';
        options.sortDirection = 'desc';
        break;
      case 'created':
        options.sortBy = 'createdAt';
        options.sortDirection = 'desc';
        break;
      case 'name':
        // Note: We can't sort by encrypted name field in RxDB
        // Fall back to updatedAt and sort client-side
        options.sortBy = 'updatedAt';
        options.sortDirection = 'desc';
        break;
    }

    return options;
  }, [sortOption, limit]);

  // Use search hook if searching, otherwise use regular query
  const hasSearch = searchTerm.trim().length > 0;
  const searchResult = useCustomerSearch(searchTerm);
  const regularResult = useCustomers(queryOptions);

  // Pick the appropriate result
  const { data: customers, loading, error } = hasSearch ? searchResult : regularResult;

  // Sort by name client-side if that option is selected
  const sortedCustomers = useMemo(() => {
    if (sortOption !== 'name') {
      return customers;
    }

    return [...customers].sort((a, b) => {
      const nameA = a.enc?.name?.toLowerCase() || '';
      const nameB = b.enc?.name?.toLowerCase() || '';
      return nameA.localeCompare(nameB);
    });
  }, [customers, sortOption]);

  // ========================================================================
  // Handlers
  // ========================================================================

  const handleSearchChange = useCallback((e: ChangeEvent<HTMLInputElement>) => {
    setSearchTerm(e.target.value);
  }, []);

  const handleClearSearch = useCallback(() => {
    setSearchTerm('');
  }, []);

  const handleSortChange = useCallback((e: ChangeEvent<HTMLSelectElement>) => {
    setSortOption(e.target.value as CustomerSortOption);
  }, []);

  const handleCustomerClick = useCallback(
    (customerId: string) => {
      onCustomerClick?.(customerId);
    },
    [onCustomerClick]
  );

  // ========================================================================
  // Render
  // ========================================================================

  const containerClasses = [
    'customer-list',
    loading ? 'customer-list--loading' : '',
    error ? 'customer-list--error' : '',
    className,
  ]
    .filter(Boolean)
    .join(' ');

  const isEmpty = sortedCustomers.length === 0 && !loading;
  const isSearchEmpty = isEmpty && hasSearch;

  return (
    <div className={containerClasses}>
      {/* Header with search and actions */}
      <div className="customer-list-header">
        {/* Search Input */}
        {showSearch && (
          <div className="customer-list-search">
            <SearchIcon size={18} />
            <input
              type="search"
              className="customer-list-search-input"
              placeholder="Search customers..."
              value={searchTerm}
              onChange={handleSearchChange}
              aria-label="Search customers"
            />
            {searchTerm && (
              <button
                type="button"
                className="customer-list-search-clear"
                onClick={handleClearSearch}
                aria-label="Clear search"
              >
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            )}
          </div>
        )}

        {/* Sort and Add Actions */}
        <div className="customer-list-actions">
          {showSort && (
            <div className="customer-list-sort">
              <label htmlFor="customer-sort" className="customer-list-sort-label">
                Sort by:
              </label>
              <select
                id="customer-sort"
                className="customer-list-sort-select"
                value={sortOption}
                onChange={handleSortChange}
                aria-label="Sort customers"
              >
                <option value="recent">Recent Activity</option>
                <option value="name">Name</option>
                <option value="created">Date Added</option>
              </select>
            </div>
          )}

          {showAddButton && (
            <button
              type="button"
              className="customer-list-add-button"
              onClick={onAddCustomer}
              aria-label="Add new customer"
            >
              <AddIcon size={18} />
              <span className="customer-list-add-button-text">Add</span>
            </button>
          )}
        </div>
      </div>

      {/* Customer Count */}
      {!loading && !isEmpty && (
        <div className="customer-list-count" role="status">
          {hasSearch ? (
            <span>
              Found {sortedCustomers.length} customer
              {sortedCustomers.length === 1 ? '' : 's'}
            </span>
          ) : (
            <span>
              {sortedCustomers.length} customer
              {sortedCustomers.length === 1 ? '' : 's'}
            </span>
          )}
        </div>
      )}

      {/* Content */}
      <div className="customer-list-content" role="list" aria-label="Customer list">
        {/* Loading State */}
        {loading && <CustomerListSkeleton count={5} />}

        {/* Error State */}
        {error && !loading && <ErrorState message={error.message} />}

        {/* Empty State */}
        {isEmpty && !error && (
          <EmptyState
            message={isSearchEmpty ? noResultsMessage : emptyMessage}
            showAddButton={showAddButton && !isSearchEmpty}
            onAdd={onAddCustomer}
            isSearchEmpty={isSearchEmpty}
          />
        )}

        {/* Customer Items */}
        {!loading && !error && sortedCustomers.length > 0 && (
          <div className="customer-list-items">
            {sortedCustomers.map((customer) => (
              <CustomerListItem
                key={customer.id}
                customer={customer}
                onClick={() => handleCustomerClick(customer.id)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ============================================================================
// Convenience Components
// ============================================================================

/**
 * Compact customer list for sidebar or widget use.
 * Shows fewer details and has a smaller footprint.
 */
export function CustomerListCompact({
  onCustomerClick,
  limit = 5,
  className = '',
}: {
  onCustomerClick?: (customerId: string) => void;
  limit?: number;
  className?: string;
}) {
  return (
    <CustomerList
      onCustomerClick={onCustomerClick}
      showAddButton={false}
      showSearch={false}
      showSort={false}
      limit={limit}
      className={`customer-list--compact ${className}`}
      emptyMessage="No recent customers"
    />
  );
}

/**
 * Customer search input with instant results.
 * Use for quick customer lookup.
 */
export function CustomerSearchBox({
  onSelect,
  placeholder = 'Search for a customer...',
  className = '',
}: {
  onSelect?: (customerId: string, customerName: string) => void;
  placeholder?: string;
  className?: string;
}) {
  const [searchTerm, setSearchTerm] = useState('');
  const [isOpen, setIsOpen] = useState(false);
  const { data: results, loading } = useCustomerSearch(searchTerm);

  const handleSelect = useCallback(
    (customer: CustomerDocument) => {
      onSelect?.(customer.id, customer.enc?.name || 'Unknown');
      setSearchTerm('');
      setIsOpen(false);
    },
    [onSelect]
  );

  const handleInputChange = useCallback((e: ChangeEvent<HTMLInputElement>) => {
    setSearchTerm(e.target.value);
    setIsOpen(e.target.value.trim().length > 0);
  }, []);

  const handleBlur = useCallback(() => {
    // Delay to allow click on results
    setTimeout(() => setIsOpen(false), 200);
  }, []);

  return (
    <div className={`customer-search-box ${className}`}>
      <div className="customer-search-box-input-wrapper">
        <SearchIcon size={16} />
        <input
          type="search"
          className="customer-search-box-input"
          placeholder={placeholder}
          value={searchTerm}
          onChange={handleInputChange}
          onFocus={() => searchTerm.trim() && setIsOpen(true)}
          onBlur={handleBlur}
          aria-label="Search customers"
          aria-expanded={isOpen}
          aria-haspopup="listbox"
        />
        {loading && <LoadingSpinner size={16} />}
      </div>

      {isOpen && results.length > 0 && (
        <div
          className="customer-search-box-results"
          role="listbox"
          aria-label="Search results"
        >
          {results.slice(0, 5).map((customer) => (
            <button
              key={customer.id}
              type="button"
              className="customer-search-box-result"
              onClick={() => handleSelect(customer)}
              role="option"
            >
              <CustomerAvatar name={customer.enc?.name || 'Unknown'} />
              <div className="customer-search-box-result-content">
                <span className="customer-search-box-result-name">
                  {customer.enc?.name || 'Unknown'}
                </span>
                {customer.enc?.phone && (
                  <span className="customer-search-box-result-phone">
                    {customer.enc.phone}
                  </span>
                )}
              </div>
            </button>
          ))}
        </div>
      )}

      {isOpen && searchTerm.trim() && results.length === 0 && !loading && (
        <div className="customer-search-box-no-results">
          No customers found
        </div>
      )}
    </div>
  );
}

// ============================================================================
// Exports
// ============================================================================

export default CustomerList;
