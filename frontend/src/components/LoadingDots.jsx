import React, { useEffect, useState } from 'react';

// Animación: el primer punto aparece fijo, los otros dos aparecen uno tras otro
export default function LoadingDots({ className = '' }) {
  const [step, setStep] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => {
      setStep((prev) => (prev + 1) % 3);
    }, 400);
    return () => clearInterval(interval);
  }, []);

  // El primer punto siempre está, el segundo y tercero aparecen según el step
  return (
    <span className={className} aria-label="Cargando">
      .{step > 0 ? '.' : ''}{step > 1 ? '.' : ''}
    </span>
  );
}
