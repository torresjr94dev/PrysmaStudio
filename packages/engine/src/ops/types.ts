/** Callback de progreso: `progress` en [0, 1] y una etapa legible para el usuario. */
export type Report = (progress: number, stage: string) => void;
