import { useCallback, useEffect, useState } from 'react';
import type { ReactElement } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { todos } from '../../api';
import type { TodoRow } from '../../api';
import { Icon, Icons } from '../../components/Icon';

const todayStr = (): string => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

const shiftDate = (date: string, days: number): string => {
  const d = new Date(`${date}T00:00:00`);
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

const fmtDate = (date: string): string =>
  new Date(`${date}T00:00:00`).toLocaleDateString(undefined, {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

export function MyTodoPage(): ReactElement {
  const [params] = useSearchParams();
  // Colleague read-only mode: /me/todo?employee=<uuid>&name=<Full Name>
  const otherId = params.get('employee');
  const otherName = params.get('name');

  const [date, setDate] = useState(todayStr());
  const [items, setItems] = useState<TodoRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [text, setText] = useState('');
  const [adding, setAdding] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [editText, setEditText] = useState('');
  const readOnly = Boolean(otherId);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = readOnly ? await todos.listForEmployeeToday(otherId as string) : await todos.list(date);
      setItems(res.data);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load to-dos');
    } finally {
      setLoading(false);
    }
  }, [readOnly, otherId, date]);

  useEffect(() => {
    void load();
  }, [load]);

  const add = async () => {
    const t = text.trim();
    if (!t || adding) return;
    setAdding(true);
    setError('');
    try {
      await todos.create({ title: t, todo_date: date });
      setText('');
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to add item');
    } finally {
      setAdding(false);
    }
  };

  const toggle = async (item: TodoRow) => {
    setError('');
    try {
      await todos.update(item.id, { is_completed: !item.is_completed });
      setItems((list) =>
        list.map((x) => (x.id === item.id ? { ...x, is_completed: !x.is_completed } : x))
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to update item');
    }
  };

  const saveEdit = async () => {
    if (!editId) return;
    const t = editText.trim();
    if (!t) return;
    setError('');
    try {
      const res = await todos.update(editId, { title: t });
      setItems((list) => list.map((x) => (x.id === editId ? res.data : x)));
      setEditId(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to update item');
    }
  };

  const remove = async (id: string) => {
    setError('');
    try {
      await todos.remove(id);
      setItems((list) => list.filter((x) => x.id !== id));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to delete item');
    }
  };

  const pending = items.filter((i) => !i.is_completed);
  const done = items.filter((i) => i.is_completed);

  const renderItem = (item: TodoRow) => (
    <div key={item.id} className="todo-item" data-todo-item>
      <input
        type="checkbox"
        checked={item.is_completed}
        disabled={readOnly}
        onChange={() => toggle(item)}
        aria-label={`Mark "${item.title}" ${item.is_completed ? 'incomplete' : 'completed'}`}
        style={{ width: 18, height: 18, cursor: readOnly ? 'default' : 'pointer', flexShrink: 0 }}
      />
      {editId === item.id ? (
        <>
          <input
            className="form-control-clay form-control-sm"
            value={editText}
            autoFocus
            maxLength={500}
            onChange={(e) => setEditText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void saveEdit();
              if (e.key === 'Escape') setEditId(null);
            }}
            style={{ flex: 1 }}
          />
          {!readOnly && (
            <>
              <button className="icon-btn" title="Save" onClick={saveEdit}>
                <Icon icon={Icons.Success} />
              </button>
              <button className="icon-btn" title="Cancel" onClick={() => setEditId(null)}>
                ✕
              </button>
            </>
          )}
        </>
      ) : (
        <>
          <span
            style={{
              flex: 1,
              minWidth: 0,
              wordBreak: 'break-word',
              ...(item.is_completed
                ? { textDecoration: 'line-through', opacity: 0.55 }
                : {}),
            }}
          >
            {item.title}
          </span>
          {item.is_completed && item.completed_at && (
            <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
              {new Date(item.completed_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            </span>
          )}
          {!readOnly && (
            <span style={{ display: 'flex', gap: 4 }}>
              <button
                className="icon-btn"
                title="Edit"
                onClick={() => {
                  setEditId(item.id);
                  setEditText(item.title);
                }}
              >
                <Icon icon={Icons.Edit} />
              </button>
              <button className="icon-btn icon-btn-danger" title="Delete" onClick={() => remove(item.id)}>
                <Icon icon={Icons.Trash} />
              </button>
            </span>
          )}
        </>
      )}
    </div>
  );

  return (
    <div>
      {readOnly ? (
        <>
          <div className="alert-box alert-box-info" style={{ marginBottom: '1rem' }}>
            Viewing <strong>{otherName ?? 'colleague'}</strong>&rsquo;s to-do list for{' '}
            <strong>today only</strong> — read-only.
          </div>
          <Link to="/hr/employees" className="btn btn-outline" style={{ marginBottom: '1rem', display: 'inline-block' }}>
            ← Back to Employees
          </Link>
        </>
      ) : (
        <div className="filter-row" style={{ alignItems: 'center', gap: '0.5rem' }}>
          <button className="btn-clay btn-clay-sm btn-clay-secondary" onClick={() => setDate(shiftDate(date, -1))}>
            ‹ Previous Day
          </button>
          <button className="btn-clay btn-clay-sm btn-clay-secondary" onClick={() => setDate(todayStr())}>
            Today
          </button>
          <button
            className="btn-clay btn-clay-sm btn-clay-secondary"
            disabled={date >= todayStr()}
            onClick={() => setDate(shiftDate(date, 1))}
          >
            Next Day ›
          </button>
          <input
            className="form-control-clay form-control-sm"
            type="date"
            value={date}
            max={todayStr()}
            onChange={(e) => e.target.value && setDate(e.target.value)}
            aria-label="To-do date"
            style={{ width: 'auto' }}
          />
        </div>
      )}

      <h3 style={{ fontSize: '1.15rem', fontWeight: 800, margin: '1rem 0 0.5rem' }}>
        {readOnly ? `Today — ${fmtDate(todayStr())}` : fmtDate(date)}
      </h3>

      {error && <div className="alert-box alert-box-error">{error}</div>}

      {!readOnly && (
        <div className="panel-clay" style={{ padding: '0.9rem', marginTop: '0.5rem' }}>
          <div style={{ display: 'flex', gap: '0.6rem' }} data-todo-add>
            <input
              className="form-control-clay"
              placeholder="What are you working on?"
              value={text}
              maxLength={500}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void add();
              }}
              style={{ flex: 1 }}
            />
            <button className="btn-clay btn-clay-primary" onClick={add} disabled={adding || !text.trim()}>
              + Add
            </button>
          </div>
        </div>
      )}

      {loading ? (
        <div className="stat-card-clay" style={{ marginTop: '1rem' }}>
          <div className="stat-label">Loading…</div>
        </div>
      ) : items.length === 0 ? (
        <div className="stat-card-clay" style={{ marginTop: '1rem' }}>
          <div className="stat-label">
            {readOnly ? 'No to-do items for today.' : 'Nothing noted for this day yet.'}
          </div>
        </div>
      ) : (
        <>
          <div className="panel-clay" style={{ padding: '0.9rem 1.1rem', marginTop: '1rem' }} data-todo-list>
            <div style={{ fontWeight: 800, fontSize: '0.8rem', textTransform: 'uppercase', letterSpacing: 0.4, color: 'var(--text-muted)', marginBottom: '0.5rem' }}>
              To do ({pending.length})
            </div>
            {pending.length === 0 ? (
              <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>All done 🎉</div>
            ) : (
              pending.map(renderItem)
            )}
          </div>
          {done.length > 0 && (
            <div className="panel-clay" style={{ padding: '0.9rem 1.1rem', marginTop: '0.9rem' }} data-todo-done>
              <div style={{ fontWeight: 800, fontSize: '0.8rem', textTransform: 'uppercase', letterSpacing: 0.4, color: 'var(--text-muted)', marginBottom: '0.5rem' }}>
                Completed ({done.length})
              </div>
              {done.map(renderItem)}
            </div>
          )}
        </>
      )}
    </div>
  );
}
