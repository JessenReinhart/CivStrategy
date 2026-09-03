import React, { useCallback, useEffect, useRef, useState } from 'react';

interface HudTooltipProps {
    /** Serif kicker line rendered in Cinzel above the body copy. */
    title: React.ReactNode;
    /** Sans-serif body copy (Inter). */
    body?: React.ReactNode;
    /** Placement of the floating panel relative to its trigger. */
    placement?: 'top' | 'bottom';
    /** Child element to enhance without replacing its logic. */
    children: React.ReactNode;
    /** Optional extra classes on the tooltip panel. */
    className?: string;
}

const SHOW_DELAY_MS = 150;

/**
 * Brass-bordered contextual HUD tooltip. It is rendered alongside its trigger,
 * so positioned HUD containers retain control of its placement and stacking.
 * Always renders the tooltip panel to allow opacity fade transitions.
 */
export const HudTooltip: React.FC<HudTooltipProps> = ({
    title,
    body,
    placement = 'top',
    children,
    className = '',
}) => {
    const [open, setOpen] = useState(false);
    const timerRef = useRef<number | null>(null);

    const clearTimer = useCallback(() => {
        if (timerRef.current !== null) {
            window.clearTimeout(timerRef.current);
            timerRef.current = null;
        }
    }, []);

    const show = useCallback(() => {
        clearTimer();
        timerRef.current = window.setTimeout(() => setOpen(true), SHOW_DELAY_MS);
    }, [clearTimer]);

    const hide = useCallback(() => {
        clearTimer();
        setOpen(false);
    }, [clearTimer]);

    useEffect(() => clearTimer, [clearTimer]);

    const tooltipClass = `hud-tooltip ${placement === 'bottom' ? 'hud-tooltip-bottom' : ''} ${open ? 'active' : ''} ${className}`;

    return (
        <span
            className="relative inline-flex"
            onMouseEnter={show}
            onMouseLeave={hide}
            onFocusCapture={show}
            onBlurCapture={hide}
        >
            {children}
            {/* Always render the panel so opacity transitions work. */}
            <span
                role="tooltip"
                className={tooltipClass}
                style={{
                    opacity: open ? 1 : 0,
                    transition: 'opacity 0.15s ease 0s',
                }}
            >
                <span className="hud-tooltip-title">{title}</span>
                {body !== undefined && <span className="hud-tooltip-body">{body}</span>}
            </span>
        </span>
    );
};