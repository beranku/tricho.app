/**
 * Customer Detail Component
 *
 * Displays comprehensive information about a single customer including:
 * - Basic info (name, contact details)
 * - Visit history
 * - Photo gallery
 * - Notes and preferences
 * - Edit and delete actions
 *
 * Features:
 * - Real-time updates via RxDB subscriptions
 * - Expandable sections for organization
 * - Edit mode for inline editing
 * - Confirmation dialogs for destructive actions
 * - Accessible design with proper ARIA attributes
 *
 * @module components/CustomerDetail
 *
 * @example
 * ```tsx
 * import { CustomerDetail } from '@/components/CustomerDetail';
 *
 * function CustomerPage({ customerId }: { customerId: string }) {
 *   return (
 *     <CustomerDetail
 *       customerId={customerId}
 *       onBack={() => navigate('/customers')}
 *       onEdit={() => setShowEditModal(true)}
 *     />
 *   );
 * }
 * ```
 */

import React, {
  useState,
  useCallback,
  useMemo,
  type FormEvent,
} from 'react';
import {
  useCustomer,
  useVisits,
  usePhotos,
  useCustomerVisitCount,
  useCustomerPhotoCount,
} from '../db/hooks';
import { getDatabase } from '../db/index';
import { getCustomersCollection } from '../db/schemas';
import type { CustomerDocument, CustomerEncryptedPayload, CreateCustomerInput } from '../db/schemas';
import type { VisitDocument } from '../db/schemas';
import type { PhotoMetaDocument } from '../db/schemas';

// ============================================================================
// Types
// ============================================================================

/**
 * Props for CustomerDetail component
 */
export interface CustomerDetailProps {
  /** Customer ID to display */
  customerId: string;
  /** Callback when back button is clicked */
  onBack?: () => void;
  /** Callback when edit button is clicked (external edit) */
  onEdit?: (customerId: string) => void;
  /** Callback when delete is confirmed */
  onDelete?: (customerId: string) => void;
  /** Callback when a visit is clicked */
  onVisitClick?: (visitId: string) => void;
  /** Callback when add visit is clicked */
  onAddVisit?: (customerId: string) => void;
  /** Callback when a photo is clicked */
  onPhotoClick?: (photoId: string) => void;
  /** Callback when add photo is clicked */
  onAddPhoto?: (customerId: string) => void;
  /** Whether to allow inline editing (default: false) */
  allowInlineEdit?: boolean;
  /** Maximum number of recent visits to show (default: 5) */
  maxRecentVisits?: number;
  /** Maximum number of photos to show in preview (default: 6) */
  maxPhotoPreview?: number;
  /** Custom class name for styling */
  className?: string;
}

/**
 * Edit form state
 */
interface EditFormState {
  name: string;
  phone: string;
  email: string;
  notes: string;
  scalpNotes: string;
  allergies: string;
  preferredProducts: string;
  preferredStylist: string;
}

// ============================================================================
// Helper Components
// ============================================================================

/**
 * Back arrow icon
 */
function BackIcon({ size = 20 }: { size?: number }) {
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
      className="customer-detail-back-icon"
      aria-hidden="true"
    >
      <polyline points="15 18 9 12 15 6" />
    </svg>
  );
}

/**
 * Edit icon
 */
function EditIcon({ size = 18 }: { size?: number }) {
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
      className="customer-detail-edit-icon"
      aria-hidden="true"
    >
      <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
      <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
    </svg>
  );
}

/**
 * Delete icon
 */
function DeleteIcon({ size = 18 }: { size?: number }) {
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
      className="customer-detail-delete-icon"
      aria-hidden="true"
    >
      <polyline points="3 6 5 6 21 6" />
      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
    </svg>
  );
}

/**
 * Phone icon
 */
function PhoneIcon({ size = 16 }: { size?: number }) {
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
      <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" />
    </svg>
  );
}

/**
 * Email icon
 */
