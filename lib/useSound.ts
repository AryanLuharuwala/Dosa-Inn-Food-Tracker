import { useRef, useEffect, useCallback } from 'react';

export function useSound(src: string, volume = 0.6) {
    const ref = useRef<HTMLAudioElement | null>(null);
    useEffect(() => {
        ref.current = new Audio(src);
        ref.current.volume = volume;
    }, [src, volume]);
    return useCallback(() => ref.current?.play().catch(() => {}), []);
}
