import { motion, useSpring, useTransform } from "motion/react";
import { useEffect } from "react";

interface Props {
  /** 0..1 */
  value: number;
  stage: string;
  onCancel: () => void;
}

const clamp = (value: number) => Math.min(1, Math.max(0, value));

/**
 * Progreso con cifra «viva»: un resorte sigue al valor real, así el porcentaje avanza de forma fluida
 * en lugar de saltar. motion escribe el texto y el scaleX directamente en el DOM, sin re-renderizar.
 */
export function Progress({ value, stage, onCancel }: Props) {
  const spring = useSpring(0, { stiffness: 120, damping: 26, mass: 0.6 });
  useEffect(() => {
    spring.set(clamp(value));
  }, [spring, value]);
  const percent = useTransform(spring, (current) => Math.round(clamp(current) * 100));
  const scaleX = useTransform(spring, (current) => Math.max(0.01, clamp(current)));

  return (
    <div className="progress">
      <div className="progress-head">
        <span aria-live="polite">{stage}…</span>
        <span className="progress-value" aria-hidden="true">
          <motion.span>{percent}</motion.span> %
        </span>
      </div>
      <div className="progress-track" role="progressbar" aria-label={stage} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(clamp(value) * 100)}>
        <motion.div className="progress-fill" style={{ scaleX }} />
      </div>
      <button type="button" className="button is-ghost is-block" onClick={onCancel}>
        Cancelar
      </button>
    </div>
  );
}
