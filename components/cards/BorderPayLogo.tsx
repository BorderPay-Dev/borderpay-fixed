/**
 * BorderPay Logo — geometric "b" mark
 * Left: vertical rounded pill, Right: half-circle
 * color prop controls fill: '#000000' on light/lime bg, '#ffffff' on dark bg
 */
import React from 'react';

interface BorderPayLogoProps {
  color?: string;
  size?: number;
  className?: string;
  showRegistered?: boolean;
}

export function BorderPayLogo({ color = '#000000', size = 36, className, showRegistered = true }: BorderPayLogoProps) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 80 110"
      width={size}
      height={size * (110 / 80)}
      className={className}
      style={{ flexShrink: 0 }}
      aria-label="BorderPay"
    >
      {/* Left vertical rounded pill */}
      <rect x="10" y="5" width="24" height="95" rx="12" fill={color} />
      {/* Right half-circle — gap of 4px from left pill */}
      <path
        d="M38 33 A33.5 33.5 0 0 1 38 100 Z"
        fill={color}
      />
      {showRegistered && (
        <g>
          <circle cx="66" cy="16" r="8" fill="none" stroke={color} strokeWidth="1.8" />
          <text x="66" y="20.5" textAnchor="middle" fontSize="12" fontWeight="bold" fontFamily="Arial, sans-serif" fill={color}>R</text>
        </g>
      )}
    </svg>
  );
}
