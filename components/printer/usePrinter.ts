'use client';

import { useEffect, useState, useCallback } from 'react';
import { getPrinterClient } from '@/lib/bluetoothPrinter';
import type { Order } from '@/lib/localDb';

/**
 * Subscribes to the singleton printer client. The connection survives
 * remounts (the client is a module-level singleton), so multiple components
 * can share one connection.
 *
 * The hook just routes to the client's high-level methods — those internally
 * pick ESC/POS or cat-printer protocol based on what the connected device
 * actually speaks.
 */
export function usePrinter() {
    const client = getPrinterClient();
    const [, force] = useState(0);

    useEffect(() => {
        return client.onChange(() => force(n => n + 1));
    }, [client]);

    const connect = useCallback(async () => { await client.connect(); }, [client]);
    const connectShowAll = useCallback(async () => { await client.connectShowAll(); }, [client]);
    const disconnect = useCallback(async () => { await client.disconnect(); }, [client]);

    const printTest = useCallback(async (restaurantName: string) => {
        await client.printTest(restaurantName);
    }, [client]);

    const printKOT = useCallback(async (order: Order, restaurantName: string) => {
        await client.printKOT(order, restaurantName);
    }, [client]);

    const printBill = useCallback(async (order: Order, restaurantName: string) => {
        await client.printBill(order, restaurantName);
    }, [client]);

    const printStats = useCallback(async (orders: Order[], restaurantName: string) => {
        await client.printStats(orders, restaurantName);
    }, [client]);

    return {
        isSupported: client.isSupported(),
        isConnected: client.isConnected(),
        deviceName: client.name(),
        protocol: client.getProtocol(),
        diagnostics: client.getDiagnostics(),
        connect,
        connectShowAll,
        disconnect,
        printTest,
        printKOT,
        printBill,
        printStats,
    };
}
