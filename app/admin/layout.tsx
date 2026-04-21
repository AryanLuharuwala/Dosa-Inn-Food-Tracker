import React from 'react';

export default function AdminLayout({ children }: { children: React.ReactNode }) {
    // Auth guard handled by middleware.ts
    return <section>{children}</section>;
}
