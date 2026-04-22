import React, { useCallback, useEffect, useRef, useState } from 'react';
import type { VaultDb } from '../db/pouch';
import { putEncrypted, queryDecrypted, watchChanges, DOC_TYPES } from '../db/pouch';
import { generateDocId, type CustomerData, type PlaintextDoc } from '../db/types';

interface Props {
  db: VaultDb;
}

type Row = PlaintextDoc<CustomerData>;

export function CustomerCRM({ db }: Props): JSX.Element {
  const [rows, setRows] = useState<Row[]>([]);
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [phone, setPhone] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const refreshing = useRef(false);

  const refresh = useCallback(async () => {
    if (refreshing.current) return;
    refreshing.current = true;
    try {
      const docs = await queryDecrypted<CustomerData>(db, DOC_TYPES.CUSTOMER);
      setRows(docs);
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
      refreshing.current = false;
    }
  }, [db]);

  useEffect(() => {
    void refresh();
    const handle = watchChanges(db, ({ type }) => {
      if (type === DOC_TYPES.CUSTOMER) void refresh();
    });
    return () => handle.cancel();
  }, [db, refresh]);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!firstName.trim() || !lastName.trim()) {
      setError('First name and last name are required.');
      return;
    }
    try {
      const now = Date.now();
      await putEncrypted<CustomerData>(db, {
        _id: generateDocId(DOC_TYPES.CUSTOMER),
        type: DOC_TYPES.CUSTOMER,
        updatedAt: now,
        deleted: false,
        data: {
          firstName: firstName.trim(),
          lastName: lastName.trim(),
          phone: phone.trim() || undefined,
          createdAt: now,
        },
      });
      setFirstName('');
      setLastName('');
      setPhone('');
    } catch (err) {
      setError((err as Error).message);
    }
  };

  return (
    <div>
      <h2 style={{ margin: '0 0 16px' }}>Customers</h2>

      <form onSubmit={onSubmit} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr auto', gap: 8, marginBottom: 24 }}>
        <input
          value={firstName}
          onChange={(e) => setFirstName(e.target.value)}
          placeholder="First name"
          style={{ padding: 8, borderRadius: 8, border: '1px solid #d1d5db' }}
        />
        <input
          value={lastName}
          onChange={(e) => setLastName(e.target.value)}
          placeholder="Last name"
          style={{ padding: 8, borderRadius: 8, border: '1px solid #d1d5db' }}
        />
        <input
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          placeholder="Phone (optional)"
          style={{ padding: 8, borderRadius: 8, border: '1px solid #d1d5db' }}
        />
        <button type="submit" style={{ padding: '8px 16px', borderRadius: 8, background: '#007aff', color: '#fff', border: 'none', cursor: 'pointer' }}>
          Add
        </button>
      </form>

      {error && <div role="alert" style={{ color: '#ff3b30', marginBottom: 16 }}>{error}</div>}

      {loading ? (
        <p style={{ color: '#666' }}>Loading customers…</p>
      ) : rows.length === 0 ? (
        <p style={{ color: '#666' }}>No customers yet. Add one above.</p>
      ) : (
        <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: 8 }}>
          {rows.map((row) => (
            <li key={row._id} style={{ background: 'rgba(255,255,255,0.75)', padding: 16, borderRadius: 12, border: '1px solid rgba(0,0,0,0.06)' }}>
              <div style={{ fontWeight: 600 }}>
                {row.data.firstName} {row.data.lastName}
              </div>
              {row.data.phone && (
                <div style={{ fontSize: 13, color: '#666', marginTop: 4 }}>{row.data.phone}</div>
              )}
              <div style={{ fontSize: 11, color: '#999', marginTop: 4 }}>
                id: <code>{row._id.slice(0, 28)}</code> · updated {new Date(row.updatedAt).toLocaleString()}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
