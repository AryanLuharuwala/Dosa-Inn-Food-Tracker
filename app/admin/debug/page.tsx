'use client';

import React, { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import styles from './page.module.css';

interface DebugEvent {
    id: string;
    timestamp: string;
    type: 'order_add' | 'whatsapp_send';
    phone?: string;
    ip?: string;
    allowed: boolean;
    reason: string;
}

type AutoReplyMode = 'off' | 'test_only' | 'live';
type MatchType = 'exact' | 'contains';
type ResponseType = 'start_order_flow' | 'text';

interface AutoReplyRule {
    id: string;
    keyword: string;
    matchType: MatchType;
    responseType: ResponseType;
    responseText: string | null;
    responseImageUrl: string | null;
    enabled: boolean;
    createdAt: string;
}

function relTime(iso: string): string {
    const ms = Date.now() - new Date(iso).getTime();
    if (ms < 10_000) return 'just now';
    if (ms < 60_000) return `${Math.round(ms / 1000)}s ago`;
    if (ms < 3_600_000) return `${Math.round(ms / 60_000)}m ago`;
    return `${Math.round(ms / 3_600_000)}h ago`;
}

export default function DebugPage() {
    const [events, setEvents] = useState<DebugEvent[]>([]);
    const [personalNumbers, setPersonalNumbers] = useState<string[]>([]);
    const [loading, setLoading] = useState(true);

    const [phoneInput, setPhoneInput] = useState('');
    const [savingPhones, setSavingPhones] = useState(false);
    const [savedPhones, setSavedPhones] = useState(false);

    const [testTo, setTestTo] = useState('');
    const [testMessage, setTestMessage] = useState('This is a test message from the Rocky Da Adda debug panel.');
    const [sending, setSending] = useState(false);
    const [sendResult, setSendResult] = useState<string | null>(null);

    const [mode, setMode] = useState<AutoReplyMode>('off');
    const [savingMode, setSavingMode] = useState(false);

    const [rules, setRules] = useState<AutoReplyRule[]>([]);
    const [newKeyword, setNewKeyword] = useState('');
    const [newMatchType, setNewMatchType] = useState<MatchType>('exact');
    const [newResponseType, setNewResponseType] = useState<ResponseType>('start_order_flow');
    const [newResponseText, setNewResponseText] = useState('');
    const [savingRule, setSavingRule] = useState(false);
    const [ruleError, setRuleError] = useState<string | null>(null);

    const [flowTo, setFlowTo] = useState('');
    const [startingFlow, setStartingFlow] = useState(false);
    const [flowResult, setFlowResult] = useState<string | null>(null);

    const load = useCallback(async () => {
        const [debugRes, settingsRes, rulesRes] = await Promise.all([
            fetch('/api/debug'),
            fetch('/api/db?resource=settings'),
            fetch('/api/whatsapp/auto-replies'),
        ]);
        if (debugRes.ok) {
            const data = await debugRes.json();
            setEvents(data.events ?? []);
            setPersonalNumbers(data.personalNumbers ?? []);
        }
        if (settingsRes.ok) {
            const data = await settingsRes.json();
            setMode((data.whatsappAutoReplyMode as AutoReplyMode) ?? 'off');
        }
        if (rulesRes.ok) {
            const data = await rulesRes.json();
            setRules(data.rules ?? []);
        }
        setLoading(false);
    }, []);

    useEffect(() => {
        load();
        const t = setInterval(load, 5000);
        return () => clearInterval(t);
    }, [load]);

    const handleModeChange = async (next: AutoReplyMode) => {
        setMode(next);
        setSavingMode(true);
        await fetch('/api/db', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'settings_save', settings: { whatsappAutoReplyMode: next } }),
        });
        setSavingMode(false);
    };

    const handleCreateRule = async () => {
        setSavingRule(true);
        setRuleError(null);
        try {
            const res = await fetch('/api/whatsapp/auto-replies', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    keyword: newKeyword,
                    matchType: newMatchType,
                    responseType: newResponseType,
                    responseText: newResponseType === 'text' ? newResponseText : undefined,
                }),
            });
            const data = await res.json();
            if (!res.ok) {
                setRuleError(data.error ?? 'Failed to create rule');
                return;
            }
            setNewKeyword('');
            setNewResponseText('');
            await load();
        } finally {
            setSavingRule(false);
        }
    };

    const handleToggleRule = async (id: string, enabled: boolean) => {
        await fetch('/api/whatsapp/auto-replies', {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id, enabled }),
        });
        await load();
    };

    const handleDeleteRule = async (id: string) => {
        await fetch(`/api/whatsapp/auto-replies?id=${encodeURIComponent(id)}`, { method: 'DELETE' });
        await load();
    };

    const handleStartTestFlow = async () => {
        setStartingFlow(true);
        setFlowResult(null);
        try {
            const res = await fetch('/api/whatsapp/test-order-flow', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ to: flowTo }),
            });
            const data = await res.json();
            setFlowResult(res.ok ? 'Category poll sent — check the target phone.' : `Blocked: ${data.error}`);
        } catch {
            setFlowResult('Request failed.');
        } finally {
            setStartingFlow(false);
        }
    };

    const handleSavePhones = async () => {
        setSavingPhones(true);
        setSavedPhones(false);
        await fetch('/api/settings', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ DEBUG_TEST_PHONES: phoneInput }),
        });
        await load();
        setSavingPhones(false);
        setSavedPhones(true);
        setPhoneInput('');
    };

    const handleTestSend = async () => {
        setSending(true);
        setSendResult(null);
        try {
            const res = await fetch('/api/debug', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'test_send', to: testTo, message: testMessage }),
            });
            const data = await res.json();
            setSendResult(res.ok ? 'Request accepted — see the live activity log below for the actual outcome.' : `Blocked: ${data.error}`);
        } catch {
            setSendResult('Request failed.');
        } finally {
            setSending(false);
            await load();
        }
    };

    return (
        <div className={styles.page}>
            <header className={styles.header}>
                <Link href="/admin" className={styles.back}>← Admin</Link>
                <h1>Debug</h1>
            </header>

            <section className={styles.card}>
                <h2>Your personal test numbers</h2>
                <p className={styles.hint}>
                    Test sends below only ever go to numbers registered here — this panel can never message a real
                    customer or stranger, even by mistake.
                </p>
                <div className={styles.numberList}>
                    {personalNumbers.length === 0 ? (
                        <span className={styles.empty}>None registered yet.</span>
                    ) : (
                        personalNumbers.map(n => <span key={n} className={styles.numberChip}>+{n}</span>)
                    )}
                </div>
                <div className={styles.row}>
                    <input
                        type="text"
                        value={phoneInput}
                        onChange={e => setPhoneInput(e.target.value)}
                        placeholder="Add number(s), comma-separated e.g. 91XXXXXXXXXX"
                        className={styles.input}
                    />
                    <button className={styles.btn} onClick={handleSavePhones} disabled={savingPhones || !phoneInput.trim()}>
                        {savingPhones ? 'Saving…' : savedPhones ? 'Saved!' : 'Save'}
                    </button>
                </div>
            </section>

            <section className={styles.card}>
                <h2>WhatsApp bot mode</h2>
                <p className={styles.hint}>
                    Controls the poll-based ordering bot and keyword auto-replies below. <strong>Off</strong> never
                    responds to anyone — not even the test tools on this page. <strong>Test only</strong> responds
                    only to your registered personal numbers above. <strong>Live</strong> responds to any real inbound message.
                </p>
                <div className={styles.row}>
                    {(['off', 'test_only', 'live'] as AutoReplyMode[]).map(m => (
                        <button
                            key={m}
                            className={styles.btn}
                            style={{ background: mode === m ? '#15803d' : '#334155', opacity: savingMode ? 0.6 : 1 }}
                            onClick={() => handleModeChange(m)}
                            disabled={savingMode}
                        >
                            {m === 'off' ? 'Off' : m === 'test_only' ? 'Test only' : 'Live'}
                        </button>
                    ))}
                </div>
            </section>

            <section className={styles.card}>
                <h2>Trigger words</h2>
                <p className={styles.hint}>
                    What word matches what it responds with. A <em>start order flow</em> reply sends the category poll
                    and begins a real ordering conversation; a <em>text</em> reply just sends back a fixed message.
                </p>
                {rules.length === 0 ? (
                    <p className={styles.empty}>No trigger words yet.</p>
                ) : (
                    <table className={styles.table}>
                        <thead>
                            <tr>
                                <th>Keyword</th>
                                <th>Match</th>
                                <th>Response</th>
                                <th>Enabled</th>
                                <th></th>
                            </tr>
                        </thead>
                        <tbody>
                            {rules.map(r => (
                                <tr key={r.id}>
                                    <td>{r.keyword}</td>
                                    <td className={styles.phone}>{r.matchType}</td>
                                    <td>{r.responseType === 'start_order_flow' ? 'Start order flow' : r.responseText}</td>
                                    <td>
                                        <button className={styles.btn} onClick={() => handleToggleRule(r.id, !r.enabled)}>
                                            {r.enabled ? 'Enabled' : 'Disabled'}
                                        </button>
                                    </td>
                                    <td>
                                        <button className={styles.btn} style={{ background: '#7f1d1d' }} onClick={() => handleDeleteRule(r.id)}>
                                            Delete
                                        </button>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                )}

                <div className={styles.row} style={{ marginTop: 14 }}>
                    <input
                        type="text"
                        value={newKeyword}
                        onChange={e => setNewKeyword(e.target.value)}
                        placeholder="Keyword, e.g. menu"
                        className={styles.input}
                    />
                    <select className={styles.input} value={newMatchType} onChange={e => setNewMatchType(e.target.value as MatchType)}>
                        <option value="exact">Exact match</option>
                        <option value="contains">Contains</option>
                    </select>
                    <select className={styles.input} value={newResponseType} onChange={e => setNewResponseType(e.target.value as ResponseType)}>
                        <option value="start_order_flow">Start order flow</option>
                        <option value="text">Text reply</option>
                    </select>
                </div>
                {newResponseType === 'text' && (
                    <div className={styles.row}>
                        <textarea
                            value={newResponseText}
                            onChange={e => setNewResponseText(e.target.value)}
                            className={styles.textarea}
                            placeholder="Reply text"
                            rows={2}
                        />
                    </div>
                )}
                <button className={styles.btn} onClick={handleCreateRule} disabled={savingRule || !newKeyword.trim()}>
                    {savingRule ? 'Adding…' : 'Add trigger word'}
                </button>
                {ruleError && <p className={styles.result}>{ruleError}</p>}
            </section>

            <section className={styles.card}>
                <h2>Test order flow now</h2>
                <p className={styles.hint}>
                    Manually starts the same poll-ordering conversation a trigger word would, without needing to text
                    it yourself. Still gated by the bot mode above — set it to Test only (or Live) first.
                </p>
                <div className={styles.row}>
                    <input
                        type="text"
                        value={flowTo}
                        onChange={e => setFlowTo(e.target.value)}
                        placeholder="Phone number to start the flow for"
                        className={styles.input}
                    />
                    <button className={styles.btn} onClick={handleStartTestFlow} disabled={startingFlow || !flowTo.trim()}>
                        {startingFlow ? 'Starting…' : 'Start order flow'}
                    </button>
                </div>
                {flowResult && <p className={styles.result}>{flowResult}</p>}
            </section>

            <section className={styles.card}>
                <h2>Send yourself a test message</h2>
                <p className={styles.hint}>Verifies the whole pipeline — rate limiter → WhatsApp service → your phone.</p>
                <div className={styles.row}>
                    <input
                        type="text"
                        value={testTo}
                        onChange={e => setTestTo(e.target.value)}
                        placeholder="Your registered number"
                        className={styles.input}
                    />
                </div>
                <div className={styles.row}>
                    <textarea
                        value={testMessage}
                        onChange={e => setTestMessage(e.target.value)}
                        className={styles.textarea}
                        rows={2}
                    />
                </div>
                <button className={styles.btn} onClick={handleTestSend} disabled={sending || !testTo.trim() || !testMessage.trim()}>
                    {sending ? 'Sending…' : 'Send test message'}
                </button>
                {sendResult && <p className={styles.result}>{sendResult}</p>}
            </section>

            <section className={styles.card}>
                <div className={styles.rowBetween}>
                    <h2>Live activity</h2>
                    <span className={styles.hint}>Auto-refreshes every 5s</span>
                </div>
                <p className={styles.hint}>
                    Every order placed and every WhatsApp send attempt — including ones blocked by the rate limiter —
                    shows up here with the actual phone number involved, so you can see exactly what the system did.
                </p>
                {loading ? (
                    <p className={styles.empty}>Loading…</p>
                ) : events.length === 0 ? (
                    <p className={styles.empty}>No activity yet.</p>
                ) : (
                    <table className={styles.table}>
                        <thead>
                            <tr>
                                <th>When</th>
                                <th>Type</th>
                                <th>Phone</th>
                                <th>IP</th>
                                <th>Result</th>
                            </tr>
                        </thead>
                        <tbody>
                            {events.map(e => (
                                <tr key={e.id} className={e.allowed ? '' : styles.blockedRow}>
                                    <td className={styles.time}>{relTime(e.timestamp)}</td>
                                    <td>{e.type === 'order_add' ? 'Order' : 'WhatsApp'}</td>
                                    <td className={styles.phone}>{e.phone ? `+${e.phone}` : '—'}</td>
                                    <td className={styles.ip}>{e.ip ?? '—'}</td>
                                    <td className={e.allowed ? styles.ok : styles.blocked}>{e.reason}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                )}
            </section>
        </div>
    );
}
