import EmptyState from './EmptyState.jsx';

/**
 * Replaces the hand-rolled <table> blocks that were repeated across six pages,
 * along with their duplicated loading and empty branches.
 *
 * `columns` is [{ key, header, render?, className? }]. `render(row)` returns the
 * cell content; without it the raw `row[key]` is shown.
 */
export default function DataTable({ columns, rows, loading, empty, rowKey = (row) => row.id }) {
  if (loading) return <p className="muted">Loading…</p>;
  if (!rows?.length) return empty ?? <EmptyState title="Nothing here yet" />;

  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            {columns.map((column) => (
              <th key={column.key}>{column.header}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={rowKey(row)}>
              {columns.map((column) => (
                <td key={column.key} className={column.className}>
                  {column.render ? column.render(row) : row[column.key]}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
