import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import type { ConversationDetail, ConversationMember, ConversationSummary, ChatMessage, MessagingUser } from '../../api';
import { API_BASE, messages as msgApi } from '../../api';
import { useCurrentUser } from '../../auth-context';
import { Icons } from '../../components/Icon';
import { Icon } from '../../components/Icon';

const AVATAR_COLORS = ['#6366f1', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4', '#ec4899', '#14b8a6'];

function avatarColor(name: string): string {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = name.charCodeAt(i) + ((h << 5) - h);
  return AVATAR_COLORS[Math.abs(h) % AVATAR_COLORS.length];
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p.charAt(0).toUpperCase())
    .join('');
}

function timeLabel(iso: string): string {
  try {
    const d = new Date(iso);
    const diff = Date.now() - d.getTime();
    if (diff < 60_000) return 'now';
    if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m`;
    if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h`;
    if (diff < 604_800_000) return `${Math.floor(diff / 86_400_000)}d`;
    return d.toLocaleDateString();
  } catch {
    return '';
  }
}

function dateSep(iso: string): string {
  try {
    const d = new Date(iso);
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const target = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    const diffMs = today.getTime() - target.getTime();
    if (diffMs < 0) return 'Today';
    if (diffMs < 86_400_000) return 'Today';
    if (diffMs < 172_800_000) return 'Yesterday';
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  } catch {
    return '';
  }
}

function msgTime(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
  } catch {
    return '';
  }
}

function convName(c: { name: string | null; participants: { user_id: string; full_name: string }[] }, currentUserId: string): string {
  if (c.name) return c.name;
  const other = c.participants.find((p) => p.user_id !== currentUserId);
  return other?.full_name ?? 'Conversation';
}

/* ── New Message Modal ────────────────────────────────────────────────────── */

