/**
 * Customer Form Component
 *
 * A form for creating and editing customer records.
 * Works fully offline - saves to RxDB local storage with encryption.
 * Data syncs automatically when device comes back online.
 *
 * @module components/CustomerForm
 *
 * @example
 * ```tsx
 * import { CustomerForm } from '@/components/CustomerForm';
 *
 * function AddCustomerPage() {
 *   return (
 *     <CustomerForm
 *       onSave={(customer) => navigate(`/customers/${customer.id}`)}
 *       onCancel={() => navigate('/customers')}
 *     />
 *   );
 * }
 * ```
 */

import React, {
  useState,
  useCallback,
  type FormEvent,
  type ChangeEvent,
} from 'react';
import { getDatabase } from '../db/index';
import {
  createCustomerDocument,
  sanitizeCustomerInput,
  getCustomersCollection,
  type CreateCustomerInput,
  type CustomerDocument,
} from '../db/schemas';

// ============================================================================
// Types
// ============================================================================

/**
 * Props for CustomerForm component
 */
export interface CustomerFormProps {
  /** Existing customer to edit (null for new customer) */
  customer?: CustomerDocument | null;
  /** Callback when customer is saved successfully */
  onSave?: (customer: CustomerDocument) => void;
  /** Callback when form is cancelled */
  onCancel?: () => void;
  /** Whether the form is in a modal (affects styling) */
  isModal?: boolean;
  /** Custom class name */
  className?: string;
}

/**
 * Form state for customer data
 */
interface CustomerFormState {
  name: string;
  phone: string;
  email: string;
  notes: string;
  scalpNotes: string;
  allergies: string;
  preferredProducts: string;
  dateOfBirth: string;
  preferredStylist: string;
}

/**
 * Form submission state
 */
interface FormSubmitState {
  isSubmitting: boolean;
  error: string | null;
  success: boolean;
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Convert comma-separated string to array
 */
function stringToArray(str: string): string[] {
  return str
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/**
 * Convert array to comma-separated string
 */
function arrayToString(arr: string[] | undefined): string {
  return arr?.join(', ') || '';
}

/**
 * Initialize form state from customer document
 */
function initFormState(customer?: CustomerDocument | null): CustomerFormState {
  if (!customer) {
    return {
      name: '',
      phone: '',
      email: '',
      notes: '',
      scalpNotes: '',
      allergies: '',
      preferredProducts: '',
      dateOfBirth: '',
      preferredStylist: '',
    };
  }

  return {
    name: customer.enc?.name || '',
    phone: customer.enc?.phone || '',
    email: customer.enc?.email || '',
    notes: customer.enc?.notes || '',
    scalpNotes: customer.enc?.scalpNotes || '',
    allergies: arrayToString(customer.enc?.allergies),
    preferredProducts: arrayToString(customer.enc?.preferredProducts),
    dateOfBirth: customer.enc?.dateOfBirth || '',
    preferredStylist: customer.enc?.preferredStylist || '',
  };
}

// ============================================================================
// Icon Components
// ============================================================================

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

function SaveIcon({ size = 20 }: { size?: number }) {
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
      <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" />
      <polyline points="17 21 17 13 7 13 7 21" />
      <polyline points="7 3 7 8 15 8" />
    </svg>
  );
}

function XIcon({ size = 20 }: { size?: number }) {
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
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );
}

function LoadingSpinner({ size = 20 }: { size?: number }) {
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
      className="customer-form-spinner"
      aria-hidden="true"
    >
      <path d="M21 12a9 9 0 1 1-6.219-8.56" />
    </svg>
  );
}

function CheckIcon({ size = 20 }: { size?: number }) {
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
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}

function AlertIcon({ size = 20 }: { size?: number }) {
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
      <circle cx="12" cy="12" r="10" />
      <line x1="12" y1="8" x2="12" y2="12" />
      <line x1="12" y1="16" x2="12.01" y2="16" />
    </svg>
  );
}

// ============================================================================
// Main Component
// ============================================================================

/**
 * Customer form component for creating and editing customers.
 *
 * Features:
 * - Works fully offline (saves to RxDB)
 * - Automatic encryption of sensitive data
 * - Form validation
 * - Loading and error states
 * - Accessible form controls
 */
