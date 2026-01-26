// Reactive query hooks for React components
// Provides React hooks that subscribe to RxDB queries and return reactive results
// Reference: RxDB reactive queries documentation

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import type { RxQuery, RxDocument, MangoQuery } from 'rxdb';
import {
  getDatabase,
  getDatabaseState,
  DatabaseState,
} from './index';
import {
  getCustomersCollection,
  getVisitsCollection,
  getPhotosCollection,
  type CustomerDocType,
  type CustomerDocument,
  type CustomerCollection,
  type VisitDocType,
  type VisitDocument,
  type VisitCollection,
  type PhotoMetaDocType,
  type PhotoMetaDocument,
  type PhotoMetaCollection,
  type CollectionName,
  COLLECTION_NAMES,
} from './schemas';

// ============================================================================
// Types
// ============================================================================

/**
 * Result state for reactive query hooks
 */
export interface QueryResult<T> {
  /** The query result data */
  data: T;
  /** Whether the query is currently loading */
  loading: boolean;
  /** Error if the query failed */
  error: Error | null;
  /** Whether this is the initial load (no data yet) */
  isInitialLoad: boolean;
  /** Refresh the query manually */
  refresh: () => void;
}

/**
 * Result state for single document hooks
 */
export interface DocumentResult<T> {
  /** The document data (null if not found) */
  data: T | null;
  /** Whether the query is currently loading */
  loading: boolean;
  /** Error if the query failed */
  error: Error | null;
  /** Whether the document exists */
  exists: boolean;
  /** Refresh the query manually */
  refresh: () => void;
}

/**
 * Database connection state for React components
 */
export interface DatabaseHookResult {
  /** Whether the database is ready */
  isReady: boolean;
  /** Current database state */
  state: DatabaseState;
  /** Error if database failed to initialize */
  error: Error | null;
}

/**
 * Options for customer queries
 */
export interface CustomerQueryOptions {
  /** Include soft-deleted documents */
  includeDeleted?: boolean;
  /** Sort by field (defaults to updatedAt) */
  sortBy?: 'updatedAt' | 'createdAt';
  /** Sort direction (defaults to desc) */
  sortDirection?: 'asc' | 'desc';
  /** Maximum number of results */
  limit?: number;
  /** Number of results to skip */
  skip?: number;
}

/**
 * Options for visit queries
 */
export interface VisitQueryOptions {
  /** Filter by customer ID */
  customerId?: string;
  /** Include soft-deleted documents */
  includeDeleted?: boolean;
  /** Filter by date range (start) */
  dateFrom?: number;
  /** Filter by date range (end) */
  dateTo?: number;
  /** Sort by field (defaults to visitDate) */
  sortBy?: 'visitDate' | 'updatedAt' | 'createdAt';
  /** Sort direction (defaults to desc) */
  sortDirection?: 'asc' | 'desc';
  /** Maximum number of results */
  limit?: number;
  /** Number of results to skip */
  skip?: number;
}

/**
 * Options for photo queries
 */
export interface PhotoQueryOptions {
  /** Filter by customer ID */
  customerId?: string;
  /** Filter by visit ID */
  visitId?: string;
  /** Filter by upload status */
  uploadStatus?: 'pending' | 'uploading' | 'uploaded' | 'failed';
  /** Filter by variant */
  variant?: 'original' | 'thumbnail' | 'preview';
  /** Include soft-deleted documents */
  includeDeleted?: boolean;
  /** Sort by field (defaults to capturedAt) */
  sortBy?: 'capturedAt' | 'updatedAt' | 'createdAt';
  /** Sort direction (defaults to desc) */
  sortDirection?: 'asc' | 'desc';
  /** Maximum number of results */
  limit?: number;
  /** Number of results to skip */
  skip?: number;
}

// ============================================================================
// Database State Hook
// ============================================================================

/**
 * Hook to get the current database connection state.
 * Polls the database state periodically to detect changes.
 *
 * @returns Database state information
 *
 * @example
 * ```tsx
 * function App() {
 *   const { isReady, state, error } = useDatabaseState();
 *
 *   if (!isReady) {
 *     return <div>Loading database...</div>;
 *   }
 *
 *   if (error) {
 *     return <div>Database error: {error.message}</div>;
 *   }
 *
 *   return <CustomerList />;
 * }
 * ```
 */