function EmailIcon({ size = 16 }: { size?: number }) {
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
      <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
      <polyline points="22,6 12,13 2,6" />
    </svg>
  );
}

/**
 * Calendar icon
 */
function CalendarIcon({ size = 16 }: { size?: number }) {
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
      <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
      <line x1="16" y1="2" x2="16" y2="6" />
      <line x1="8" y1="2" x2="8" y2="6" />
      <line x1="3" y1="10" x2="21" y2="10" />
    </svg>
  );
}

/**
 * Camera icon
 */
function CameraIcon({ size = 16 }: { size?: number }) {
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
      <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
      <circle cx="12" cy="13" r="4" />
    </svg>
  );
}

/**
 * Add icon
 */
function AddIcon({ size = 16 }: { size?: number }) {
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
      <line x1="12" y1="5" x2="12" y2="19" />
      <line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  );
}

/**
 * Chevron icon for expandable sections
 */
function ChevronIcon({ size = 16, expanded = false }: { size?: number; expanded?: boolean }) {
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
      className={`customer-detail-chevron ${expanded ? 'customer-detail-chevron--expanded' : ''}`}
      aria-hidden="true"
    >
      <polyline points="6 9 12 15 18 9" />
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
      className="customer-detail-spinner"
      aria-hidden="true"
    >
      <path d="M21 12a9 9 0 1 1-6.219-8.56" />
    </svg>
  );
}

/**
 * Person icon for avatar
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
      aria-hidden="true"
    >
      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
      <circle cx="12" cy="7" r="4" />
    </svg>
  );
}

/**
 * Get initials from name
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
 * Format date for display
 */
function formatDate(timestamp: number): string {
  return new Date(timestamp).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

/**
 * Format relative time
 */
function formatRelativeTime(timestamp: number): string {
  const now = Date.now();
  const diff = now - timestamp;
  const days = Math.floor(diff / (1000 * 60 * 60 * 24));

  if (days === 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days < 7) return `${days} days ago`;
  if (days < 30) return `${Math.floor(days / 7)} weeks ago`;
  if (days < 365) return `${Math.floor(days / 30)} months ago`;
  return `${Math.floor(days / 365)} years ago`;
}

/**
 * Format currency
 */
function formatCurrency(amount: number, currency: string = 'CZK'): string {
  return new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency,
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount / 100);
}

/**
 * Customer avatar component
 */
function CustomerAvatar({ name, size = 'large' }: { name: string; size?: 'large' | 'medium' }) {
  const initials = useMemo(() => getInitials(name), [name]);
  const sizeClass = size === 'large' ? 'customer-detail-avatar--large' : 'customer-detail-avatar--medium';

  return (
    <div className={`customer-detail-avatar ${sizeClass}`} aria-hidden="true">
      {initials !== '?' ? (
        <span className="customer-detail-avatar-initials">{initials}</span>
      ) : (
        <PersonIcon size={size === 'large' ? 48 : 24} />
      )}
    </div>
  );
}

/**
 * Contact link component
 */
function ContactLink({
  type,
  value,
}: {
  type: 'phone' | 'email';
  value: string;
}) {
  const href = type === 'phone' ? `tel:${value}` : `mailto:${value}`;
  const Icon = type === 'phone' ? PhoneIcon : EmailIcon;

  return (
    <a
      href={href}
      className={`customer-detail-contact customer-detail-contact--${type}`}
    >
      <Icon size={16} />
      <span>{value}</span>
    </a>
  );
}

/**
 * Section header with optional expand/collapse
 */
