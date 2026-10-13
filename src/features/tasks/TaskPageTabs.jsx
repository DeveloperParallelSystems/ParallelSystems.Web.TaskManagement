import { useRef, useState } from 'react';
import { History, Paperclip } from 'lucide-react';

const tabs = [
    { key: 'details', label: 'Details' },
    { key: 'history', label: 'History', icon: History },
    { key: 'attachments', label: 'Attachments', icon: Paperclip, disabled: true,
        tooltip: 'Attachments — coming soon' },
];

export default function TaskPageTabs({ value, onChange }) {
    const buttons = useRef([]);
    const [focused, setFocused] = useState(value);
    const [tooltip, setTooltip] = useState(null);

    function keyDown(event, index) {
        if (event.key === 'Escape' && tooltip) {
            event.preventDefault();
            event.stopPropagation();
            setTooltip(null);
            return;
        }
        let next = index;
        if (event.key === 'ArrowRight') {
            next = (index + 1) % tabs.length;
        }
        else if (event.key === 'ArrowLeft') {
            next = (index + tabs.length - 1) % tabs.length;
        }
        else if (event.key === 'Home') {
            next = 0;
        }
        else if (event.key === 'End') {
            next = tabs.length - 1;
        }
        else {
            return;
        }
        event.preventDefault();
        buttons.current[next]?.focus();
        if (!tabs[next].disabled) {
            onChange(tabs[next].key);
        }
    }

    return (
        <div className="task-page-tabs" role="tablist" aria-label="Task sections">
            {tabs.map((tab, index) => {
                const Icon = tab.icon;
                const visible = tooltip === tab.key;
                return (
                    <button
                        key={tab.key}
                        ref={(element) => {
                            buttons.current[index] = element;
                        }}
                        type="button"
                        role="tab"
                        id={`task-${tab.key}-tab`}
                        className="task-page-tab"
                        aria-label={tab.label}
                        aria-selected={value === tab.key}
                        aria-disabled={tab.disabled || undefined}
                        aria-controls={tab.disabled ? undefined : `task-${tab.key}-panel`}
                        aria-describedby={visible ? `task-${tab.key}-tooltip` : undefined}
                        tabIndex={focused === tab.key ? 0 : -1}
                        onClick={() => {
                            if (!tab.disabled) {
                                onChange(tab.key);
                            }
                        }}
                        onFocus={() => {
                            setFocused(tab.key);
                            setTooltip(Icon ? tab.key : null);
                        }}
                        onBlur={() => setTooltip(null)}
                        onPointerEnter={() => setTooltip(Icon ? tab.key : null)}
                        onPointerLeave={(event) => {
                            if (document.activeElement !== event.currentTarget) {
                                setTooltip(null);
                            }
                        }}
                        onKeyDown={(event) => keyDown(event, index)}
                    >
                        {Icon ? <Icon size={19} aria-hidden="true" /> : tab.label}
                        {visible && (
                            <span id={`task-${tab.key}-tooltip`} role="tooltip" className="task-tab-tooltip">
                                {tab.tooltip || tab.label}
                            </span>
                        )}
                    </button>
                );
            })}
        </div>
    );
}
