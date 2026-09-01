import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { createGameLoadFailureDetail, normalizeGameLoadProgress } from '../utils/gameLoading';
import { LoadingScreen } from './LoadingScreen';

describe('LoadingScreen world bootstrap state', () => {
    it('renders a terminal failure with the original detail and a clean menu recovery route', () => {
        const status = normalizeGameLoadProgress(
            createGameLoadFailureDetail(new Error('Terrain allocation failed')),
        );
        const html = renderToStaticMarkup(<LoadingScreen status={status} />);

        expect(status.failed).toBe(true);
        expect(html).toContain('Realm generation failed');
        expect(html).toContain('Terrain allocation failed');
        expect(html).toContain('World generation stopped');
        expect(html).toContain('Return to main menu');
        expect(html).toContain('href="./"');
        expect(html).toContain('role="alert"');
        expect(html).not.toContain('Live world generation');
    });

    it('keeps successful in-progress loading visually distinct from terminal failure', () => {
        const status = normalizeGameLoadProgress({
            progress: 0.63,
            phase: 'Growing forests',
            detail: 'Placing tree clusters',
            processed: 63,
            total: 100,
        });
        const html = renderToStaticMarkup(<LoadingScreen status={status} />);

        expect(status.failed).toBeUndefined();
        expect(html).toContain('Forging Realm');
        expect(html).toContain('63%');
        expect(html).toContain('Live world generation');
        expect(html).not.toContain('Return to main menu');
    });
});