function SectionHeader({
  title,
  count,
  expanded,
  onToggle,
  action,
}: {
  title: string;
  count?: number;
  expanded?: boolean;
  onToggle?: () => void;
  action?: React.ReactNode;
}) {
  const isExpandable = onToggle !== undefined;

  return (
    <div className="customer-detail-section-header">
      {isExpandable ? (
        <button
          type="button"
          className="customer-detail-section-toggle"
          onClick={onToggle}
          aria-expanded={expanded}
        >
          <h3 className="customer-detail-section-title">
            {title}
            {count !== undefined && (
              <span className="customer-detail-section-count">({count})</span>
            )}
          </h3>
          <ChevronIcon expanded={expanded} />
        </button>
      ) : (
        <h3 className="customer-detail-section-title">
          {title}
          {count !== undefined && (
            <span className="customer-detail-section-count">({count})</span>
          )}
        </h3>
      )}
      {action && <div className="customer-detail-section-action">{action}</div>}
    </div>
  );
}

/**
 * Visit list item
 */
function VisitItem({
  visit,
  onClick,
}: {
  visit: VisitDocument;
  onClick?: () => void;
}) {
  const services = visit.enc?.services || [];
  const price = visit.enc?.price;
  const currency = visit.enc?.currency || 'CZK';
  const visitDate = visit.visitDate;

  return (
    <button
      type="button"
      className="customer-detail-visit-item"
      onClick={onClick}
    >
      <div className="customer-detail-visit-date">
        <CalendarIcon size={14} />
        <span>{formatDate(visitDate)}</span>
        <span className="customer-detail-visit-relative">
          {formatRelativeTime(visitDate)}
        </span>
      </div>
      <div className="customer-detail-visit-services">
        {services.join(', ') || 'No services recorded'}
      </div>
      {price !== undefined && (
        <div className="customer-detail-visit-price">
          {formatCurrency(price, currency)}
        </div>
      )}
    </button>
  );
}

/**
 * Photo thumbnail
 */
function PhotoThumbnail({
  photo,
  onClick,
}: {
  photo: PhotoMetaDocument;
  onClick?: () => void;
}) {
  // In a real app, you'd load the encrypted thumbnail here
  // For now, show a placeholder
  return (
    <button
      type="button"
      className="customer-detail-photo-thumbnail"
      onClick={onClick}
      aria-label={photo.enc?.caption || 'View photo'}
    >
      <div className="customer-detail-photo-placeholder">
        <CameraIcon size={24} />
      </div>
      {photo.uploadStatus !== 'uploaded' && (
        <div className="customer-detail-photo-status">
          {photo.uploadStatus === 'uploading' ? (
            <LoadingSpinner size={16} />
          ) : photo.uploadStatus === 'pending' ? (
            <span>Pending</span>
          ) : (
            <span>Failed</span>
          )}
        </div>
      )}
    </button>
  );
}

/**
 * Tag/chip component for allergies, products, etc.
 */
function Tag({ children, variant = 'default' }: { children: React.ReactNode; variant?: 'default' | 'warning' }) {
  return (
    <span className={`customer-detail-tag customer-detail-tag--${variant}`}>
      {children}
    </span>
  );
}

/**
 * Empty state for sections
 */
function SectionEmpty({
  message,
  actionLabel,
  onAction,
}: {
  message: string;
  actionLabel?: string;
  onAction?: () => void;
}) {
  return (
    <div className="customer-detail-section-empty">
      <p>{message}</p>
      {actionLabel && onAction && (
        <button
          type="button"
          className="customer-detail-section-empty-action"
          onClick={onAction}
        >
          <AddIcon size={14} />
          <span>{actionLabel}</span>
        </button>
      )}
    </div>
  );
}

/**
 * Loading skeleton for customer detail
 */
function CustomerDetailSkeleton() {
  return (
    <div className="customer-detail-skeleton" aria-busy="true" aria-label="Loading customer">
      <div className="customer-detail-skeleton-header">
        <div className="customer-detail-skeleton-avatar" />
        <div className="customer-detail-skeleton-info">
          <div className="customer-detail-skeleton-name" />
          <div className="customer-detail-skeleton-contact" />
        </div>
      </div>
      <div className="customer-detail-skeleton-section">
        <div className="customer-detail-skeleton-section-title" />
        <div className="customer-detail-skeleton-section-content" />
      </div>
      <div className="customer-detail-skeleton-section">
        <div className="customer-detail-skeleton-section-title" />
        <div className="customer-detail-skeleton-section-content" />
      </div>
    </div>
  );
}

