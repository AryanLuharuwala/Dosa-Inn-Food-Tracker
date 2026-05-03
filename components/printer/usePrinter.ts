'use client';

import { useEffect, useState, useCallback } from 'react';
import { getPrinterClient, buildKOT, buildBill, buildTestPrint, buildDailyStats } from '@/lib/bluetoothPrinter';
import type { Order } from '@/lib/localDb';

/**
 * Subscribes to the singleton printer client. The connection survives
 * remounts (the client is a module-level singleton), so multiple components
 * can share one connection.
 */
export function usePrinter() {
    const client = getPrinterClient();
    const [, force] = useState(0);

    useEffect(() => {
        return client.onChange(() => force(n => n + 1));
    }, [client]);

    const connect = useCallback(async () => { await client.connect(); }, [client]);
    const disconnect = useCallback(async () => { await client.disconnect(); }, [client]);

    const printTest = useCallback(async (restaurantName: string) => {
        await client.write(buildTestPrint(restaurantName));
    }, [client]);

    const printKOT = useCallback(async (order: Order, restaurantName: string) => {
        await client.write(buildKOT(order, restaurantName));
    }, [client]);

    const printBill = useCallback(async (order: Order, restaurantName: string) => {
        await client.write(buildBill(order, restaurantName));
    }, [client]);

    const printStats = useCallback(async (orders: Order[], restaurantName: string) => {
        await client.write(buildDailyStats(orders, restaurantName));
    }, [client]);

    return {
        isSupported: client.isSupported(),
        isConnected: client.isConnected(),
        deviceName: client.name(),
        diagnostics: client.getDiagnostics(),
        connect,
        disconnect,
        printTest,
        printKOT,
        printBill,
        printStats,
    };
}
