import { customFieldDisplay, customValueError } from './customFieldValues';
import { staffOptionLabel } from './workflow';

export default function TaskCustomFields({ fields, values, people = [], editable, disabled = false, onChange }) {
    const active = fields.filter((field) => !field.isArchived);
    if (!active.length) {
        return <p className="hint">No custom fields are visible for this project and discipline.</p>;
    }
    return <div className="form-grid task-custom-fields">
        {active.map((field) => {
            const value = values[field.id] ?? '';
            const error = editable && customValueError(field, value);
            const common = { form: 'task-details-form', value, disabled, 'aria-label': field.name,
                onChange: (event) => onChange(field.id, event.target.value) };
            let control;
            if (!editable) {
                control = <span className="custom-field-value">{customFieldDisplay(field, value, people)}</span>;
            }
            else if (field.type === 'Text') {
                control = <textarea {...common} rows={2} maxLength={2000} />;
            }
            else if (field.type === 'Number') {
                control = <input {...common} type="text" inputMode="decimal" placeholder="e.g. 12.5" />;
            }
            else if (field.type === 'Date') {
                control = <input {...common} type="date" />;
            }
            else if (field.type === 'Checkbox') {
                control = <select {...common}><option value="">Not set</option><option value="true">Yes</option><option value="false">No</option></select>;
            }
            else if (field.type === 'Person') {
                control = <select {...common}><option value="">Not assigned</option>
                    {value && !people.some((person) => person.id.toLowerCase() === value.toLowerCase()) &&
                        <option value={value}>Staff details unavailable</option>}
                    {people.filter((person) => person.isActive || person.id.toLowerCase() === value.toLowerCase()).map((person) =>
                        <option key={person.id} value={person.id} disabled={!person.isActive}>{staffOptionLabel(person)}</option>)}
                </select>;
            }
            return <label className={`field ${field.type === 'Text' ? 'full' : ''}`} key={field.id}>
                <span>{field.name}</span>{control}{error && <span className="error" role="alert">{error}</span>}
            </label>;
        })}
    </div>;
}
