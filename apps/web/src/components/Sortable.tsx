import {
  DndContext,
  DragOverlay,
  MouseSensor,
  TouchSensor,
  closestCenter,
  useSensor,
  useSensors,
  type Announcements,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { SortableContext, rectSortingStrategy, useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { motion } from "motion/react";
import { createContext, useContext, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";

/**
 * Reordenamiento con dnd-kit: los vecinos se apartan con una transición, la ficha viaja en una capa
 * propia (DragOverlay) con elevación y un giro de 2° (resorte 300/20) y hay auto-scroll. El teclado
 * (Alt+flechas) y los botones de cada ficha siguen siendo la alternativa accesible; no se usa el sensor
 * de teclado de dnd-kit porque las flechas ya navegan la cuadrícula.
 */

interface DragState {
  key: string;
  /** Claves que viajan juntas: la arrastrada y, si estaba seleccionada, el resto de la selección. */
  moving: ReadonlySet<string>;
  /** Punto del cursor dentro de la ficha al tomarla: el contador se pega ahí. */
  grab: { x: number; y: number };
  /** true mientras dnd-kit anima la ficha de vuelta a su sitio al soltarla. */
  dropping: boolean;
}

interface GridContextValue {
  drag: DragState | null;
  /** El clic que el navegador dispara justo después de soltar no debe cambiar la selección. */
  justDropped: () => boolean;
}

const GridContext = createContext<GridContextValue>({ drag: null, justDropped: () => false });

interface Props {
  keys: string[];
  disabled: boolean;
  /** Claves seleccionadas: arrastrar una de ellas mueve todas. */
  selected?: ReadonlySet<string>;
  /** `insertAt` es un índice en la lista ORIGINAL (0..length), como en moveItems. */
  onMove: (moving: Set<string>, insertAt: number) => void;
  /** Etiqueta accesible de una ficha: «Página 3», «2. informe.pdf». */
  labelOf: (key: string) => string;
  /** «3 páginas», para los anuncios a lectores de pantalla. */
  describe: (count: number) => string;
  /** Copia visual de la ficha que viaja con el cursor (sin hooks de dnd-kit). */
  renderOverlay: (key: string) => ReactNode;
  children: ReactNode;
}

const DROP_MS = 220;

function pointOf(event: Event | null): { x: number; y: number } | null {
  if (event instanceof MouseEvent) return { x: event.clientX, y: event.clientY };
  if (typeof TouchEvent !== "undefined" && event instanceof TouchEvent) {
    const touch = event.touches[0];
    return touch ? { x: touch.clientX, y: touch.clientY } : null;
  }
  return null;
}

export function SortableGrid({ keys, disabled, selected, onMove, labelOf, describe, renderOverlay, children }: Props) {
  const [drag, setDrag] = useState<DragState | null>(null);
  const droppedAt = useRef(0);
  const timer = useRef(0);
  const sensors = useSensors(
    // Distancia mínima antes de arrastrar: un clic normal sigue seleccionando o girando la página.
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    // En táctil, mantener pulsado; así el desplazamiento de la página sigue funcionando.
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 8 } }),
  );

  useEffect(() => () => window.clearTimeout(timer.current), []);

  const movingFor = (key: string): Set<string> =>
    selected?.has(key) && selected.size > 1 ? new Set(keys.filter((item) => selected.has(item))) : new Set([key]);

  const finish = () => {
    droppedAt.current = Date.now();
    // La ficha sigue montada en la capa mientras dnd-kit la devuelve a su sitio; el resorte la endereza.
    setDrag((current) => (current ? { ...current, dropping: true } : null));
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setDrag(null), DROP_MS + 40);
  };

  const onDragStart = ({ active, activatorEvent }: DragStartEvent) => {
    const key = String(active.id);
    const rect = active.rect.current.initial;
    const point = pointOf(activatorEvent);
    const grab = rect && point ? { x: point.x - rect.left, y: point.y - rect.top } : { x: 0, y: 0 };
    setDrag({ key, moving: movingFor(key), grab, dropping: false });
  };

  const onDragEnd = ({ active, over }: DragEndEvent) => {
    const key = String(active.id);
    const moving = new Set(drag?.moving ?? movingFor(key));
    if (over && over.id !== active.id) {
      const from = keys.indexOf(key);
      const to = keys.indexOf(String(over.id));
      if (from !== -1 && to !== -1) onMove(moving, to > from ? to + 1 : to);
    }
    finish();
  };

  const position = (id: string | number) => keys.indexOf(String(id)) + 1;
  const announcements: Announcements = {
    onDragStart: ({ active }) => {
      const moving = movingFor(String(active.id));
      return moving.size > 1 ? `Tomaste ${describe(moving.size)}.` : `Tomaste ${labelOf(String(active.id))}.`;
    },
    onDragOver: ({ active, over }) =>
      over ? `${labelOf(String(active.id))} está sobre la posición ${position(over.id)}.` : `${labelOf(String(active.id))} no está sobre ninguna posición.`,
    onDragEnd: ({ active, over }) =>
      over ? `Soltaste ${labelOf(String(active.id))} en la posición ${position(over.id)}.` : `Soltaste ${labelOf(String(active.id))} sin moverlo.`,
    onDragCancel: ({ active }) => `Cancelaste el arrastre de ${labelOf(String(active.id))}.`,
  };

  const context = useMemo<GridContextValue>(() => ({ drag, justDropped: () => Date.now() - droppedAt.current < 300 }), [drag]);

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onDragCancel={finish}
      accessibility={{ announcements, screenReaderInstructions: { draggable: "Para mover con el teclado, enfoca la ficha y usa Alt con las flechas." } }}
    >
      <SortableContext items={keys} strategy={rectSortingStrategy} disabled={disabled}>
        <GridContext.Provider value={context}>{children}</GridContext.Provider>
      </SortableContext>
      <DragOverlay dropAnimation={{ duration: DROP_MS, easing: "cubic-bezier(0.16, 1, 0.3, 1)" }} zIndex={60}>
        {drag && (
          <motion.div
            className="drag-overlay"
            initial={{ scale: 1, rotate: 0 }}
            animate={drag.dropping ? { scale: 1, rotate: 0 } : { scale: 1.04, rotate: 2 }}
            transition={{ type: "spring", stiffness: 300, damping: 20 }}
          >
            {renderOverlay(drag.key)}
            {drag.moving.size > 1 && (
              <span className="drag-badge" style={{ left: drag.grab.x + 16, top: drag.grab.y + 16 }} aria-hidden="true">
                {drag.moving.size}
              </span>
            )}
          </motion.div>
        )}
      </DragOverlay>
    </DndContext>
  );
}

/** Props de arrastre para una ficha dentro de SortableGrid. No se usan los `attributes` de dnd-kit: la ficha ya tiene rol, etiqueta y foco propios. */
export function useSortableTile(key: string, disabled: boolean) {
  const { setNodeRef, listeners, transform, transition, isDragging } = useSortable({
    id: key,
    disabled,
    transition: { duration: 220, easing: "cubic-bezier(0.16, 1, 0.3, 1)" },
  });
  const { drag, justDropped } = useContext(GridContext);
  const style: CSSProperties = {};
  const translate = CSS.Translate.toString(transform);
  if (translate) style.transform = translate;
  if (transition) style.transition = transition;
  return { setNodeRef, listeners, style, dimmed: isDragging || (drag?.moving.has(key) ?? false), justDropped };
}