/**
 * Not found state
 */
function CustomerNotFound({ onBack }: { onBack?: () => void }) {
  return (
    <div className="customer-detail-not-found" role="alert">
      <PersonIcon size={64} />
      <h2>Customer Not Found</h2>
      <p>This customer may have been deleted or doesn't exist.</p>
      {onBack && (
        <button
          type="button"
          className="customer-detail-not-found-button"
          onClick={onBack}
        >
          <BackIcon size={16} />
          <span>Go Back</span>
        </button>
      )}
    </div>
  );
}

/**
 * Delete confirmation dialog
 */
function DeleteConfirmDialog({
  customerName,
  onConfirm,
  onCancel,
}: {
  customerName: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="customer-detail-dialog-overlay" role="dialog" aria-modal="true">
      <div className="customer-detail-dialog">
        <h3 className="customer-detail-dialog-title">Delete Customer</h3>
        <p className="customer-detail-dialog-message">
          Are you sure you want to delete <strong>{customerName}</strong>? This action cannot be undone.
        </p>
        <div className="customer-detail-dialog-actions">
          <button
            type="button"
            className="customer-detail-dialog-button customer-detail-dialog-button--cancel"
            onClick={onCancel}
          >
            Cancel
          </button>
          <button
            type="button"
            className="customer-detail-dialog-button customer-detail-dialog-button--danger"
            onClick={onConfirm}
          >
            Delete
          </button>
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// Main Component
// ============================================================================

/**
 * Customer detail component showing comprehensive customer information.
 */
export function CustomerDetail({
  customerId,
  onBack,
  onEdit,
  onDelete,
  onVisitClick,
  onAddVisit,
  onPhotoClick,
  onAddPhoto,
  allowInlineEdit = false,
  maxRecentVisits = 5,
  maxPhotoPreview = 6,
  className = '',
}: CustomerDetailProps) {
  // ========================================================================
  // State
  // ========================================================================

  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [visitsExpanded, setVisitsExpanded] = useState(true);
  const [photosExpanded, setPhotosExpanded] = useState(true);
  const [notesExpanded, setNotesExpanded] = useState(true);
  const [isDeleting, setIsDeleting] = useState(false);

  // ========================================================================
  // Data Fetching
  // ========================================================================

  const { data: customer, loading, error, exists } = useCustomer(customerId);
  const { data: visitCount } = useCustomerVisitCount(customerId);
  const { data: photoCount } = useCustomerPhotoCount(customerId);
  const { data: recentVisits } = useVisits({
    customerId,
    limit: maxRecentVisits,
    sortBy: 'visitDate',
    sortDirection: 'desc',
  });
  const { data: photos } = usePhotos({
    customerId,
    variant: 'thumbnail',
    uploadStatus: undefined, // Show all statuses
    limit: maxPhotoPreview,
  });

  // ========================================================================
  // Derived Data
  // ========================================================================

  const enc = customer?.enc;
  const name = enc?.name || 'Unknown';
  const phone = enc?.phone;
  const email = enc?.email;
  const notes = enc?.notes;
  const scalpNotes = enc?.scalpNotes;
  const allergies = enc?.allergies || [];
  const preferredProducts = enc?.preferredProducts || [];
  const preferredStylist = enc?.preferredStylist;
  const dateOfBirth = enc?.dateOfBirth;
  const createdAt = customer?.createdAt;
  const updatedAt = customer?.updatedAt;

  const hasContactInfo = phone || email;
  const hasNotes = notes || scalpNotes;
  const hasPreferences = allergies.length > 0 || preferredProducts.length > 0 || preferredStylist;

  // ========================================================================
  // Handlers
  // ========================================================================

  const handleDelete = useCallback(async () => {
    if (!customer) return;

    setIsDeleting(true);
    try {
      const db = getDatabase();
      if (db) {
        const collection = getCustomersCollection(db);
        // Soft delete by setting deleted = true
        await customer.update({
          $set: {
            deleted: true,
            updatedAt: Date.now(),
          },
        });
      }
      setShowDeleteConfirm(false);
      onDelete?.(customerId);
    } catch (err) {
      // Handle error
      setIsDeleting(false);
    }
  }, [customer, customerId, onDelete]);

  const handleEditClick = useCallback(() => {
    onEdit?.(customerId);
  }, [customerId, onEdit]);

  const handleAddVisitClick = useCallback(() => {
    onAddVisit?.(customerId);
  }, [customerId, onAddVisit]);

  const handleAddPhotoClick = useCallback(() => {
    onAddPhoto?.(customerId);
  }, [customerId, onAddPhoto]);

  // ========================================================================
  // Render
  // ========================================================================

  const containerClasses = [
    'customer-detail',
    loading ? 'customer-detail--loading' : '',
    error ? 'customer-detail--error' : '',
    className,
  ]
    .filter(Boolean)
    .join(' ');

  // Loading state
  if (loading) {
    return (
      <div className={containerClasses}>
        <CustomerDetailSkeleton />
      </div>
    );
  }

  // Error state
  if (error) {
    return (
      <div className={containerClasses}>
        <div className="customer-detail-error" role="alert">
          <p>Failed to load customer: {error.message}</p>
          {onBack && (
            <button type="button" onClick={onBack}>
              Go Back
            </button>
          )}
        </div>
      </div>
    );
  }

  // Not found state
  if (!exists || !customer) {
    return (
      <div className={containerClasses}>
        <CustomerNotFound onBack={onBack} />
      </div>
    );
  }

  return (
    <div className={containerClasses}>
      {/* Delete confirmation dialog */}
      {showDeleteConfirm && (
        <DeleteConfirmDialog
          customerName={name}
          onConfirm={handleDelete}
          onCancel={() => setShowDeleteConfirm(false)}
        />
      )}

      {/* Header */}
      <header className="customer-detail-header">
        {onBack && (
          <button
            type="button"
            className="customer-detail-back-button"
            onClick={onBack}
            aria-label="Go back"
          >
            <BackIcon />
          </button>
        )}

        <div className="customer-detail-header-content">
          <CustomerAvatar name={name} size="large" />
          <div className="customer-detail-header-info">
            <h1 className="customer-detail-name">{name}</h1>
            {hasContactInfo && (
              <div className="customer-detail-contacts">
                {phone && <ContactLink type="phone" value={phone} />}
                {email && <ContactLink type="email" value={email} />}
              </div>
            )}
            <div className="customer-detail-stats">
              <span className="customer-detail-stat">
                <CalendarIcon size={14} />
                {visitCount} visit{visitCount === 1 ? '' : 's'}
              </span>
              <span className="customer-detail-stat">
                <CameraIcon size={14} />
                {photoCount} photo{photoCount === 1 ? '' : 's'}
              </span>
            </div>
          </div>
        </div>

        <div className="customer-detail-actions">
          {onEdit && (
            <button
              type="button"
              className="customer-detail-action-button"
              onClick={handleEditClick}
              aria-label="Edit customer"
            >
              <EditIcon />
              <span>Edit</span>
            </button>
          )}
          {onDelete && (
            <button
              type="button"
              className="customer-detail-action-button customer-detail-action-button--danger"
              onClick={() => setShowDeleteConfirm(true)}
              disabled={isDeleting}
              aria-label="Delete customer"
            >
              <DeleteIcon />
              <span>Delete</span>
            </button>
          )}
        </div>
      </header>

      {/* Content */}
      <div className="customer-detail-content">
        {/* Quick Info */}
        {(dateOfBirth || preferredStylist || createdAt) && (
          <section className="customer-detail-section customer-detail-section--info">
            <dl className="customer-detail-info-list">
              {dateOfBirth && (
                <>
                  <dt>Date of Birth</dt>
                  <dd>{dateOfBirth}</dd>
                </>
              )}
              {preferredStylist && (
                <>
                  <dt>Preferred Stylist</dt>
                  <dd>{preferredStylist}</dd>
                </>
              )}
              {createdAt && (
                <>
                  <dt>Customer Since</dt>
                  <dd>{formatDate(createdAt)}</dd>
                </>
              )}
            </dl>
          </section>
        )}

        {/* Allergies Warning */}
        {allergies.length > 0 && (
          <section className="customer-detail-section customer-detail-section--allergies">
            <h3 className="customer-detail-section-title customer-detail-section-title--warning">
              Allergies & Sensitivities
            </h3>
            <div className="customer-detail-tags">
              {allergies.map((allergy, index) => (
                <Tag key={index} variant="warning">
                  {allergy}
                </Tag>
              ))}
            </div>
          </section>
        )}

        {/* Preferred Products */}
        {preferredProducts.length > 0 && (
          <section className="customer-detail-section">
            <h3 className="customer-detail-section-title">Preferred Products</h3>
            <div className="customer-detail-tags">
              {preferredProducts.map((product, index) => (
                <Tag key={index}>{product}</Tag>
              ))}
            </div>
          </section>
        )}

        {/* Visits Section */}
        <section className="customer-detail-section">
          <SectionHeader
            title="Visit History"
            count={visitCount}
            expanded={visitsExpanded}
            onToggle={() => setVisitsExpanded(!visitsExpanded)}
            action={
              onAddVisit ? (
                <button
                  type="button"
                  className="customer-detail-add-button"
                  onClick={handleAddVisitClick}
                  aria-label="Add visit"
                >
                  <AddIcon size={14} />
                  <span>Add Visit</span>
                </button>
              ) : undefined
            }
          />
          {visitsExpanded && (
            <div className="customer-detail-visits">
              {recentVisits.length === 0 ? (
                <SectionEmpty
                  message="No visits recorded yet"
                  actionLabel={onAddVisit ? 'Record First Visit' : undefined}
                  onAction={onAddVisit ? handleAddVisitClick : undefined}
                />
              ) : (
                <>
                  {recentVisits.map((visit) => (
                    <VisitItem
                      key={visit.id}
                      visit={visit}
                      onClick={() => onVisitClick?.(visit.id)}
                    />
                  ))}
                  {visitCount > maxRecentVisits && (
                    <button
                      type="button"
                      className="customer-detail-view-all"
                      onClick={() => {
                        /* Navigate to full visit history */
                      }}
                    >
                      View all {visitCount} visits
                    </button>
                  )}
                </>
              )}
            </div>
          )}
        </section>

        {/* Photos Section */}
        <section className="customer-detail-section">
          <SectionHeader
            title="Photos"
            count={photoCount}
            expanded={photosExpanded}
            onToggle={() => setPhotosExpanded(!photosExpanded)}
            action={
              onAddPhoto ? (
                <button
                  type="button"
                  className="customer-detail-add-button"
                  onClick={handleAddPhotoClick}
                  aria-label="Add photo"
                >
                  <CameraIcon size={14} />
                  <span>Add Photo</span>
                </button>
              ) : undefined
            }
          />
          {photosExpanded && (
            <div className="customer-detail-photos">
              {photos.length === 0 ? (
                <SectionEmpty
                  message="No photos yet"
                  actionLabel={onAddPhoto ? 'Take First Photo' : undefined}
                  onAction={onAddPhoto ? handleAddPhotoClick : undefined}
                />
              ) : (
                <>
                  <div className="customer-detail-photo-grid">
                    {photos.map((photo) => (
                      <PhotoThumbnail
                        key={photo.id}
                        photo={photo}
                        onClick={() => onPhotoClick?.(photo.id)}
                      />
                    ))}
                  </div>
                  {photoCount > maxPhotoPreview && (
                    <button
                      type="button"
                      className="customer-detail-view-all"
                      onClick={() => {
                        /* Navigate to full photo gallery */
                      }}
                    >
                      View all {photoCount} photos
                    </button>
                  )}
                </>
              )}
            </div>
          )}
        </section>

        {/* Notes Section */}
        {hasNotes && (
          <section className="customer-detail-section">
            <SectionHeader
              title="Notes"
              expanded={notesExpanded}
              onToggle={() => setNotesExpanded(!notesExpanded)}
            />
            {notesExpanded && (
              <div className="customer-detail-notes">
                {notes && (
                  <div className="customer-detail-note">
                    <h4 className="customer-detail-note-title">General Notes</h4>
                    <p className="customer-detail-note-content">{notes}</p>
                  </div>
                )}
                {scalpNotes && (
                  <div className="customer-detail-note">
                    <h4 className="customer-detail-note-title">Scalp/Hair Notes</h4>
                    <p className="customer-detail-note-content">{scalpNotes}</p>
                  </div>
                )}
              </div>
            )}
          </section>
        )}
      </div>

      {/* Footer with metadata */}
      <footer className="customer-detail-footer">
        <span className="customer-detail-meta">
          Last updated: {updatedAt ? formatRelativeTime(updatedAt) : 'Unknown'}
        </span>
      </footer>
    </div>
  );
}

// ============================================================================
// Convenience Components
// ============================================================================

/**
 * Compact customer card for use in lists or grids.
 * Shows key info at a glance.
 */
export function CustomerCard({
  customerId,
  onClick,
  className = '',
}: {
  customerId: string;
  onClick?: () => void;
  className?: string;
}) {
  const { data: customer, loading, exists } = useCustomer(customerId);
  const { data: visitCount } = useCustomerVisitCount(customerId);

  if (loading) {
    return (
      <div className={`customer-card customer-card--loading ${className}`}>
        <LoadingSpinner size={24} />
      </div>
    );
  }

  if (!exists || !customer) {
    return null;
  }

  const name = customer.enc?.name || 'Unknown';
  const phone = customer.enc?.phone;

  return (
    <button
      type="button"
      className={`customer-card ${className}`}
      onClick={onClick}
    >
      <CustomerAvatar name={name} size="medium" />
      <div className="customer-card-info">
        <span className="customer-card-name">{name}</span>
        {phone && <span className="customer-card-phone">{phone}</span>}
        <span className="customer-card-visits">
          {visitCount} visit{visitCount === 1 ? '' : 's'}
        </span>
      </div>
    </button>
  );
}

/**
 * Customer preview for hover cards or quick views.
 */
export function CustomerPreview({
  customerId,
  className = '',
}: {
  customerId: string;
  className?: string;
}) {
  const { data: customer, loading, exists } = useCustomer(customerId);
  const { data: visitCount } = useCustomerVisitCount(customerId);
  const { data: latestVisit } = useVisits({
    customerId,
    limit: 1,
    sortBy: 'visitDate',
    sortDirection: 'desc',
  });

  if (loading) {
    return (
      <div className={`customer-preview customer-preview--loading ${className}`}>
        <LoadingSpinner size={20} />
      </div>
    );
  }

  if (!exists || !customer) {
    return (
      <div className={`customer-preview customer-preview--not-found ${className}`}>
        <span>Customer not found</span>
      </div>
    );
  }

  const name = customer.enc?.name || 'Unknown';
  const phone = customer.enc?.phone;
  const lastVisit = latestVisit[0];

  return (
    <div className={`customer-preview ${className}`}>
      <CustomerAvatar name={name} size="medium" />
      <div className="customer-preview-info">
        <span className="customer-preview-name">{name}</span>
        {phone && <span className="customer-preview-phone">{phone}</span>}
        <div className="customer-preview-stats">
          <span>{visitCount} visits</span>
          {lastVisit && (
            <span>Last: {formatRelativeTime(lastVisit.visitDate)}</span>
          )}
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// Exports
// ============================================================================

export default CustomerDetail;
