/**
 * BorderPay Logo — uses the actual PNG asset uploaded by the brand
 * color prop controls: '#000000' = dark version (on light/lime bg), '#ffffff' = light version (on dark bg)
 * On dark backgrounds the PNG is inverted to white using CSS filter
 */
import React from 'react';

interface BorderPayLogoProps {
  color?: string;
  size?: number;
  className?: string;
}

export function BorderPayLogo({ color = '#000000', size = 36, className }: BorderPayLogoProps) {
  const isWhite = color === '#ffffff' || color === '#fff' || color === 'white';

  return (
    <img
      src="/logo.png"
      alt="BorderPay"
      width={size}
      height={size}
      className={className}
      style={{
        flexShrink: 0,
        objectFit: 'contain',
        filter: isWhite ? 'invert(1)' : 'none',
      }}
    />
  );
}
