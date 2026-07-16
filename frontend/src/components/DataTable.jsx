import {
  ArrowDown,
  ArrowUp,
  ChevronsUpDown,
  ChevronLeft,
  ChevronRight,
  FilterX,
  Search
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import EmptyState from "./EmptyState.jsx";
import RowActionMenu from "./RowActionMenu.jsx";
import { useLanguage } from "../context/LanguageContext.jsx";

function rawValue(column, row) {
  if (column.getValue) return column.getValue(row);
  return row[column.key];
}

function compare(left, right) {
  if (left === right) return 0;
  if (left === undefined || left === null || left === "") return 1;
  if (right === undefined || right === null || right === "") return -1;
  if (typeof left === "number" && typeof right === "number") return left - right;
  return String(left).localeCompare(String(right), undefined, { numeric: true, sensitivity: "base" });
}

export default function DataTable({
  className = "",
  columns,
  rows = [],
  rowKey = "_id",
  loading = false,
  controls = true,
  showResultCount = controls,
  pageSize: initialPageSize = 10,
  searchPlaceholder = "Search records...",
  filters = [],
  initialFilters = {},
  selection,
  rowActions,
  onRowClick,
  toolbarActions,
  emptyDescription = "Adjust filters or create a new record.",
  caption
}) {
  const { t } = useLanguage();
  const [search, setSearch] = useState("");
  const [filterValues, setFilterValues] = useState(initialFilters);
  const [sort, setSort] = useState(null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(initialPageSize);

  useEffect(() => setPage(1), [search, filterValues, pageSize, rows.length]);

  const processed = useMemo(() => {
    let next = [...rows];
    const needle = search.trim().toLowerCase();
    if (needle) {
      next = next.filter((row) => columns.some((column) => {
        if (column.searchable === false || column.key === "actions") return false;
        const value = rawValue(column, row);
        return value !== undefined && value !== null && String(value).toLowerCase().includes(needle);
      }));
    }
    for (const filter of filters) {
      const selected = filterValues[filter.key];
      if (selected === undefined || selected === "") continue;
      next = next.filter((row) => {
        const value = filter.getValue ? filter.getValue(row) : row[filter.key];
        return String(value) === String(selected);
      });
    }
    if (sort) {
      const column = columns.find((item) => item.key === sort.key);
      next.sort((left, right) => compare(rawValue(column, left), rawValue(column, right)) * (sort.direction === "asc" ? 1 : -1));
    }
    return next;
  }, [rows, columns, search, filters, filterValues, sort]);

  const pageCount = Math.max(1, Math.ceil(processed.length / pageSize));
  const safePage = Math.min(page, pageCount);
  const visibleRows = processed.slice((safePage - 1) * pageSize, safePage * pageSize);
  const selectedIds = selection?.selected || [];
  const selectableVisible = visibleRows.filter((row) => !selection?.isRowSelectable || selection.isRowSelectable(row));
  const allVisibleSelected = selectableVisible.length > 0 && selectableVisible.every((row) => selectedIds.includes(row[rowKey]));
  const hasFilters = Boolean(search) || Object.values(filterValues).some(Boolean);

  function toggleSort(column) {
    if (column.sortable === false || column.key === "actions") return;
    setSort((current) => {
      if (!current || current.key !== column.key) return { key: column.key, direction: "asc" };
      if (current.direction === "asc") return { key: column.key, direction: "desc" };
      return null;
    });
  }

  function toggleAllVisible() {
    const visibleIds = selectableVisible.map((row) => row[rowKey]);
    const next = allVisibleSelected
      ? selectedIds.filter((id) => !visibleIds.includes(id))
      : [...new Set([...selectedIds, ...visibleIds])];
    selection.onChange(next);
  }

  function clearFilters() {
    setSearch("");
    setFilterValues({});
    setSort(null);
  }

  return (
    <div className={`data-table ${className}`.trim()}>
      {controls && (
        <div className="table-toolbar">
          <div className="table-toolbar-primary">
            <label className="table-search">
              <Search size={16} aria-hidden="true" />
              <span className="sr-only">{t("Search")}</span>
              <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder={t(searchPlaceholder)} />
            </label>
            {filters.map((filter) => (
              <label className="compact-field" key={filter.key}>
                <span className="sr-only">{t(filter.label)}</span>
                <select value={filterValues[filter.key] || ""} onChange={(event) => setFilterValues((current) => ({ ...current, [filter.key]: event.target.value }))}>
                  <option value="">{t(filter.allLabel || `All ${filter.label.toLowerCase()}`)}</option>
                  {filter.options.map((option) => (
                    <option key={option.value ?? option} value={option.value ?? option}>{t(option.label ?? option)}</option>
                  ))}
                </select>
              </label>
            ))}
            {hasFilters && (
              <button type="button" className="text-button" onClick={clearFilters}>
                <FilterX size={15} />
                <span>{t("Clear filters")}</span>
              </button>
            )}
          </div>
          {toolbarActions && <div className="table-toolbar-actions">{toolbarActions}</div>}
        </div>
      )}

      {showResultCount && (
        <div className="table-result-bar">
          <span>{loading ? t("Loading records...") : t("Showing {shown} of {total} results").replace("{shown}", processed.length).replace("{total}", rows.length)}</span>
          {selection && selectedIds.length > 0 && <strong>{t("{count} selected").replace("{count}", selectedIds.length)}</strong>}
        </div>
      )}

      <div className="table-scroll">
        <table>
          {caption && <caption className="sr-only">{t(caption)}</caption>}
          <thead>
            <tr>
              {selection && (
                <th className="checkbox-column">
                  <input type="checkbox" checked={allVisibleSelected} onChange={toggleAllVisible} aria-label={t("Select all visible rows")} />
                </th>
              )}
              {columns.map((column) => {
                const sorted = sort?.key === column.key;
                const SortIcon = !sorted ? ChevronsUpDown : sort.direction === "asc" ? ArrowUp : ArrowDown;
                return (
                  <th key={column.key} className={column.align ? `align-${column.align}` : ""} style={column.width ? { width: column.width } : undefined}>
                    {column.sortable === false || column.key === "actions" ? t(column.label) : (
                      <button type="button" className="sort-button" onClick={() => toggleSort(column)}>
                        <span>{t(column.label)}</span>
                        <SortIcon size={14} aria-hidden="true" />
                      </button>
                    )}
                  </th>
                );
              })}
              {rowActions && <th className="actions-column"><span className="sr-only">{t("Actions")}</span></th>}
            </tr>
          </thead>
          <tbody>
            {loading ? Array.from({ length: Math.min(pageSize, 6) }).map((_, rowIndex) => (
              <tr key={`loading-${rowIndex}`}>
                {selection && <td><span className="skeleton skeleton-check" /></td>}
                {columns.map((column) => <td key={column.key}><span className="skeleton skeleton-line" /></td>)}
                {rowActions && <td><span className="skeleton skeleton-check" /></td>}
              </tr>
            )) : visibleRows.map((row) => (
              <tr
                key={row[rowKey]}
                className={onRowClick ? "clickable-row" : ""}
                onClick={onRowClick ? (event) => {
                  if (event.target.closest("a, button, input, select, textarea")) return;
                  onRowClick(row);
                } : undefined}
              >
                {selection && (
                  <td className="checkbox-column">
                    <input
                      type="checkbox"
                      checked={selectedIds.includes(row[rowKey])}
                      disabled={selection.isRowSelectable && !selection.isRowSelectable(row)}
                      onChange={() => selection.onChange(selectedIds.includes(row[rowKey]) ? selectedIds.filter((id) => id !== row[rowKey]) : [...selectedIds, row[rowKey]])}
                      aria-label={t("Select row")}
                    />
                  </td>
                )}
                {columns.map((column) => {
                  const value = column.render ? column.render(row) : rawValue(column, row);
                  return <td key={column.key} className={column.align ? `align-${column.align}` : ""} data-label={t(column.label)}>{typeof value === "string" ? t(value) : value}</td>;
                })}
                {rowActions && <td className="actions-column"><RowActionMenu row={row} actions={rowActions} /></td>}
              </tr>
            ))}
          </tbody>
        </table>
        {!loading && !visibleRows.length && <EmptyState description={hasFilters ? "No records match the current filters." : emptyDescription} />}
      </div>

      {controls && processed.length > 0 && (
        <div className="table-pagination">
          <label className="page-size">
            <span>{t("Rows per page")}</span>
            <select value={pageSize} onChange={(event) => setPageSize(Number(event.target.value))}>
              {[10, 25, 50].map((size) => <option key={size} value={size}>{size}</option>)}
            </select>
          </label>
          <span>{t("Page {page} of {pages}").replace("{page}", safePage).replace("{pages}", pageCount)}</span>
          <div className="pagination-buttons">
            <button type="button" className="icon-button" disabled={safePage <= 1} onClick={() => setPage((current) => Math.max(1, current - 1))} aria-label={t("Previous page")}><ChevronLeft size={17} /></button>
            <button type="button" className="icon-button" disabled={safePage >= pageCount} onClick={() => setPage((current) => Math.min(pageCount, current + 1))} aria-label={t("Next page")}><ChevronRight size={17} /></button>
          </div>
        </div>
      )}
    </div>
  );
}
