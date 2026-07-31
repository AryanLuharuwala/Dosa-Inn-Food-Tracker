'use client';

import React, { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import styles from './page.module.css';

interface Subscriber {
    phone: string;
    name: string | null;
    subscribedAt: string;
    optedOutAt: string | null;
    source: string | null;
}

interface MarketingGroup {
    id: string;
    name: string;
    createdAt: string;
    memberCount: number;
}

interface Campaign {
    id: string;
    name: string;
    message: string;
    imageUrl: string | null;
    linkUrl: string | null;
    targetGroupId: string | null;
    triggerType: 'manual' | 'scheduled' | 'rule';
    scheduledAt: string | null;
    status: 'draft' | 'scheduled' | 'sending' | 'sent' | 'cancelled' | 'active';
    createdAt: string;
    sentCount: number;
    failedCount: number;
}

interface AutomationRule {
    id: string;
    name: string;
    enabled: boolean;
    triggerKind: 'order_ready_uncollected' | 'customer_inactive';
    triggerParams: Record<string, number>;
    campaignId: string;
    createdAt: string;
    firedCount: number;
}

function relTime(iso: string): string {
    const ms = Date.now() - new Date(iso).getTime();
    if (ms < 60_000) return 'just now';
    if (ms < 3_600_000) return `${Math.round(ms / 60_000)}m ago`;
    if (ms < 86_400_000) return `${Math.round(ms / 3_600_000)}h ago`;
    return `${Math.round(ms / 86_400_000)}d ago`;
}

export default function MarketingPage() {
    const [subscribers, setSubscribers] = useState<Subscriber[]>([]);
    const [groups, setGroups] = useState<MarketingGroup[]>([]);
    const [campaigns, setCampaigns] = useState<Campaign[]>([]);
    const [rules, setRules] = useState<AutomationRule[]>([]);
    const [loading, setLoading] = useState(true);

    const load = useCallback(async () => {
        const [sRes, gRes, cRes, rRes] = await Promise.all([
            fetch('/api/marketing/subscribers'),
            fetch('/api/marketing/groups'),
            fetch('/api/marketing/campaigns'),
            fetch('/api/marketing/rules'),
        ]);
        if (sRes.ok) setSubscribers(await sRes.json());
        if (gRes.ok) setGroups(await gRes.json());
        if (cRes.ok) setCampaigns(await cRes.json());
        if (rRes.ok) setRules(await rRes.json());
        setLoading(false);
    }, []);

    useEffect(() => {
        load();
        const t = setInterval(load, 10_000);
        return () => clearInterval(t);
    }, [load]);

    // ── Subscribers & Groups ─────────────────────────────────────────────────
    const [newSubPhone, setNewSubPhone] = useState('');
    const [newSubName, setNewSubName] = useState('');
    const [newGroupName, setNewGroupName] = useState('');

    const addSubscriber = async () => {
        if (!newSubPhone.trim()) return;
        await fetch('/api/marketing/subscribers', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ phone: newSubPhone, name: newSubName || undefined }),
        });
        setNewSubPhone(''); setNewSubName('');
        await load();
    };

    const removeSubscriber = async (phone: string) => {
        if (!confirm(`Remove ${phone} from subscribers?`)) return;
        await fetch(`/api/marketing/subscribers/${phone}`, { method: 'DELETE' });
        await load();
    };

    const createGroup = async () => {
        if (!newGroupName.trim()) return;
        await fetch('/api/marketing/groups', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: newGroupName }),
        });
        setNewGroupName('');
        await load();
    };

    const deleteGroup = async (id: string) => {
        if (!confirm('Delete this group? Members stay subscribed overall, they just leave this group.')) return;
        await fetch(`/api/marketing/groups/${id}`, { method: 'DELETE' });
        await load();
    };

    const [assigningGroup, setAssigningGroup] = useState<string | null>(null);
    const [groupMembers, setGroupMembers] = useState<string[]>([]);
    const openGroupAssign = async (groupId: string) => {
        setAssigningGroup(groupId);
        const res = await fetch(`/api/marketing/groups/${groupId}/members`);
        setGroupMembers(res.ok ? await res.json() : []);
    };
    const toggleMember = async (phone: string) => {
        if (!assigningGroup) return;
        const isMember = groupMembers.includes(phone);
        if (isMember) {
            await fetch(`/api/marketing/groups/${assigningGroup}/members?phone=${phone}`, { method: 'DELETE' });
            setGroupMembers(m => m.filter(p => p !== phone));
        } else {
            await fetch(`/api/marketing/groups/${assigningGroup}/members`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ phone }),
            });
            setGroupMembers(m => [...m, phone]);
        }
        await load();
    };

    // ── Campaigns ─────────────────────────────────────────────────────────────
    const [cName, setCName] = useState('');
    const [cMessage, setCMessage] = useState('');
    const [cImageUrl, setCImageUrl] = useState('');
    const [cLinkUrl, setCLinkUrl] = useState('');
    const [cGroupId, setCGroupId] = useState('');
    const [cScheduledAt, setCScheduledAt] = useState('');
    const [uploading, setUploading] = useState(false);
    const [creatingCampaign, setCreatingCampaign] = useState(false);

    const handleImageUpload = async (file: File) => {
        setUploading(true);
        try {
            const fd = new FormData();
            fd.append('file', file);
            const res = await fetch('/api/upload', { method: 'POST', body: fd });
            if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? 'Upload failed');
            const { url } = await res.json();
            setCImageUrl(url);
        } catch (e) {
            alert((e as Error).message);
        } finally {
            setUploading(false);
        }
    };

    const createCampaign = async () => {
        if (!cName.trim() || !cMessage.trim()) return;
        setCreatingCampaign(true);
        try {
            await fetch('/api/marketing/campaigns', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    name: cName, message: cMessage,
                    imageUrl: cImageUrl || undefined, linkUrl: cLinkUrl || undefined,
                    targetGroupId: cGroupId || undefined,
                    scheduledAt: cScheduledAt ? new Date(cScheduledAt).toISOString() : undefined,
                }),
            });
            setCName(''); setCMessage(''); setCImageUrl(''); setCLinkUrl(''); setCGroupId(''); setCScheduledAt('');
            await load();
        } finally {
            setCreatingCampaign(false);
        }
    };

    const sendCampaignNow = async (id: string) => {
        if (!confirm('Send this campaign now to its target audience?')) return;
        await fetch(`/api/marketing/campaigns/${id}/send`, { method: 'POST' });
        await load();
    };

    const cancelCampaign = async (id: string) => {
        await fetch(`/api/marketing/campaigns/${id}/cancel`, { method: 'POST' });
        await load();
    };

    // ── Automation Rules ──────────────────────────────────────────────────────
    const [rName, setRName] = useState('');
    const [rKind, setRKind] = useState<'order_ready_uncollected' | 'customer_inactive'>('order_ready_uncollected');
    const [rMinutes, setRMinutes] = useState(20);
    const [rDays, setRDays] = useState(14);
    const [rCampaignId, setRCampaignId] = useState('');

    const createRule = async () => {
        if (!rName.trim() || !rCampaignId) return;
        await fetch('/api/marketing/rules', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                name: rName, triggerKind: rKind, campaignId: rCampaignId,
                triggerParams: rKind === 'order_ready_uncollected' ? { minutes: rMinutes } : { days: rDays },
            }),
        });
        setRName(''); setRCampaignId('');
        await load();
    };

    const toggleRule = async (id: string, enabled: boolean) => {
        await fetch(`/api/marketing/rules/${id}/toggle`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ enabled }),
        });
        await load();
    };

    const deleteRule = async (id: string) => {
        if (!confirm('Delete this automation rule?')) return;
        await fetch(`/api/marketing/rules/${id}`, { method: 'DELETE' });
        await load();
    };

    const activeSubscribers = subscribers.filter(s => !s.optedOutAt);
    const campaignName = (id: string) => campaigns.find(c => c.id === id)?.name ?? id.slice(0, 8);
    const groupName = (id: string | null) => id ? (groups.find(g => g.id === id)?.name ?? id.slice(0, 8)) : 'Everyone';

    return (
        <div className={styles.page}>
            <header className={styles.header}>
                <Link href="/admin" className={styles.back}>← Admin</Link>
                <h1>WhatsApp Marketing</h1>
            </header>

            {/* ── Subscribers & Groups ──────────────────────────────────────── */}
            <section className={styles.section}>
                <h2>Subscribers &amp; Groups</h2>
                <p className={styles.hint}>
                    Opt-in only — {activeSubscribers.length} active subscriber{activeSubscribers.length === 1 ? '' : 's'}.
                    Customers opt in via the checkbox at checkout; add more manually below.
                </p>

                <div className={styles.cardGrid}>
                    <div className={styles.card}>
                        <h3>Add Subscriber</h3>
                        <div className={styles.row}>
                            <input className={styles.input} placeholder="Phone" value={newSubPhone} onChange={e => setNewSubPhone(e.target.value)} />
                            <input className={styles.input} placeholder="Name (optional)" value={newSubName} onChange={e => setNewSubName(e.target.value)} />
                        </div>
                        <button className={styles.btn} onClick={addSubscriber}>Add</button>
                    </div>

                    <div className={styles.card}>
                        <h3>Create Group</h3>
                        <div className={styles.row}>
                            <input className={styles.input} placeholder="Group name" value={newGroupName} onChange={e => setNewGroupName(e.target.value)} />
                        </div>
                        <button className={styles.btn} onClick={createGroup}>Create</button>
                    </div>
                </div>

                <h3 className={styles.subheading}>Groups</h3>
                <div className={styles.cardGrid}>
                    {groups.map(g => (
                        <div key={g.id} className={styles.card}>
                            <div className={styles.rowBetween}>
                                <strong>{g.name}</strong>
                                <button className={styles.linkBtn} onClick={() => deleteGroup(g.id)}>Delete</button>
                            </div>
                            <p className={styles.hint}>{g.memberCount} member{g.memberCount === 1 ? '' : 's'}</p>
                            <button className={styles.btnSecondary} onClick={() => openGroupAssign(g.id)}>
                                {assigningGroup === g.id ? 'Editing members…' : 'Manage members'}
                            </button>
                            {assigningGroup === g.id && (
                                <div className={styles.memberList}>
                                    {activeSubscribers.length === 0 && <p className={styles.hint}>No subscribers yet.</p>}
                                    {activeSubscribers.map(s => (
                                        <label key={s.phone} className={styles.memberRow}>
                                            <input type="checkbox" checked={groupMembers.includes(s.phone)} onChange={() => toggleMember(s.phone)} />
                                            +{s.phone} {s.name ? `(${s.name})` : ''}
                                        </label>
                                    ))}
                                </div>
                            )}
                        </div>
                    ))}
                    {groups.length === 0 && <p className={styles.empty}>No groups yet — campaigns without a group target everyone.</p>}
                </div>

                <h3 className={styles.subheading}>All Subscribers</h3>
                {loading ? <p className={styles.empty}>Loading…</p> : subscribers.length === 0 ? (
                    <p className={styles.empty}>No subscribers yet.</p>
                ) : (
                    <table className={styles.table}>
                        <thead><tr><th>Phone</th><th>Name</th><th>Status</th><th>Source</th><th>Subscribed</th><th></th></tr></thead>
                        <tbody>
                            {subscribers.map(s => (
                                <tr key={s.phone}>
                                    <td>+{s.phone}</td>
                                    <td>{s.name ?? '—'}</td>
                                    <td className={s.optedOutAt ? styles.blocked : styles.ok}>{s.optedOutAt ? 'Opted out' : 'Active'}</td>
                                    <td>{s.source ?? '—'}</td>
                                    <td className={styles.hint}>{relTime(s.subscribedAt)}</td>
                                    <td><button className={styles.linkBtn} onClick={() => removeSubscriber(s.phone)}>Remove</button></td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                )}
            </section>

            {/* ── Campaigns ─────────────────────────────────────────────────── */}
            <section className={styles.section}>
                <h2>Campaigns</h2>
                <p className={styles.hint}>Reusable content (message + image + link) targeted at everyone or a specific group.</p>

                <div className={styles.card}>
                    <h3>New Campaign</h3>
                    <div className={styles.row}>
                        <input className={styles.input} placeholder="Campaign name" value={cName} onChange={e => setCName(e.target.value)} />
                    </div>
                    <textarea className={styles.textarea} rows={3} placeholder="Message" value={cMessage} onChange={e => setCMessage(e.target.value)} />
                    <div className={styles.row}>
                        <input className={styles.input} placeholder="Link (optional)" value={cLinkUrl} onChange={e => setCLinkUrl(e.target.value)} />
                        <select className={styles.input} value={cGroupId} onChange={e => setCGroupId(e.target.value)}>
                            <option value="">Everyone</option>
                            {groups.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
                        </select>
                    </div>
                    <div className={styles.row}>
                        <input
                            type="file" accept="image/*"
                            onChange={e => e.target.files?.[0] && handleImageUpload(e.target.files[0])}
                        />
                        {uploading && <span className={styles.hint}>Uploading…</span>}
                        {cImageUrl && <span className={styles.hint}>✓ image attached</span>}
                    </div>
                    <div className={styles.row}>
                        <label className={styles.hint}>
                            Schedule for later (optional):&nbsp;
                            <input type="datetime-local" value={cScheduledAt} onChange={e => setCScheduledAt(e.target.value)} />
                        </label>
                    </div>
                    <button className={styles.btn} onClick={createCampaign} disabled={creatingCampaign || !cName.trim() || !cMessage.trim()}>
                        {creatingCampaign ? 'Creating…' : cScheduledAt ? 'Schedule Campaign' : 'Save as Draft'}
                    </button>
                </div>

                <h3 className={styles.subheading}>All Campaigns</h3>
                {campaigns.length === 0 ? <p className={styles.empty}>No campaigns yet.</p> : (
                    <table className={styles.table}>
                        <thead><tr><th>Name</th><th>Target</th><th>Status</th><th>Sent / Failed</th><th></th></tr></thead>
                        <tbody>
                            {campaigns.map(c => (
                                <tr key={c.id}>
                                    <td>{c.name}</td>
                                    <td>{groupName(c.targetGroupId)}</td>
                                    <td className={c.status === 'sent' ? styles.ok : c.status === 'cancelled' ? styles.blocked : undefined}>{c.status}</td>
                                    <td>{c.sentCount} / {c.failedCount}</td>
                                    <td className={styles.row}>
                                        {c.status === 'draft' && <button className={styles.linkBtn} onClick={() => sendCampaignNow(c.id)}>Send now</button>}
                                        {(c.status === 'draft' || c.status === 'scheduled') && <button className={styles.linkBtn} onClick={() => cancelCampaign(c.id)}>Cancel</button>}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                )}
            </section>

            {/* ── Automation Rules ──────────────────────────────────────────── */}
            <section className={styles.section}>
                <h2>Automation Rules</h2>
                <p className={styles.hint}>Fires a campaign automatically — at most once per order or customer.</p>

                <div className={styles.card}>
                    <h3>New Rule</h3>
                    <div className={styles.row}>
                        <input className={styles.input} placeholder="Rule name" value={rName} onChange={e => setRName(e.target.value)} />
                        <select className={styles.input} value={rKind} onChange={e => setRKind(e.target.value as typeof rKind)}>
                            <option value="order_ready_uncollected">Order ready &amp; uncollected</option>
                            <option value="customer_inactive">Customer inactive (win-back)</option>
                        </select>
                    </div>
                    <div className={styles.row}>
                        {rKind === 'order_ready_uncollected' ? (
                            <label className={styles.hint}>After&nbsp;
                                <input type="number" min={1} className={styles.inputSmall} value={rMinutes} onChange={e => setRMinutes(parseInt(e.target.value, 10) || 1)} />
                                &nbsp;minutes uncollected
                            </label>
                        ) : (
                            <label className={styles.hint}>After&nbsp;
                                <input type="number" min={1} className={styles.inputSmall} value={rDays} onChange={e => setRDays(parseInt(e.target.value, 10) || 1)} />
                                &nbsp;days inactive
                            </label>
                        )}
                        <select className={styles.input} value={rCampaignId} onChange={e => setRCampaignId(e.target.value)}>
                            <option value="">Select campaign to fire…</option>
                            {campaigns.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                        </select>
                    </div>
                    <button className={styles.btn} onClick={createRule} disabled={!rName.trim() || !rCampaignId}>Create Rule</button>
                </div>

                {rules.length === 0 ? <p className={styles.empty}>No automation rules yet.</p> : (
                    <table className={styles.table}>
                        <thead><tr><th>Name</th><th>Trigger</th><th>Campaign</th><th>Fired</th><th>Enabled</th><th></th></tr></thead>
                        <tbody>
                            {rules.map(r => (
                                <tr key={r.id}>
                                    <td>{r.name}</td>
                                    <td>{r.triggerKind === 'order_ready_uncollected' ? `${r.triggerParams.minutes ?? 20}min uncollected` : `${r.triggerParams.days ?? 14}d inactive`}</td>
                                    <td>{campaignName(r.campaignId)}</td>
                                    <td>{r.firedCount}</td>
                                    <td>
                                        <input type="checkbox" checked={r.enabled} onChange={e => toggleRule(r.id, e.target.checked)} />
                                    </td>
                                    <td><button className={styles.linkBtn} onClick={() => deleteRule(r.id)}>Delete</button></td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                )}
            </section>
        </div>
    );
}
