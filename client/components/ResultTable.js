import { exportToExcel } from "@/functions/exportToExcel";

function formatCell(value) {
  if (value && typeof value === "object" && value.type === "Buffer") return "";
  return String(value ?? "");
}

export default function ResultTable({ title, rows, columns, filename }) {
  return (
    <div className="mb-8">
      <div className="flex items-center justify-between mb-2">
        <h2 className="font-semibold">
          {title} ({rows?.length || 0} filas)
        </h2>
        {rows && rows.length > 0 && (
          <button
            onClick={() => exportToExcel(rows, columns, filename || title)}
            className="text-xs bg-green-700 text-white rounded px-3 py-1"
          >
            Descargar Excel
          </button>
        )}
      </div>
      {!rows || rows.length === 0 ? (
        <p className="text-sm text-gray-500">Sin resultados.</p>
      ) : (
        <div className="overflow-x-auto border border-[var(--color-border)] rounded">
          <table className="min-w-full text-xs">
            <thead className="bg-gray-100">
              <tr>
                {columns.map((col) => (
                  <th key={col} className="px-2 py-1 text-left whitespace-nowrap border-b border-[var(--color-border)]">
                    {col}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, i) => (
                <tr key={i} className={i % 2 ? "bg-white" : "bg-gray-50"}>
                  {columns.map((col) => (
                    <td key={col} className="px-2 py-1 whitespace-nowrap border-b border-[var(--color-border)]">
                      {formatCell(row[col])}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