export function useDatabaseState(): DatabaseHookResult {
  const [state, setState] = useState<DatabaseState>(getDatabaseState());
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    // Check state immediately
    setState(getDatabaseState());

    // Poll for state changes (RxDB doesn't emit state change events)
    const interval = setInterval(() => {
      const currentState = getDatabaseState();
      setState(currentState);

      // Check if database is available
      const db = getDatabase();
      if (currentState === DatabaseState.Error && !db) {
        setError(new Error('Database initialization failed'));
      } else if (db) {
        setError(null);
      }
    }, 100);

    return () => clearInterval(interval);
  }, []);

  return {
    isReady: state === DatabaseState.Ready,
    state,
    error,
  };
}

// ============================================================================
// Generic Query Hook
// ============================================================================

/**
 * Generic hook for subscribing to RxDB queries.
 * Handles subscription lifecycle and returns reactive results.
 *
 * @param queryFactory - Function that creates the RxQuery
 * @param deps - Dependencies for the query factory
 * @returns Query result with data, loading, and error states
 *
 * @example
 * ```tsx
 * function MyComponent() {
 *   const db = requireDatabase();
 *   const { data, loading, error } = useRxQuery(
 *     () => db.customers.find().sort({ updatedAt: 'desc' }),
 *     [db]
 *   );
 *
 *   if (loading) return <Loading />;
 *   if (error) return <Error error={error} />;
 *   return <List items={data} />;
 * }
 * ```
 */