function NewMessageModal({
  onClose,
  onOpen,
}: {
  onClose: () => void;
  onOpen: (convId: string) => void;
}) {
  const [tab, setTab] = useState<'direct' | 'group'>('direct');
  const [search, setSearch] = useState('');
  const [results, setResults] = useState<MessagingUser[]>([]);
  const [searching, setSearching] = useState(false);
  const [groupName, setGroupName] = useState('');
  const [selected, setSelected] = useState<MessagingUser[]>([]);
  const [creating, setCreating] = useState(false);
  const searchTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  const doSearch = useCallback(async (term: string) => {
    setSearching(true);
    try {
      const res = await msgApi.userSearch(term.trim(), 25);
      setResults(res.data ?? []);
    } catch {
      setResults([]);
    } finally {
      setSearching(false);
    }
  }, []);

  useEffect(() => {
    clearTimeout(searchTimer.current);
    if (tab === 'direct') {
      searchTimer.current = setTimeout(() => doSearch(search), 250);
    } else {
      searchTimer.current = setTimeout(() => doSearch(search), 250);
    }
    return () => clearTimeout(searchTimer.current);
  }, [search, tab, doSearch]);

  async function pickDirect(user: MessagingUser) {
    setCreating(true);
    try {
      const res = await msgApi.startDirect(user.id);
      onOpen(res.data.id);
      onClose();
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Failed');
    } finally {
      setCreating(false);
    }
  }

  function toggleSelected(user: MessagingUser) {
    setSelected((prev) =>
      prev.some((u) => u.id === user.id) ? prev.filter((u) => u.id !== user.id) : [...prev, user]
    );
  }

  async function createGroup() {
    if (!groupName.trim() || selected.length === 0) return;
    setCreating(true);
    try {
      const res = await msgApi.createGroup(
        groupName.trim(),
        selected.map((u) => u.id)
      );
      onOpen(res.data.id);
      onClose();
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Failed');
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" style={{ maxWidth: 460, maxHeight: '80vh', display: 'flex', flexDirection: 'column' }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-header" style={{ padding: '0.8rem 1rem', borderBottom: '1px solid var(--border-subtle)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h3 style={{ margin: 0, fontSize: '1rem' }}>New Message</h3>
          <button className="icon-btn" onClick={onClose} aria-label="Close"><Icon icon={Icons.Close} /></button>
        </div>
        <div className="msg-modal-body" style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
          <div className="msg-tabs">
            <button className={`msg-tab${tab === 'direct' ? ' active' : ''}`} onClick={() => { setTab('direct'); setSelected([]); setSearch(''); }}>Direct Message</button>
            <button className={`msg-tab${tab === 'group' ? ' active' : ''}`} onClick={() => { setTab('group'); setSearch(''); }}>Create Group</button>
          </div>
          {tab === 'group' && (
            <input
              className="msg-group-name-input"
              placeholder="Group name"
              value={groupName}
              onChange={(e) => setGroupName(e.target.value)}
            />
          )}
          {tab === 'group' && selected.length > 0 && (
            <div className="msg-chip-list">
              {selected.map((u) => (
                <span key={u.id} className="msg-chip">
                  {u.full_name}
                  <button onClick={() => toggleSelected(u)} aria-label={`Remove ${u.full_name}`}>&times;</button>
                </span>
              ))}
            </div>
          )}
          <input
            className="msg-search"
            style={{ width: '100%', padding: '0.45rem 0.7rem', border: '1px solid var(--border-subtle)', borderRadius: 6, fontSize: '0.85rem', background: 'var(--surface-muted)', color: 'var(--text-main)', marginBottom: '0.5rem' }}
            placeholder="Search users..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <div style={{ flex: 1, overflowY: 'auto', maxHeight: 320 }}>
            {searching && <div style={{ padding: '0.5rem', color: 'var(--text-dim)', fontSize: '0.82rem' }}>Searching...</div>}
            {!searching && results.length === 0 && (
              <div style={{ padding: '0.5rem', color: 'var(--text-dim)', fontSize: '0.82rem' }}>
                {search.trim().length > 0 ? 'No users found' : 'No other active users'}
              </div>
            )}
            {results.map((u) => (
              <div
                key={u.id}
                className="msg-user-row"
                onClick={() => (tab === 'direct' ? pickDirect(u) : toggleSelected(u))}
              >
                <div className="msg-conv-avatar" style={{ background: avatarColor(u.full_name), width: 32, height: 32, fontSize: '0.75rem' }}>
                  {initials(u.full_name)}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="msg-conv-name">{u.full_name}</div>
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-dim)' }}>
                    {u.designation && <>{u.designation}{u.department ? ' · ' : ''}</>}
                    {u.department}
                  </div>
                </div>
                {tab === 'group' && selected.some((s) => s.id === u.id) && (
                  <span style={{ color: 'var(--accent)' }}><Icon icon={Icons.Check} /></span>
                )}
              </div>
            ))}
          </div>
        </div>
        {tab === 'group' && (
          <div style={{ padding: '0.7rem 1rem', borderTop: '1px solid var(--border-subtle)' }}>
            <button
              className="msg-send-btn"
              style={{ width: '100%', justifyContent: 'center' }}
              disabled={creating || !groupName.trim() || selected.length === 0}
              onClick={createGroup}
            >
              {creating ? 'Creating...' : 'Create Group'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

/* ── Members Panel (group detail) ─────────────────────────────────────────── */

function MembersPanel({ members, onClose }: { members: ConversationMember[]; onClose: () => void }) {
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" style={{ maxWidth: 360, maxHeight: '80vh' }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-header" style={{ padding: '0.8rem 1rem', borderBottom: '1px solid var(--border-subtle)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h3 style={{ margin: 0, fontSize: '1rem' }}>Members ({members.length})</h3>
          <button className="icon-btn" onClick={onClose}><Icon icon={Icons.Close} /></button>
        </div>
        <div className="msg-members-panel" style={{ maxHeight: '60vh', overflowY: 'auto' }}>
          {members.map((m) => (
            <div key={m.user_id} className="msg-member-row">
              <div className="msg-conv-avatar" style={{ background: avatarColor(m.full_name), width: 30, height: 30, fontSize: '0.7rem' }}>
                {initials(m.full_name)}
              </div>
              <span>{m.full_name}</span>
              <span className="msg-member-role">{m.role === 'owner' ? 'Owner' : m.role === 'admin' ? 'Admin' : ''}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ── Main MessagesPage ────────────────────────────────────────────────────── */

export function MessagesPage(): React.ReactElement {
  const { conversationId: urlConvId } = useParams<{ conversationId?: string }>();
  const user = useCurrentUser();
  const navigate = useNavigate();

  const [convs, setConvs] = useState<ConversationSummary[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(urlConvId ?? null);
  const [detail, setDetail] = useState<ConversationDetail | null>(null);
  const [msgs, setMsgs] = useState<ChatMessage[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [inputVal, setInputVal] = useState('');
  const [sending, setSending] = useState(false);
  const [showNewMsg, setShowNewMsg] = useState(false);
  const [showMembers, setShowMembers] = useState(false);
  const [searchConv, setSearchConv] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const msgContainerRef = useRef<HTMLDivElement>(null);
  const loadingMore = useRef(false);

  const currentUserId = user?.id ?? '';

  /* ── Load conversation list ── */
  const refreshConvs = useCallback(async () => {
    try {
      const res = await msgApi.conversations({ perPage: 100 });
      setConvs(res.data.items);
    } catch { /* ignore */ }
  }, []);

  useEffect(() => { void refreshConvs(); }, [refreshConvs]);

  /* ── SSE listener ── */
  useEffect(() => {
    const es = new EventSource(`${API_BASE}/api/messages/stream`, { withCredentials: true } as EventSourceInit);

    function onMessage(ev: MessageEvent) {
      try {
        const payload = JSON.parse(ev.data) as { conversation_id?: string; id?: string; seq?: number };
        const convId = payload.conversation_id;
        if (convId) {
          if (convId === selectedId) {
            void loadMessages(selectedId, false);
          }
          void refreshConvs();
        }
      } catch { /* ignore */ }
    }

    const events = ['message:new', 'message:updated', 'message:deleted', 'conversation:created', 'conversation:updated', 'conversation:read', 'group:member_added', 'group:member_removed'] as const;
    for (const ev of events) es.addEventListener(ev, onMessage);
    es.addEventListener('unread', () => void refreshConvs());
    return () => { es.close(); };
  }, [selectedId, refreshConvs]);

  /* ── Sync selectedId from URL ── */
  useEffect(() => {
    setSelectedId(urlConvId ?? null);
  }, [urlConvId]);

  /* ── Load detail + messages when selectedId changes ── */
  useEffect(() => {
    if (!selectedId) { setDetail(null); setMsgs([]); return; }
    let cancelled = false;
    (async () => {
      try {
        const detRes = await msgApi.conversation(selectedId);
        if (!cancelled) setDetail(detRes.data);
        const msgRes = await msgApi.listMessages(selectedId, { limit: 50 });
        if (!cancelled) {
          setMsgs(msgRes.data.items);
          setHasMore(msgRes.data.has_more);
          setTimeout(() => messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 50);
          await msgApi.markRead(selectedId);
          void refreshConvs();
        }
      } catch { /* ignore — not a member or deleted */ }
    })();
    return () => { cancelled = true; };
  }, [selectedId, refreshConvs]);

  /* ── Load older messages ── */
  async function loadOlder() {
    if (!selectedId || !hasMore || loadingMore.current) return;
    loadingMore.current = true;
    const oldestSeq = msgs[0]?.seq;
    try {
      const res = await msgApi.listMessages(selectedId, { beforeSeq: oldestSeq, limit: 50 });
      setMsgs((prev) => [...res.data.items, ...prev]);
      setHasMore(res.data.has_more);
    } catch { /* ignore */ }
    loadingMore.current = false;
  }

  /* ── Load messages for SSE refresh (used by SSE handler when a new message arrives in active conv) ── */
  async function loadMessages(convId: string, _scroll = true) {
    try {
      const res = await msgApi.listMessages(convId, { limit: 50 });
      setMsgs(res.data.items);
      setHasMore(res.data.has_more);
      if (_scroll) setTimeout(() => messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 30);
    } catch { /* ignore */ }
  }

  /* ── Send message ── */
  async function handleSend() {
    if (!selectedId || sending || inputVal.trim().length === 0) return;
    const body = inputVal.trim();
    setInputVal('');
    setSending(true);
    try {
      await msgApi.sendMessage(selectedId, body);
      void loadMessages(selectedId);
      void refreshConvs();
    } catch (e) {
      setInputVal(body); // restore on failure
      alert(e instanceof Error ? e.message : 'Failed to send');
    } finally {
      setSending(false);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void handleSend();
    }
  }

  function selectConversation(id: string) {
    navigate(`/messages/${id}`);
  }

  function onNewMsgOpen(convId: string) {
    navigate(`/messages/${convId}`);
    void refreshConvs();
  }

  /* ── Filter conversation list ── */
  const filteredConvs = useMemo(() => {
    if (!searchConv.trim()) return convs;
    const q = searchConv.toLowerCase();
    return convs.filter((c) => convName(c, currentUserId).toLowerCase().includes(q));
  }, [convs, searchConv, currentUserId]);

  /* ── Date separators ── */
  let lastDate = '';

  return (
    <div className="msg-layout">
      {/* ── Left: Conversation List ── */}
      <div className={`msg-list-panel${selectedId ? ' hidden-mobile' : ''}`}>
        <div className="msg-list-header">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <h3>Messages</h3>
            <button className="msg-new-btn" onClick={() => setShowNewMsg(true)}>
              <Icon icon={Icons.Plus} size="xs" /> New Message
            </button>
          </div>
        </div>
        <div className="msg-search">
          <input
            placeholder="Search conversations..."
            value={searchConv}
            onChange={(e) => setSearchConv(e.target.value)}
          />
        </div>
        <div className="msg-conv-list">
          {filteredConvs.length === 0 && (
            <div style={{ padding: '1.5rem 1rem', textAlign: 'center', color: 'var(--text-dim)', fontSize: '0.85rem', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
              <span>{searchConv ? 'No matching conversations' : 'No conversations yet'}</span>
              {!searchConv && (
                <button className="btn btn-primary btn-sm" onClick={() => setShowNewMsg(true)}>
                  <Icon icon={Icons.Plus} size="xs" /> New Message
                </button>
              )}
            </div>
          )}
          {filteredConvs.map((c) => (
            <div
              key={c.id}
              className={`msg-conv-item${c.id === selectedId ? ' active' : ''}${c.unread_count > 0 ? ' msg-conv-item-unread' : ''}`}
              onClick={() => selectConversation(c.id)}
            >
              <div className="msg-conv-avatar" style={{ background: c.type === 'group' ? 'var(--accent, #6366f1)' : avatarColor(convName(c, currentUserId)) }}>
                {c.type === 'group'
                  ? <span style={{ fontSize: '0.85rem', color: '#fff' }}><Icon icon={Icons.Users} /></span>
                  : initials(convName(c, currentUserId))}
              </div>
              <div className="msg-conv-body">
                <div className="msg-conv-name">{convName(c, currentUserId)}</div>
                <div className="msg-conv-preview">
                  {c.latest_message
                    ? (c.latest_message.deleted ? 'Deleted' : c.latest_message.body)
                    : 'No messages yet'}
                </div>
              </div>
              <div className="msg-conv-meta">
                {c.last_message_at && <span className="msg-conv-time">{timeLabel(c.last_message_at)}</span>}
                {c.unread_count > 0 && <span className="msg-badge">{c.unread_count > 99 ? '99+' : c.unread_count}</span>}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* ── Right: Chat Panel ── */}
      <div className={`msg-chat-panel${selectedId ? '' : ' hidden-mobile'}`}>
        {!selectedId || !detail ? (
          <div className="msg-empty-state">
            <span style={{ fontSize: '2.5rem' }}><Icon icon={Icons.PaperPlane} /></span>
            <p>Select a conversation or start a new one</p>
            <button className="btn btn-primary" onClick={() => setShowNewMsg(true)}>
              <Icon icon={Icons.Plus} size="sm" /> New Message
            </button>
          </div>
        ) : (
          <>
            <div className="msg-chat-header">
              <button className="icon-btn msg-back-btn" onClick={() => navigate('/messages')}>
                <span style={{ transform: 'rotate(90deg)' }}><Icon icon={Icons.ChevronDown} /></span>
              </button>
              <div className="msg-conv-avatar" style={{ background: detail.type === 'group' ? 'var(--accent, #6366f1)' : avatarColor(convName(detail, currentUserId)), width: 38, height: 38, fontSize: '0.82rem' }}>
                {detail.type === 'group'
                  ? <span style={{ fontSize: '0.9rem', color: '#fff' }}><Icon icon={Icons.Users} /></span>
                  : initials(convName(detail, currentUserId))}
              </div>
              <div className="msg-chat-header-info">
                <div className="msg-chat-header-name">{convName(detail, currentUserId)}</div>
                <div className="msg-chat-header-sub">
                  {detail.type === 'group'
                    ? `${detail.member_count} members`
                    : detail.other_participant?.full_name ?? ''}
                </div>
              </div>
              {detail.type === 'group' && (
                <button className="icon-btn" onClick={() => setShowMembers(true)} title="View members">
                  <Icon icon={Icons.Users} />
                </button>
              )}
            </div>

            <div className="msg-messages-list" ref={msgContainerRef}
              onScroll={() => {
                if (msgContainerRef.current?.scrollTop === 0 && hasMore) void loadOlder();
              }}
            >
              {hasMore && (
                <button
                  onClick={() => void loadOlder()}
                  style={{ alignSelf: 'center', padding: '0.3rem 0.8rem', fontSize: '0.78rem', color: 'var(--accent)', background: 'none', border: 'none', cursor: 'pointer' }}
                >
                  Load older messages
                </button>
              )}
              {msgs.map((m) => {
                const sep = dateSep(m.created_at);
                const showSep = sep !== lastDate;
                lastDate = sep;
                const isOwn = m.sender_user_id === currentUserId;
                const isSystem = m.message_type === 'system';
                return (
                  <div key={m.id}>
                    {showSep && <div className="msg-date-sep"><span>{sep}</span></div>}
                    {isSystem ? (
                      <div className="msg-bubble msg-bubble-system">{m.body}</div>
                    ) : (
                      <div className={`msg-bubble ${isOwn ? 'msg-bubble-own' : 'msg-bubble-other'}`}>
                        {!isOwn && detail.type === 'group' && (
                          <div className="msg-sender-name">{m.sender_name ?? 'Unknown'}</div>
                        )}
                        <div>{m.body}</div>
                        <div className="msg-bubble-time">
                          {m.updated_at && <span className="msg-bubble-edited" />}
                          {msgTime(m.created_at)}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
              <div ref={messagesEndRef} />
            </div>

            <div className="msg-composer">
              <textarea
                ref={textareaRef}
                placeholder="Type a message..."
                value={inputVal}
                onChange={(e) => setInputVal(e.target.value)}
                onKeyDown={handleKeyDown}
                rows={1}
              />
              <button className="msg-send-btn" onClick={() => void handleSend()} disabled={sending || inputVal.trim().length === 0}>
                <span style={{ fontSize: '0.85rem' }}><Icon icon={Icons.PaperPlane} /></span> Send
              </button>
            </div>
          </>
        )}
      </div>

      {showNewMsg && <NewMessageModal onClose={() => setShowNewMsg(false)} onOpen={onNewMsgOpen} />}
      {showMembers && detail && <MembersPanel members={detail.members} onClose={() => setShowMembers(false)} />}
    </div>
  );
}
