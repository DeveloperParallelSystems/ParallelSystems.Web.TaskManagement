import { useId, useState } from 'react';
import { initials, staffOptionLabel } from './workflow';

export default function TaskContributors({ task, people }) {
    const roles = [
        { key: 'dev', description: 'Developer / original assignee', id: task.originalAssigneeId },
        { key: 'qa', description: 'Reviewer / QA', id: task.reviewerId },
    ].filter((role) => role.id).map((role) => ({
        ...role,
        fallbackName: role.id === task.assigneeId ? task.assigneeName : null,
    }));

    return <ContributorAvatars roles={roles} people={people} groupLabel="Task team" emptyMessage="No team assigned" />;
}

export function ContributorAvatars({ roles, people, groupLabel = 'Contributors', emptyMessage = 'No contributors yet' }) {
    const tooltipId = useId();
    const [activeRole, setActiveRole] = useState(null);

    if (!roles.length) {
        return <span className="muted">{emptyMessage}</span>;
    }

    return (
        <div className="task-contributors" role="group" aria-label={groupLabel}>
            {roles.map((role) => {
                const person = people.find((candidate) => candidate.id === role.id);
                const fallbackName = role.fallbackName;
                const label = person ? staffOptionLabel(person) : fallbackName || 'Staff details unavailable';
                const avatarName = person
                    ? [person.firstName, person.lastName].filter(Boolean).join(' ') || person.name
                    : fallbackName;
                const visible = activeRole === role.key;
                const id = `${tooltipId}-${role.key}`;

                return (
                    <button
                        key={role.key}
                        type="button"
                        className={`task-contributor ${role.tone || role.key}`}
                        aria-label={`${role.description}: ${label}`}
                        aria-describedby={visible ? id : undefined}
                        onPointerEnter={() => setActiveRole(role.key)}
                        onPointerLeave={(event) => {
                            if (event.currentTarget.ownerDocument.activeElement !== event.currentTarget) {
                                setActiveRole(null);
                            }
                        }}
                        onFocus={() => setActiveRole(role.key)}
                        onBlur={() => setActiveRole(null)}
                        onClick={(event) => {
                            event.stopPropagation();
                            setActiveRole(role.key);
                        }}
                        draggable={false}
                        onDragStart={(event) => {
                            event.preventDefault();
                            event.stopPropagation();
                        }}
                        onKeyDown={(event) => {
                            if (event.key === 'Escape') {
                                event.preventDefault();
                                event.stopPropagation();
                                setActiveRole(null);
                            }
                        }}
                    >
                        <span className="contributor-avatar" aria-hidden="true">
                            {initials(avatarName)}
                        </span>
                        {visible && (
                            <span className="contributor-tooltip" id={id} role="tooltip">
                                <strong>{role.description}</strong>
                                <span>{label}</span>
                                {person && !person.email?.trim() && <small>No email saved</small>}
                            </span>
                        )}
                    </button>
                );
            })}
        </div>
    );
}
