import { useSelector } from 'react-redux';

export function labelStyle(color) {
    const safe = /^#[0-9a-f]{6}$/i.test(color) ? color : '#64748b';
    const channels = [1, 3, 5].map((offset) => {
        const value = parseInt(safe.slice(offset, offset + 2), 16) / 255;
        return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
    });
    const luminance = channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
    return { backgroundColor: safe, color: luminance > 0.179 ? '#000000' : '#ffffff' };
}

export default function LabelBadges({ labels = [] }) {
    const definitions = useSelector((state) => state.workspace.labels || []);
    if (!labels.length) {
        return null;
    }
    return <span className="task-labels" aria-label="Task labels">
        {labels.map((assigned) => {
            const current = definitions.find((item) => item.id === assigned.id);
            const label = current && current.version >= assigned.version ? current : assigned;
            return <span key={label.id} className="task-label" style={labelStyle(label.color)}>
                {label.name}{!label.active && ' (inactive)'}
            </span>;
        })}
    </span>;
}