export function useRxQuery<T extends RxDocument<unknown>>(
  queryFactory: () => RxQuery<unknown, T[]> | null,
  deps: React.DependencyList
): QueryResult<T[]> {
  const [data, setData] = useState<T[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [isInitialLoad, setIsInitialLoad] = useState(true);
  const refreshRef = useRef(0);

  // Memoize the query factory result
  const query = useMemo(() => {
    try {
      return queryFactory();
    } catch (err) {
      setError(err instanceof Error ? err : new Error('Query creation failed'));
      return null;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, refreshRef.current]);

  useEffect(() => {
    if (!query) {
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);

    // Subscribe to the query
    const subscription = query.$.subscribe({
      next: (results) => {
        setData(results);
        setLoading(false);
        setIsInitialLoad(false);
      },
      error: (err) => {
        setError(err instanceof Error ? err : new Error('Query failed'));
        setLoading(false);
        setIsInitialLoad(false);
      },
    });

    return () => {
      subscription.unsubscribe();
    };
  }, [query]);

  const refresh = useCallback(() => {
    refreshRef.current += 1;
    setIsInitialLoad(true);
  }, []);

  return { data, loading, error, isInitialLoad, refresh };
}

/**
 * Hook for subscribing to a single document by ID.
 *
 * @param queryFactory - Function that creates the RxQuery for finding the document
 * @param deps - Dependencies for the query factory
 * @returns Document result with data, loading, and error states
 */
export function useRxDocument<T extends RxDocument<unknown>>(
  queryFactory: () => RxQuery<unknown, T | null> | null,
  deps: React.DependencyList
): DocumentResult<T> {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const refreshRef = useRef(0);

  // Memoize the query factory result
  const query = useMemo(() => {
    try {
      return queryFactory();
    } catch (err) {
      setError(err instanceof Error ? err : new Error('Query creation failed'));
      return null;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, refreshRef.current]);

  useEffect(() => {
    if (!query) {
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);

    // Subscribe to the query
    const subscription = query.$.subscribe({
      next: (result) => {
        setData(result);
        setLoading(false);
      },
      error: (err) => {
        setError(err instanceof Error ? err : new Error('Query failed'));
        setLoading(false);
      },
    });

    return () => {
      subscription.unsubscribe();
    };
  }, [query]);

  const refresh = useCallback(() => {
    refreshRef.current += 1;
  }, []);

  return {
    data,
    loading,
    error,
    exists: data !== null,
    refresh,
  };
}

// ============================================================================
// Customer Hooks
// ============================================================================

/**
 * Hook to get all customers with reactive updates.
 *
 * @param options - Query options for filtering and sorting
 * @returns Reactive customer list
 *
 * @example
 * ```tsx
 * function CustomerList() {
 *   const { data: customers, loading, error } = useCustomers({
 *     includeDeleted: false,
 *     sortBy: 'updatedAt',
 *     sortDirection: 'desc',
 *   });
 *
 *   if (loading) return <Spinner />;
 *   if (error) return <Alert>{error.message}</Alert>;
 *
 *   return (
 *     <ul>
 *       {customers.map(customer => (
 *         <li key={customer.id}>{customer.enc.name}</li>
 *       ))}
 *     </ul>
 *   );
 * }
 * ```
 */
export function useCustomers(
  options: CustomerQueryOptions = {}
): QueryResult<CustomerDocument[]> {
  const {
    includeDeleted = false,
    sortBy = 'updatedAt',
    sortDirection = 'desc',
    limit,
    skip,
  } = options;

  const db = getDatabase();

  return useRxQuery<CustomerDocument>(
    () => {
      if (!db) return null;

      try {
        const collection = getCustomersCollection(db);

        // Build query selector
        const selector: MangoQuery<CustomerDocType>['selector'] = {};
        if (!includeDeleted) {
          selector.deleted = { $eq: false };
        }

        // Build query
        let query = collection.find({ selector });

        // Apply sort
        const sortOrder = sortDirection === 'desc' ? 'desc' : 'asc';
        query = query.sort({ [sortBy]: sortOrder });

        // Apply pagination
        if (skip !== undefined) {
          query = query.skip(skip);
        }
        if (limit !== undefined) {
          query = query.limit(limit);
        }

        return query;
      } catch {
        return null;
      }
    },
    [db, includeDeleted, sortBy, sortDirection, limit, skip]
  );
}

/**
 * Hook to get a single customer by ID with reactive updates.
 *
 * @param customerId - The customer ID to find
 * @returns Reactive customer document
 *
 * @example
 * ```tsx
 * function CustomerDetail({ customerId }: { customerId: string }) {
 *   const { data: customer, loading, exists } = useCustomer(customerId);
 *
 *   if (loading) return <Spinner />;
 *   if (!exists) return <NotFound />;
 *
 *   return (
 *     <div>
 *       <h1>{customer!.enc.name}</h1>
 *       <p>{customer!.enc.phone}</p>
 *     </div>
 *   );
 * }
 * ```
 */
export function useCustomer(customerId: string | null): DocumentResult<CustomerDocument> {
  const db = getDatabase();

  return useRxDocument<CustomerDocument>(
    () => {
      if (!db || !customerId) return null;

      try {
        const collection = getCustomersCollection(db);
        return collection.findOne(customerId);
      } catch {
        return null;
      }
    },
    [db, customerId]
  );
}

// ============================================================================
// Visit Hooks
// ============================================================================

/**
 * Hook to get visits with reactive updates.
 *
 * @param options - Query options for filtering and sorting
 * @returns Reactive visit list
 *
 * @example
 * ```tsx
 * function VisitHistory({ customerId }: { customerId: string }) {
 *   const { data: visits, loading } = useVisits({
 *     customerId,
 *     sortBy: 'visitDate',
 *     sortDirection: 'desc',
 *   });
 *
 *   if (loading) return <Spinner />;
 *
 *   return (
 *     <Timeline>
 *       {visits.map(visit => (
 *         <TimelineItem key={visit.id}>
 *           {new Date(visit.visitDate).toLocaleDateString()}
 *         </TimelineItem>
 *       ))}
 *     </Timeline>
 *   );
 * }
 * ```
 */
export function useVisits(options: VisitQueryOptions = {}): QueryResult<VisitDocument[]> {
  const {
    customerId,
    includeDeleted = false,
    dateFrom,
    dateTo,
    sortBy = 'visitDate',
    sortDirection = 'desc',
    limit,
    skip,
  } = options;

  const db = getDatabase();

  return useRxQuery<VisitDocument>(
    () => {
      if (!db) return null;

      try {
        const collection = getVisitsCollection(db);

        // Build query selector
        const selector: MangoQuery<VisitDocType>['selector'] = {};

        if (!includeDeleted) {
          selector.deleted = { $eq: false };
        }

        if (customerId) {
          selector.customerId = { $eq: customerId };
        }

        if (dateFrom !== undefined || dateTo !== undefined) {
          selector.visitDate = {};
          if (dateFrom !== undefined) {
            (selector.visitDate as Record<string, unknown>).$gte = dateFrom;
          }
          if (dateTo !== undefined) {
            (selector.visitDate as Record<string, unknown>).$lte = dateTo;
          }
        }

        // Build query
        let query = collection.find({ selector });

        // Apply sort
        const sortOrder = sortDirection === 'desc' ? 'desc' : 'asc';
        query = query.sort({ [sortBy]: sortOrder });

        // Apply pagination
        if (skip !== undefined) {
          query = query.skip(skip);
        }
        if (limit !== undefined) {
          query = query.limit(limit);
        }

        return query;
      } catch {
        return null;
      }
    },
    [db, customerId, includeDeleted, dateFrom, dateTo, sortBy, sortDirection, limit, skip]
  );
}

/**
 * Hook to get a single visit by ID with reactive updates.
 *
 * @param visitId - The visit ID to find
 * @returns Reactive visit document
 *
 * @example
 * ```tsx
 * function VisitDetail({ visitId }: { visitId: string }) {
 *   const { data: visit, loading, exists } = useVisit(visitId);
 *
 *   if (loading) return <Spinner />;
 *   if (!exists) return <NotFound />;
 *
 *   return (
 *     <div>
 *       <h1>{visit!.enc.services.join(', ')}</h1>
 *       <p>{visit!.enc.notes}</p>
 *     </div>
 *   );
 * }
 * ```
 */
export function useVisit(visitId: string | null): DocumentResult<VisitDocument> {
  const db = getDatabase();

  return useRxDocument<VisitDocument>(
    () => {
      if (!db || !visitId) return null;

      try {
        const collection = getVisitsCollection(db);
        return collection.findOne(visitId);
      } catch {
        return null;
      }
    },
    [db, visitId]
  );
}

/**
 * Hook to get the most recent visit for a customer.
 *
 * @param customerId - The customer ID
 * @returns Reactive most recent visit document
 */
export function useLatestVisit(customerId: string | null): DocumentResult<VisitDocument> {
  const db = getDatabase();

  return useRxDocument<VisitDocument>(
    () => {
      if (!db || !customerId) return null;

      try {
        const collection = getVisitsCollection(db);
        return collection.findOne({
          selector: {
            customerId: { $eq: customerId },
            deleted: { $eq: false },
          },
          sort: [{ visitDate: 'desc' }],
        });
      } catch {
        return null;
      }
    },
    [db, customerId]
  );
}

// ============================================================================
// Photo Hooks
// ============================================================================

/**
 * Hook to get photos with reactive updates.
 *
 * @param options - Query options for filtering and sorting
 * @returns Reactive photo list
 *
 * @example
 * ```tsx
 * function PhotoGallery({ customerId }: { customerId: string }) {
 *   const { data: photos, loading } = usePhotos({
 *     customerId,
 *     uploadStatus: 'uploaded',
 *     variant: 'thumbnail',
 *   });
 *
 *   if (loading) return <Spinner />;
 *
 *   return (
 *     <Grid>
 *       {photos.map(photo => (
 *         <PhotoCard key={photo.id} photo={photo} />
 *       ))}
 *     </Grid>
 *   );
 * }
 * ```
 */
export function usePhotos(options: PhotoQueryOptions = {}): QueryResult<PhotoMetaDocument[]> {
  const {
    customerId,
    visitId,
    uploadStatus,
    variant,
    includeDeleted = false,
    sortBy = 'capturedAt',
    sortDirection = 'desc',
    limit,
    skip,
  } = options;

  const db = getDatabase();

  return useRxQuery<PhotoMetaDocument>(
    () => {
      if (!db) return null;

      try {
        const collection = getPhotosCollection(db);

        // Build query selector
        const selector: MangoQuery<PhotoMetaDocType>['selector'] = {};

        if (!includeDeleted) {
          selector.deleted = { $eq: false };
        }

        if (customerId) {
          selector.customerId = { $eq: customerId };
        }

        if (visitId) {
          selector.visitId = { $eq: visitId };
        }

        if (uploadStatus) {
          selector.uploadStatus = { $eq: uploadStatus };
        }

        if (variant) {
          selector.variant = { $eq: variant };
        }

        // Build query
        let query = collection.find({ selector });

        // Apply sort
        const sortOrder = sortDirection === 'desc' ? 'desc' : 'asc';
        query = query.sort({ [sortBy]: sortOrder });

        // Apply pagination
        if (skip !== undefined) {
          query = query.skip(skip);
        }
        if (limit !== undefined) {
          query = query.limit(limit);
        }

        return query;
      } catch {
        return null;
      }
    },
    [db, customerId, visitId, uploadStatus, variant, includeDeleted, sortBy, sortDirection, limit, skip]
  );
}

/**
 * Hook to get a single photo by ID with reactive updates.
 *
 * @param photoId - The photo ID to find
 * @returns Reactive photo document
 *
 * @example
 * ```tsx
 * function PhotoViewer({ photoId }: { photoId: string }) {
 *   const { data: photo, loading, exists } = usePhoto(photoId);
 *
 *   if (loading) return <Spinner />;
 *   if (!exists) return <NotFound />;
 *
 *   return <FullScreenPhoto photo={photo!} />;
 * }
 * ```
 */
export function usePhoto(photoId: string | null): DocumentResult<PhotoMetaDocument> {
  const db = getDatabase();

  return useRxDocument<PhotoMetaDocument>(
    () => {
      if (!db || !photoId) return null;

      try {
        const collection = getPhotosCollection(db);
        return collection.findOne(photoId);
      } catch {
        return null;
      }
    },
    [db, photoId]
  );
}

/**
 * Hook to get photos pending upload.
 *
 * @returns Reactive list of photos that need to be uploaded
 */
export function usePendingPhotoUploads(): QueryResult<PhotoMetaDocument[]> {
  return usePhotos({
    uploadStatus: 'pending',
    includeDeleted: false,
    sortBy: 'createdAt',
    sortDirection: 'asc',
  });
}

// ============================================================================
// Count Hooks
// ============================================================================

/**
 * Hook to get the count of documents in a collection with reactive updates.
 *
 * @param collectionName - Name of the collection to count
 * @param includeDeleted - Whether to include soft-deleted documents
 * @returns Reactive document count
 *
 * @example
 * ```tsx
 * function Dashboard() {
 *   const customerCount = useDocumentCount('customers');
 *   const visitCount = useDocumentCount('visits');
 *
 *   return (
 *     <Stats>
 *       <Stat label="Customers" value={customerCount.data} />
 *       <Stat label="Visits" value={visitCount.data} />
 *     </Stats>
 *   );
 * }
 * ```
 */
export function useDocumentCount(
  collectionName: CollectionName,
  includeDeleted = false
): QueryResult<number> {
  const [count, setCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [isInitialLoad, setIsInitialLoad] = useState(true);
  const refreshRef = useRef(0);

  const db = getDatabase();

  useEffect(() => {
    if (!db) {
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const collection = db.collections[collectionName];
      if (!collection) {
        setError(new Error(`Collection '${collectionName}' not found`));
        setLoading(false);
        return;
      }

      // Build selector
      const selector: Record<string, unknown> = {};
      if (!includeDeleted) {
        selector.deleted = { $eq: false };
      }

      // Subscribe to the count query
      const query = collection.find({ selector });
      const subscription = query.$.subscribe({
        next: (results) => {
          setCount(results.length);
          setLoading(false);
          setIsInitialLoad(false);
        },
        error: (err) => {
          setError(err instanceof Error ? err : new Error('Count query failed'));
          setLoading(false);
          setIsInitialLoad(false);
        },
      });

      return () => {
        subscription.unsubscribe();
      };
    } catch (err) {
      setError(err instanceof Error ? err : new Error('Count query failed'));
      setLoading(false);
    }
  }, [db, collectionName, includeDeleted, refreshRef.current]);

  const refresh = useCallback(() => {
    refreshRef.current += 1;
    setIsInitialLoad(true);
  }, []);

  return {
    data: count,
    loading,
    error,
    isInitialLoad,
    refresh,
  };
}

/**
 * Hook to get visit count for a specific customer.
 *
 * @param customerId - The customer ID
 * @returns Reactive visit count for the customer
 */
export function useCustomerVisitCount(customerId: string | null): QueryResult<number> {
  const [count, setCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [isInitialLoad, setIsInitialLoad] = useState(true);
  const refreshRef = useRef(0);

  const db = getDatabase();

  useEffect(() => {
    if (!db || !customerId) {
      setCount(0);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const collection = getVisitsCollection(db);

      // Subscribe to filtered count
      const query = collection.find({
        selector: {
          customerId: { $eq: customerId },
          deleted: { $eq: false },
        },
      });

      const subscription = query.$.subscribe({
        next: (results) => {
          setCount(results.length);
          setLoading(false);
          setIsInitialLoad(false);
        },
        error: (err) => {
          setError(err instanceof Error ? err : new Error('Count query failed'));
          setLoading(false);
          setIsInitialLoad(false);
        },
      });

      return () => {
        subscription.unsubscribe();
      };
    } catch (err) {
      setError(err instanceof Error ? err : new Error('Count query failed'));
      setLoading(false);
    }
  }, [db, customerId, refreshRef.current]);

  const refresh = useCallback(() => {
    refreshRef.current += 1;
    setIsInitialLoad(true);
  }, []);

  return {
    data: count,
    loading,
    error,
    isInitialLoad,
    refresh,
  };
}

/**
 * Hook to get photo count for a specific customer.
 *
 * @param customerId - The customer ID
 * @returns Reactive photo count for the customer
 */
export function useCustomerPhotoCount(customerId: string | null): QueryResult<number> {
  const [count, setCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [isInitialLoad, setIsInitialLoad] = useState(true);
  const refreshRef = useRef(0);

  const db = getDatabase();

  useEffect(() => {
    if (!db || !customerId) {
      setCount(0);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const collection = getPhotosCollection(db);

      // Subscribe to filtered count (original photos only to avoid double counting)
      const query = collection.find({
        selector: {
          customerId: { $eq: customerId },
          variant: { $eq: 'original' },
          deleted: { $eq: false },
        },
      });

      const subscription = query.$.subscribe({
        next: (results) => {
          setCount(results.length);
          setLoading(false);
          setIsInitialLoad(false);
        },
        error: (err) => {
          setError(err instanceof Error ? err : new Error('Count query failed'));
          setLoading(false);
          setIsInitialLoad(false);
        },
      });

      return () => {
        subscription.unsubscribe();
      };
    } catch (err) {
      setError(err instanceof Error ? err : new Error('Count query failed'));
      setLoading(false);
    }
  }, [db, customerId, refreshRef.current]);

  const refresh = useCallback(() => {
    refreshRef.current += 1;
    setIsInitialLoad(true);
  }, []);

  return {
    data: count,
    loading,
    error,
    isInitialLoad,
    refresh,
  };
}

// ============================================================================
// Search Hooks
// ============================================================================

/**
 * Hook for searching customers by name.
 * Note: This performs client-side filtering since encrypted fields cannot be queried.
 * For large datasets, consider implementing server-side search.
 *
 * @param searchTerm - The search term to match against customer names
 * @returns Reactive filtered customer list
 *
 * @example
 * ```tsx
 * function CustomerSearch() {
 *   const [search, setSearch] = useState('');
 *   const { data: results, loading } = useCustomerSearch(search);
 *
 *   return (
 *     <>
 *       <input value={search} onChange={e => setSearch(e.target.value)} />
 *       <CustomerList customers={results} loading={loading} />
 *     </>
 *   );
 * }
 * ```
 */
export function useCustomerSearch(searchTerm: string): QueryResult<CustomerDocument[]> {
  // Get all customers first
  const { data: allCustomers, loading, error, isInitialLoad, refresh } = useCustomers();

  // Filter client-side
  const filteredData = useMemo(() => {
    if (!searchTerm.trim()) {
      return allCustomers;
    }

    const normalizedSearch = searchTerm.toLowerCase().trim();

    return allCustomers.filter((customer) => {
      // Search in encrypted name field
      const name = customer.enc?.name?.toLowerCase() || '';
      if (name.includes(normalizedSearch)) {
        return true;
      }

      // Also search in phone and email
      const phone = customer.enc?.phone?.toLowerCase() || '';
      const email = customer.enc?.email?.toLowerCase() || '';

      return phone.includes(normalizedSearch) || email.includes(normalizedSearch);
    });
  }, [allCustomers, searchTerm]);

  return {
    data: filteredData,
    loading,
    error,
    isInitialLoad,
    refresh,
  };
}