export function CustomerForm({
  customer,
  onSave,
  onCancel,
  isModal = false,
  className = '',
}: CustomerFormProps) {
  // ========================================================================
  // State
  // ========================================================================

  const [formState, setFormState] = useState<CustomerFormState>(() =>
    initFormState(customer)
  );

  const [submitState, setSubmitState] = useState<FormSubmitState>({
    isSubmitting: false,
    error: null,
    success: false,
  });

  const isEditing = !!customer;

  // ========================================================================
  // Handlers
  // ========================================================================

  const handleChange = useCallback(
    (e: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      const { name, value } = e.target;
      setFormState((prev) => ({ ...prev, [name]: value }));
      // Clear error on change
      if (submitState.error) {
        setSubmitState((prev) => ({ ...prev, error: null }));
      }
    },
    [submitState.error]
  );

  const handleSubmit = useCallback(
    async (e: FormEvent) => {
      e.preventDefault();

      // Validate required fields
      if (!formState.name.trim()) {
        setSubmitState({
          isSubmitting: false,
          error: 'Customer name is required',
          success: false,
        });
        return;
      }

      setSubmitState({ isSubmitting: true, error: null, success: false });

      try {
        // Get database
        const db = getDatabase();
        if (!db) {
          throw new Error('Database not initialized');
        }

        const collection = getCustomersCollection(db);

        // Prepare input
        const input: CreateCustomerInput = sanitizeCustomerInput({
          name: formState.name,
          phone: formState.phone || undefined,
          email: formState.email || undefined,
          notes: formState.notes || undefined,
          scalpNotes: formState.scalpNotes || undefined,
          allergies: stringToArray(formState.allergies),
          preferredProducts: stringToArray(formState.preferredProducts),
          dateOfBirth: formState.dateOfBirth || undefined,
          preferredStylist: formState.preferredStylist || undefined,
        });

        let savedCustomer: CustomerDocument;

        if (isEditing && customer) {
          // Update existing customer
          const updatedDoc = await customer.update({
            $set: {
              enc: {
                ...customer.enc,
                ...input,
              },
              updatedAt: Date.now(),
            },
          });
          savedCustomer = updatedDoc;
        } else {
          // Create new customer document
          const customerDoc = createCustomerDocument(input);
          savedCustomer = await collection.insert(customerDoc);
        }

        setSubmitState({ isSubmitting: false, error: null, success: true });

        // Call onSave callback
        onSave?.(savedCustomer);
      } catch (error) {
        setSubmitState({
          isSubmitting: false,
          error: error instanceof Error ? error.message : 'Failed to save customer',
          success: false,
        });
      }
    },
    [formState, isEditing, customer, onSave]
  );

  // ========================================================================
  // Render
  // ========================================================================

  const containerClasses = [
    'customer-form',
    isModal ? 'customer-form--modal' : '',
    className,
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <form className={containerClasses} onSubmit={handleSubmit}>
      {/* Header */}
      <div className="customer-form-header">
        <div className="customer-form-header-icon">
          <PersonIcon size={32} />
        </div>
        <h2 className="customer-form-title">
          {isEditing ? 'Edit Customer' : 'New Customer'}
        </h2>
        {isModal && onCancel && (
          <button
            type="button"
            className="customer-form-close"
            onClick={onCancel}
            aria-label="Close form"
          >
            <XIcon size={24} />
          </button>
        )}
      </div>

      {/* Error Message */}
      {submitState.error && (
        <div className="customer-form-error" role="alert">
          <AlertIcon size={18} />
          <span>{submitState.error}</span>
        </div>
      )}

      {/* Success Message */}
      {submitState.success && (
        <div className="customer-form-success" role="status">
          <CheckIcon size={18} />
          <span>Customer saved successfully!</span>
        </div>
      )}

      {/* Form Fields */}
      <div className="customer-form-fields">
        {/* Name (Required) */}
        <div className="customer-form-field">
          <label htmlFor="customer-name" className="customer-form-label">
            Name <span className="customer-form-required">*</span>
          </label>
          <input
            type="text"
            id="customer-name"
            name="name"
            className="customer-form-input"
            value={formState.name}
            onChange={handleChange}
            placeholder="Enter customer name"
            required
            autoFocus
            disabled={submitState.isSubmitting}
          />
        </div>

        {/* Phone */}
        <div className="customer-form-field">
          <label htmlFor="customer-phone" className="customer-form-label">
            Phone
          </label>
          <input
            type="tel"
            id="customer-phone"
            name="phone"
            className="customer-form-input"
            value={formState.phone}
            onChange={handleChange}
            placeholder="Enter phone number"
            disabled={submitState.isSubmitting}
          />
        </div>

        {/* Email */}
        <div className="customer-form-field">
          <label htmlFor="customer-email" className="customer-form-label">
            Email
          </label>
          <input
            type="email"
            id="customer-email"
            name="email"
            className="customer-form-input"
            value={formState.email}
            onChange={handleChange}
            placeholder="Enter email address"
            disabled={submitState.isSubmitting}
          />
        </div>

        {/* Date of Birth */}
        <div className="customer-form-field">
          <label htmlFor="customer-dob" className="customer-form-label">
            Date of Birth
          </label>
          <input
            type="date"
            id="customer-dob"
            name="dateOfBirth"
            className="customer-form-input"
            value={formState.dateOfBirth}
            onChange={handleChange}
            disabled={submitState.isSubmitting}
          />
        </div>

        {/* Preferred Stylist */}
        <div className="customer-form-field">
          <label htmlFor="customer-stylist" className="customer-form-label">
            Preferred Stylist
          </label>
          <input
            type="text"
            id="customer-stylist"
            name="preferredStylist"
            className="customer-form-input"
            value={formState.preferredStylist}
            onChange={handleChange}
            placeholder="Enter preferred stylist"
            disabled={submitState.isSubmitting}
          />
        </div>

        {/* Allergies */}
        <div className="customer-form-field">
          <label htmlFor="customer-allergies" className="customer-form-label">
            Allergies
          </label>
          <input
            type="text"
            id="customer-allergies"
            name="allergies"
            className="customer-form-input"
            value={formState.allergies}
            onChange={handleChange}
            placeholder="Comma-separated (e.g., latex, bleach)"
            disabled={submitState.isSubmitting}
          />
          <span className="customer-form-hint">
            Separate multiple allergies with commas
          </span>
        </div>

        {/* Preferred Products */}
        <div className="customer-form-field">
          <label htmlFor="customer-products" className="customer-form-label">
            Preferred Products
          </label>
          <input
            type="text"
            id="customer-products"
            name="preferredProducts"
            className="customer-form-input"
            value={formState.preferredProducts}
            onChange={handleChange}
            placeholder="Comma-separated products"
            disabled={submitState.isSubmitting}
          />
          <span className="customer-form-hint">
            Separate multiple products with commas
          </span>
        </div>

        {/* Notes */}
        <div className="customer-form-field">
          <label htmlFor="customer-notes" className="customer-form-label">
            Notes
          </label>
          <textarea
            id="customer-notes"
            name="notes"
            className="customer-form-textarea"
            value={formState.notes}
            onChange={handleChange}
            placeholder="General notes about the customer"
            rows={3}
            disabled={submitState.isSubmitting}
          />
        </div>

        {/* Scalp Notes */}
        <div className="customer-form-field">
          <label htmlFor="customer-scalp-notes" className="customer-form-label">
            Scalp/Hair Notes
          </label>
          <textarea
            id="customer-scalp-notes"
            name="scalpNotes"
            className="customer-form-textarea"
            value={formState.scalpNotes}
            onChange={handleChange}
            placeholder="Scalp condition, hair type, treatment history..."
            rows={3}
            disabled={submitState.isSubmitting}
          />
        </div>
      </div>

      {/* Actions */}
      <div className="customer-form-actions">
        {onCancel && (
          <button
            type="button"
            className="customer-form-button customer-form-button--secondary"
            onClick={onCancel}
            disabled={submitState.isSubmitting}
          >
            Cancel
          </button>
        )}
        <button
          type="submit"
          className="customer-form-button customer-form-button--primary"
          disabled={submitState.isSubmitting || !formState.name.trim()}
        >
          {submitState.isSubmitting ? (
            <>
              <LoadingSpinner size={18} />
              <span>Saving...</span>
            </>
          ) : (
            <>
              <SaveIcon size={18} />
              <span>{isEditing ? 'Update Customer' : 'Add Customer'}</span>
            </>
          )}
        </button>
      </div>
    </form>
  );
}

// ============================================================================
// Convenience Components
// ============================================================================

/**
 * Modal wrapper for CustomerForm
 */
export function CustomerFormModal({
  isOpen,
  onClose,
  customer,
  onSave,
}: {
  isOpen: boolean;
  onClose: () => void;
  customer?: CustomerDocument | null;
  onSave?: (customer: CustomerDocument) => void;
}) {
  if (!isOpen) {
    return null;
  }

  const handleSave = (savedCustomer: CustomerDocument) => {
    onSave?.(savedCustomer);
    onClose();
  };

  return (
    <div className="customer-form-modal-overlay" onClick={onClose}>
      <div
        className="customer-form-modal-content"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="customer-form-title"
      >
        <CustomerForm
          customer={customer}
          onSave={handleSave}
          onCancel={onClose}
          isModal
        />
      </div>
    </div>
  );
}

// ============================================================================
// Exports
// ============================================================================

export default CustomerForm;
