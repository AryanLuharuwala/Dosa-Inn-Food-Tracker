'use client';

// Standalone pricing route — same component used inside /admin's Menu tab.
// Kept as a back-compatible deep link.
import PricingTable from '@/components/pricing/PricingTable';

export default function PricingPage() {
    return <PricingTable showHeader={true} backHref="/admin" />;
}
