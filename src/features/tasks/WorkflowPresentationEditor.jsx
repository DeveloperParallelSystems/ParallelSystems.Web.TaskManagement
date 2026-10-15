import { movePresentationStatus, presentationColors, reorderPresentation } from './workflowPresentation';
import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight, Plus, Trash2 } from 'lucide-react';

export default function WorkflowPresentationEditor({ groups, onChange, disabled, catalog = null }) {
    const statusName = (code) => catalog?.find((item) => item.code === code)?.name || code;

    function changeColumn(id, changes) {
        onChange(groups.map((group) => group.id === id ? { ...group, ...changes } : group));
    }

    function addColumn() {
        let number = 1;
        while (groups.some((group) => group.id === `column-${number}`)) {
            number++;
        }
        onChange([...groups, { id: `column-${number}`, name: 'New column', color: 'blue', statuses: [] }]);
    }

    return <fieldset className="presentation-editor" disabled={disabled}>
        <legend className="sr-only">Board columns</legend>
        <div className="presentation-section-heading">
            <h2>Columns</h2>
            <button type="button" className="button presentation-add" disabled={groups.length >= 13} onClick={addColumn}>
                <Plus size={16} aria-hidden="true" />Add column <span>{groups.length} / 13</span>
            </button>
        </div>
        <div className="presentation-column-grid">
            {groups.map((group, columnIndex) => <section className={`presentation-column ${group.color}`} key={group.id}
                aria-label={`Column ${columnIndex + 1}: ${group.name}`}>
                <div className="presentation-column-heading">
                    <h3>Column {columnIndex + 1}</h3>
                    <div className="presentation-icon-actions">
                        <button type="button" className="button" disabled={columnIndex === 0}
                            aria-label={`Move ${group.name} column earlier`} title="Move column earlier"
                            onClick={() => onChange(reorderPresentation(groups, columnIndex, -1))}><ChevronLeft size={16} aria-hidden="true" /></button>
                        <button type="button" className="button" disabled={columnIndex === groups.length - 1}
                            aria-label={`Move ${group.name} column later`} title="Move column later"
                            onClick={() => onChange(reorderPresentation(groups, columnIndex, 1))}><ChevronRight size={16} aria-hidden="true" /></button>
                        <button type="button" className="button" disabled={groups.length === 1 || group.statuses.length > 0}
                            aria-label={`Remove empty ${group.name} column`} title="Only empty columns can be removed"
                            onClick={() => onChange(groups.filter((column) => column.id !== group.id))}><Trash2 size={15} aria-hidden="true" /></button>
                    </div>
                </div>
                <label className="field"><span>Column name</span>
                    <input required maxLength={80} value={group.name}
                        onChange={(event) => changeColumn(group.id, { name: event.target.value })} />
                </label>
                <div className="presentation-theme" role="group" aria-label={`Theme color for column ${columnIndex + 1}`}>
                    <span>Theme color</span>
                    <div className="presentation-swatches">
                        {presentationColors.map((color) => <button key={color} type="button" className={`presentation-swatch ${color}`}
                            aria-label={`${color[0].toUpperCase()}${color.slice(1)} theme`} aria-pressed={group.color === color}
                            onClick={() => changeColumn(group.id, { color })} />)}
                    </div>
                    <span className="presentation-color-name">{group.color}</span>
                </div>
                <h4>Statuses in this column <span>({group.statuses.length})</span></h4>
                <ol className="presentation-statuses">
                    {group.statuses.map((status, statusIndex) => <li key={status}>
                        <strong>{statusName(status)}</strong>
                        <label className="field"><span className="sr-only">Move {statusName(status)} to column</span>
                            <select value={group.id} onChange={(event) => onChange(movePresentationStatus(groups, status, event.target.value, catalog))}>
                                {groups.map((column, index) => <option key={column.id} value={column.id}>{index + 1}. {column.name}</option>)}
                            </select>
                        </label>
                        <div className="presentation-icon-actions">
                            <button type="button" className="button" disabled={statusIndex === 0}
                                aria-label={`Move ${statusName(status)} earlier`}
                                onClick={() => changeColumn(group.id, { statuses: reorderPresentation(group.statuses, statusIndex, -1) })}><ArrowUp size={14} aria-hidden="true" /></button>
                            <button type="button" className="button" disabled={statusIndex === group.statuses.length - 1}
                                aria-label={`Move ${statusName(status)} later`}
                                onClick={() => changeColumn(group.id, { statuses: reorderPresentation(group.statuses, statusIndex, 1) })}><ArrowDown size={14} aria-hidden="true" /></button>
                        </div>
                    </li>)}
                </ol>
                {!group.statuses.length && <p className="hint">Empty column. Move a status here using its column selector, or remove this column.</p>}
            </section>)}
        </div>
    </fieldset>;
}
