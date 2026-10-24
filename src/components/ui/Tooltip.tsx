"use client";

import { useState, useRef } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";

interface TooltipProps {
    text: string;
    children: React.ReactNode;
    side?: "right" | "top" | "bottom" | "left";
    offset?: number;
}

export function Tooltip({ text, children, side = "right", offset = 10 }: TooltipProps) {
    const [isVisible, setIsVisible] = useState(false);
    const [coords, setCoords] = useState({ top: 0, left: 0 });
    const triggerRef = useRef<HTMLDivElement>(null);

    const updatePosition = () => {
        if (!triggerRef.current) return;
        const rect = triggerRef.current.getBoundingClientRect();

        let top = 0;
        let left = 0;

        switch (side) {
            case "right":
                top = rect.top + rect.height / 2;
                left = rect.right + offset;
                break;
            case "left":
                top = rect.top + rect.height / 2;
                left = rect.left - offset;
                break;
            case "top":
                top = rect.top - offset;
                left = rect.left + rect.width / 2;
                break;
            case "bottom":
                top = rect.bottom + offset;
                left = rect.left + rect.width / 2;
                break;
        }

        setCoords({ top, left });
    };

    return (
        <div
            ref={triggerRef}
            onMouseEnter={() => {
                updatePosition();
                setIsVisible(true);
            }}
            onMouseLeave={() => setIsVisible(false)}
            className="relative flex items-center justify-center"
        >
            {children}
            {isVisible && typeof document !== "undefined" && createPortal(
                <AnimatePresence>
                    {isVisible && (
                        <motion.div
                            initial={{ opacity: 0, scale: 0.9, x: side === "right" ? -10 : 0 }}
                            animate={{ opacity: 1, scale: 1, x: 0 }}
                            exit={{ opacity: 0, scale: 0.9 }}
                            transition={{ duration: 0.15, ease: "easeOut" }}
                            style={{
                                position: "fixed",
                                top: coords.top,
                                left: coords.left,
                                transform: side === "right" || side === "left" ? "translateY(calc(-50% - 6px))" : "translateX(-50%)",
                                zIndex: 9999,
                                pointerEvents: "none"
                            }}
                        >
                            <div className="bg-slate-900 border border-white/10 text-slate-200 text-sm font-medium px-3 py-1.5 rounded-lg shadow-xl whitespace-nowrap relative">
                                {text}
                                {/* Arrow pointing to trigger */}
                                <div
                                    className="absolute w-2 h-2 bg-slate-900 border-l border-b border-white/10 transform rotate-45"
                                    style={{
                                        left: side === "right" ? "-5px" : "auto",
                                        right: side === "left" ? "-5px" : "auto",
                                        top: side === "right" || side === "left" ? "calc(50% + 6px)" : "50%",
                                        marginTop: "-4px",
                                        display: side === "right" || side === "left" ? "block" : "none"
                                    }}
                                />
                            </div>
                        </motion.div>
                    )}
                </AnimatePresence>,
                document.body
            )}
        </div>
    );
}
