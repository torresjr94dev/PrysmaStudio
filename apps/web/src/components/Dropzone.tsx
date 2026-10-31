import { useId, useState, type DragEvent } from "react";

interface Props {
  accept: string;
  multiple: boolean;
  label: string;
  onFiles: (files: File[]) => void;
  compact?: boolean;
}

function matchesAccept(file: File, accept: string): boolean {
  const rules = accept.split(",").map((rule) => rule.trim().toLowerCase());
  const name = file.name.toLowerCase();
  return rules.some((rule) => (rule.startsWith(".") ? name.endsWith(rule) : file.type === rule));
}

export function Dropzone({ accept, multiple, label, onFiles, compact = false }: Props) {
  const id = useId();
  const [dragging, setDragging] = useState(false);
  const [rejected, setRejected] = useState<string | null>(null);

  const deliver = (files: File[]) => {
    const accepted = files.filter((file) => matchesAccept(file, accept));
    const skipped = files.length - accepted.length;
    setRejected(skipped > 0 ? `Se ignoraron ${skipped} archivo(s) de un tipo no compatible.` : null);
    if (accepted.length > 0) onFiles(multiple ? accepted : accepted.slice(0, 1));
  };

  const onDrop = (event: DragEvent<HTMLLabelElement>) => {
    event.preventDefault();
    setDragging(false);
    deliver(Array.from(event.dataTransfer.files));
  };

  return (
    <div>
      <label
        htmlFor={id}
        className={`dropzone${dragging ? " is-dragging" : ""}${compact ? " is-compact" : ""}`}
        onDragOver={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
      >
        <span className="dropzone-title">{label}</span>
        {!compact && <span className="dropzone-hint">o arrástralos aquí</span>}
        <input
          id={id}
          type="file"
          accept={accept}
          multiple={multiple}
          className="visually-hidden"
          onChange={(event) => {
            deliver(Array.from(event.currentTarget.files ?? []));
            event.currentTarget.value = "";
          }}
        />
      </label>
      {rejected && (
        <p className="notice is-warning" role="status">
          {rejected}
        </p>
      )}
    </div>
  );
}
