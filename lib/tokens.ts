export async function getUniqueToken(): Promise<number> {
    try {
        const res = await fetch('/api/db?resource=active_tokens');
        if (!res.ok) throw new Error('fetch failed');
        const active: number[] = await res.json();
        const activeSet = new Set(active);
        if (activeSet.size >= 200) return Math.floor(Math.random() * 200) + 1;
        let token: number;
        do { token = Math.floor(Math.random() * 200) + 1; } while (activeSet.has(token));
        return token;
    } catch {
        return Math.floor(Math.random() * 200) + 1;
    }
}
