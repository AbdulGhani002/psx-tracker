type Align = "left" | "right" | "center";

export type Column<T> = {
  key: string;
  header: string;
  align?: Align;
  mono?: boolean;
  width?: string;
  render: (row: T) => React.ReactNode;
};

type Props<T> = {
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  empty?: React.ReactNode;
  onRowClick?: (row: T) => void;
};

export function Table<T>({ columns, rows, rowKey, empty, onRowClick }: Props<T>) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-[13px]">
        <thead>
          <tr className="border-b border-[var(--rule)]">
            {columns.map((c) => (
              <th
                key={c.key}
                className="px-3 py-2.5 text-[11px] uppercase tracking-[0.06em] text-muted font-medium"
                style={{ textAlign: c.align ?? "left", width: c.width }}
              >
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan={columns.length} className="px-3 py-8 text-center text-muted text-sm">
                {empty ?? "No records."}
              </td>
            </tr>
          ) : (
            rows.map((row) => (
              <tr
                key={rowKey(row)}
                className={`border-b border-rule ${onRowClick ? "cursor-pointer hover:bg-[var(--paper-2)]" : ""}`}
                onClick={onRowClick ? () => onRowClick(row) : undefined}
              >
                {columns.map((c) => (
                  <td
                    key={c.key}
                    className={`px-3 py-2.5 ${c.mono ? "font-mono mono-num" : ""}`}
                    style={{ textAlign: c.align ?? "left" }}
                  >
                    {c.render(row)}
                  </td>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
